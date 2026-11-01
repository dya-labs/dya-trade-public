import type { IntentDiff } from "./diffs";

/** A catalog token resolved to its canonical asset (`group`, e.g. a CoinGecko id) and decimals. */
export type Asset = { group: string; decimals: number };
export type Resolve = (assetId: string) => Asset | undefined;

/**
 * 1Click's own swaps: fee accounts converting collected fees (`1click-1cs`) and protocol fees.
 * They are real executions, but the Explorer API doesn't list them, so history couldn't include
 * them; they are stored and reported, never charted, so history and live data match.
 */
export const SERVICE_REFERRALS: ReadonlySet<string> = new Set(["1click-1cs", "1click-protocol-fees"]);

/** A 1Click user's intent: 1Click marks it with a referral; solvers' intents carry none. */
export const isUserIntent = (diff: Pick<IntentDiff, "referral">) => diff.referral !== "" && !SERVICE_REFERRALS.has(diff.referral);

/** Amounts normalized to 1e-36 units of the canonical asset, so chain representations net out. */
export const NORMAL_DECIMALS = 36;
const normalize = (amount: bigint, decimals: number) => amount * 10n ** BigInt(NORMAL_DECIMALS - decimals);
// A net position within this share of the account's gross flow in that asset is a bridging or fee
// residue, not a trade (e.g. a solver moving AURORA from NEAR to Ethereum nets ~0.01%).
const RESIDUE_BPS = 100n;

export type Leg = { group: string; amount: bigint };
/** One charted trade: `sold` flows toward the user's output, so for `sold.group` it is a taker sell. */
export type RouteTrade = { index: number; sold: Leg; bought: Leg; kind: "step" | "swap" };
export type ReceiptStatus =
  /** Route steps (H2): every exchange between different parties along the user's route. */
  | "route"
  /** The user swap itself (H1): the route didn't connect cleanly (splits, several users, odd shapes). */
  | "fallback"
  /** No 1Click user intent (direct solver-relay trades, 1Click's own swaps): stored only. */
  | "no-user"
  /** The user only moved an asset between chains. */
  | "bridge"
  /** A token the catalog can't resolve; its user swaps fall back where possible. */
  | "unknown-asset"
  /** A 1Click swap settled by transfers through 1Click's settlement account (`intents_settlements`). */
  | "settlement";
export type ReceiptTrades = { status: ReceiptStatus; trades: RouteTrade[] };

/** A stored settled swap's exchange; the app fee is in basis points of the input. */
export type SettledExchange = { originAsset: string; amountIn: bigint; destinationAsset: string; amountOut: bigint; appFeeBps: number };

/**
 * A settled swap as one user swap. 1Click keeps the partner (app) fee off-chain, so the input is
 * reduced by it: without that, the price would carry the fee (median 0.8%, up to 1.8%), while the
 * fee-free price stays within a few basis points of the venues' (145 sampled swaps).
 */
export function settlementTrades(swap: SettledExchange, resolve: Resolve): ReceiptTrades {
  const origin = resolve(swap.originAsset), destination = resolve(swap.destinationAsset);
  if (!origin || !destination) return { status: "unknown-asset", trades: [] };
  if (origin.group === destination.group) return { status: "bridge", trades: [] };
  const sold = normalize(swap.amountIn * BigInt(10_000 - swap.appFeeBps) / 10_000n, origin.decimals);
  const bought = normalize(swap.amountOut, destination.decimals);
  if (sold <= 0n || bought <= 0n) return { status: "settlement", trades: [] };
  return { status: "settlement", trades: [{ index: 0, sold: { group: origin.group, amount: sold }, bought: { group: destination.group, amount: bought }, kind: "swap" }] };
}

/** Signed net flow per canonical asset, residues dropped. */
function net(diffs: readonly IntentDiff[], resolve: Resolve): Map<string, bigint> | undefined {
  const sum = new Map<string, bigint>(), gross = new Map<string, bigint>();
  for (const diff of diffs) {
    for (const [token, amount] of diff.diff) {
      const asset = resolve(token);
      if (!asset) return undefined;
      const value = normalize(amount, asset.decimals);
      sum.set(asset.group, (sum.get(asset.group) ?? 0n) + value);
      gross.set(asset.group, (gross.get(asset.group) ?? 0n) + (value < 0n ? -value : value));
    }
  }
  for (const [group, value] of sum) if ((value < 0n ? -value : value) * 10_000n <= gross.get(group)! * RESIDUE_BPS) sum.delete(group);
  return sum;
}

/** The single given and received asset of a net position, or undefined for any other shape. */
function exchange(position: Map<string, bigint>): { sold: Leg; bought: Leg } | undefined {
  if (position.size !== 2) return undefined;
  const entries = [...position];
  const [a, x] = entries[0]!, [b, y] = entries[1]!;
  if (x < 0n && y > 0n) return { sold: { group: a, amount: -x }, bought: { group: b, amount: y } };
  if (y < 0n && x > 0n) return { sold: { group: b, amount: -y }, bought: { group: a, amount: x } };
  return undefined;
}

const near = (a: bigint, b: bigint) => (a > b ? a - b : b - a) * 10_000n <= (a > b ? a : b) * RESIDUE_BPS;

/** Each user intent as its own trade (H1); same-asset moves are bridging, not trades. */
function userSwaps(users: readonly IntentDiff[], resolve: Resolve): RouteTrade[] {
  const trades: RouteTrade[] = [];
  for (const diff of users) {
    const position = net([diff], resolve);
    const swap = position && exchange(position);
    if (swap) trades.push({ index: trades.length, ...swap, kind: "swap" });
  }
  return trades;
}

/**
 * A signed intent can contain both the main swap and a destination gas top-up. Match each
 * user leg to an unambiguous, amount-conserving solver path before netting solver accounts:
 * netting the entire receipt first mixes those independent routes into multi-asset positions.
 * Repeated intent hashes are not duplicates: each token_diff is a separate executed leg.
 */
function separateRoutes(diffs: readonly IntentDiff[], users: readonly IntentDiff[], resolve: Resolve): ReceiptTrades | undefined {
  const edges: { diff: IntentDiff; sold: Leg; bought: Leg }[] = [];
  for (const diff of diffs) {
    if (isUserIntent(diff)) continue;
    const position = net([diff], resolve);
    if (!position) return undefined;
    if (!position.size) continue;
    const swap = exchange(position);
    if (!swap) return undefined;
    edges.push({ diff, sold: swap.bought, bought: swap.sold });
  }
  const used = new Set<number>(), trades: RouteTrade[] = [];
  for (const user of users) {
    const position = net([user], resolve);
    if (!position) return undefined;
    if (!position.size) continue;
    const swap = exchange(position);
    if (!swap) return undefined;
    const paths: number[][] = [];
    const walk = (leg: Leg, path: number[], visited: Set<string>) => {
      if (paths.length > 1) return;
      if (leg.group === swap.bought.group) {
        if (near(leg.amount, swap.bought.amount)) paths.push([...path]);
        return;
      }
      if (visited.has(leg.group)) return;
      visited.add(leg.group);
      for (let index = 0; index < edges.length; index++) {
        const edge = edges[index]!;
        if (used.has(index) || path.includes(index) || edge.sold.group !== leg.group || !near(edge.sold.amount, leg.amount)) continue;
        path.push(index);
        walk(edge.bought, path, visited);
        path.pop();
      }
      visited.delete(leg.group);
    };
    walk(swap.sold, [], new Set());
    if (paths.length !== 1) return undefined;
    const path = paths[0]!;
    const result = receiptTrades([...path.map(index => edges[index]!.diff), user], resolve);
    if (result.status !== "route") return undefined;
    for (const index of path) used.add(index);
    for (const trade of result.trades) trades.push({ ...trade, index: trades.length });
  }
  if (used.size !== edges.length) return undefined;
  return { status: trades.length ? "route" : "bridge", trades };
}

/**
 * Trades of one receipt's intents. With one 1Click user, the other parties' net positions are
 * the route steps; they are charted when they connect the user's input to the user's output
 * with every asset conserved, so each asset that changed hands counts once. Otherwise the user
 * swaps themselves are charted.
 */
export function receiptTrades(diffs: readonly IntentDiff[], resolve: Resolve): ReceiptTrades {
  const users = diffs.filter(isUserIntent);
  if (!users.length) return { status: "no-user", trades: [] };
  const accounts = Map.groupBy(diffs, diff => diff.account);
  const userAccounts = new Set(users.map(diff => diff.account));
  if (users.length > 1 && userAccounts.size === 1) {
    const separated = separateRoutes(diffs, users, resolve);
    if (separated) return separated;
  }
  const positions = new Map<string, Map<string, bigint>>();
  for (const [account, own] of accounts) {
    const position = net(own, resolve);
    if (!position) return { status: "unknown-asset", trades: userSwaps(users, resolve) };
    positions.set(account, position);
  }
  if (userAccounts.size !== 1) return { status: "fallback", trades: userSwaps(users, resolve) };
  const user = positions.get([...userAccounts][0]!)!;
  if (!user.size) return { status: "bridge", trades: [] };
  const route = exchange(user);
  if (!route) return { status: "fallback", trades: userSwaps(users, resolve) };

  const steps: { sold: Leg; bought: Leg }[] = [];
  for (const [account, position] of positions) {
    if (userAccounts.has(account) || !position.size) continue;
    // A solver's net: it received what the user's route sold into it and gave what flows on.
    const solver = exchange(position);
    if (!solver) return { status: "fallback", trades: userSwaps(users, resolve) };
    steps.push({ sold: solver.bought, bought: solver.sold });
  }
  // Conservation along the route: the user's input enters, the user's output leaves, and every
  // other asset leaves as much as entered. Net flows allow solvers' cycles (USDC → USDT → USDC
  // moving USDC across chains), whose steps are real exchanges between different parties.
  const flow = new Map<string, bigint>(), volume = new Map<string, bigint>();
  for (const step of steps) {
    flow.set(step.sold.group, (flow.get(step.sold.group) ?? 0n) + step.sold.amount);
    flow.set(step.bought.group, (flow.get(step.bought.group) ?? 0n) - step.bought.amount);
    volume.set(step.sold.group, (volume.get(step.sold.group) ?? 0n) + step.sold.amount);
    volume.set(step.bought.group, (volume.get(step.bought.group) ?? 0n) + step.bought.amount);
  }
  const balanced = (group: string, expected: bigint) => {
    const value = flow.get(group) ?? 0n, gap = value > expected ? value - expected : expected - value;
    return gap * 10_000n <= (volume.get(group) ?? 0n) * RESIDUE_BPS;
  };
  const connected = steps.length > 0 && near(flow.get(route.sold.group) ?? 0n, route.sold.amount) && near(-(flow.get(route.bought.group) ?? 0n), route.bought.amount)
    && [...flow.keys()].every(group => group === route.sold.group || group === route.bought.group || balanced(group, 0n));
  if (!connected) return { status: "fallback", trades: userSwaps(users, resolve) };
  return { status: "route", trades: steps.map((step, index) => ({ index, ...step, kind: "step" })) };
}
