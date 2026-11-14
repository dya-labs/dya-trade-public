import { DYA_WALLET_NAMES } from "@dya/config";
import { selectedTradingAccount, tradingAccountsView } from "../outlayer/accounts";
import { D } from "../../../../../packages/wallet-contracts/src/domain/decimal";
import { accountIdentity } from "../auth/intents";
import { assertRecoverySigningAvailable, LocalRecoveryRestricted } from "../services/recovery-mode";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { sessionSnapshot } from "../services/workflow-context";
import { NextResponse } from "next/server";
import { listOrders } from "../services/orders";
import { accountFor, type Account, type StateStore } from "../repositories/store";
import type { LiveBalances } from "../../../../../packages/wallet-contracts/src/domain/assets";

function response(data: unknown) {
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
async function requireAccount(store: StateStore, session: string | undefined) {
  const account = await store.read(s => accountFor(s, session));
  if (!account) throw new AppError(ErrorCode.SignInWithAPasskeyFirst);
  if (account.localRecovery) throw new LocalRecoveryRestricted();
  assertRecoverySigningAvailable(account);
  return account;
}
export async function handleNearRead(route: string, store: StateStore, session: string | undefined, balanceReader: (accountId: string) => Promise<LiveBalances>, validatedAccount?: Awaited<ReturnType<typeof requireAccount>>) {
  if (route === "state") return response(await store.read(s => sessionSnapshot(accountFor(s, session), true)));
  if (route === "live/orders") return response({ orders: await listOrders(store, session), submissionEnabled: true });
  if (route === "live/trades") {
    const a = await requireAccount(store, session);
    return response({ trades: await store.read(s => Object.values(s.liveTrades ?? {}).filter(t => t.ownerId === a.id && t.review.confidentiality === "advanced").sort((x, y) => y.createdAt - x.createdAt).map(t => ({ ...t, review: { ...t.review, payload: undefined, challenge: undefined } }))) });
  }
  if (route === "live/balances") {
    const a = validatedAccount ?? await requireAccount(store, session);
    if (a.kind !== "passkey" || !a.publicKey) return NextResponse.json({ error: "Connect a passkey to view real balances" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    const balances = await balanceReader(accountIdentity(a).accountId);
    if ((await requireAccount(store, session)).id !== a.id) throw new AppError(ErrorCode.SessionChanged);
    return response(balances);
  }
  if (route === "transfers/withdrawals") {
    const a = await requireAccount(store, session);
    const destinations = new Map(tradingAccountsView(a).wallets.flatMap(wallet => {
      const draft = selectedTradingAccount(a, wallet.id).outlayerSetupDraft;
      return draft?.phase === "policy-ready" ? [[draft.walletPublicKey, wallet] as const] : [];
    }));
    return response({ withdrawals: await store.read(s => Object.values(s.withdrawals ?? {}).filter(w => w.ownerId === a.id && w.review.confidentiality === "advanced").map(w => ({ ...w, counterpartyIsTrading: w.review.destinationChain === "Confidential Intents" && destinations.has(w.review.destinationWallet), counterpartyAvatarSeed: w.review.destinationChain === "Confidential Intents" ? destinations.get(w.review.destinationWallet)?.id : undefined, counterpartyName: w.review.destinationChain === "Confidential Intents" ? destinations.get(w.review.destinationWallet)?.name : undefined, review: { ...w.review, payload: undefined, challenge: undefined } })).sort((x, y) => y.createdAt - x.createdAt)) });
  }
  if (route === "transfers/deposits") {
    const a = await requireAccount(store, session);
    const recipient = accountIdentity(a).accountId;
    const tradingAccounts = [...Object.values(a.outlayerTradingAccounts ?? {}), { ...a.outlayerLegacySetup, id: a.outlayerSetupDraft && ("walletId" in a.outlayerSetupDraft ? a.outlayerSetupDraft.walletId : a.outlayerSetupDraft.id), name: DYA_WALLET_NAMES.legacyTrading }];
    const internalReceipts = tradingAccounts.flatMap(record =>
      Object.values(record?.withdrawals ?? {}).flatMap(transfer => {
        if (transfer.phase !== "complete" || transfer.outcome !== "settled" ||
            !transfer.internal || transfer.recipient !== recipient ||
            !transfer.assetId || !transfer.symbol || transfer.decimals === undefined) return [];
        return [{
          id: transfer.id,
          createdAt: Date.parse(transfer.deadline) - 120_000,
          status: "SUCCESS",
          counterpartyName: record.name,
          counterpartyAvatarSeed: record.id,
          counterpartyIsTrading: true,
          creditedAmount: new D(transfer.rawAmount).div(new D(10).pow(transfer.decimals)).toFixed(),
          originChainTxHashes: [],
          quote: { asset: transfer.symbol, sourceChain: "Confidential Intents", sourceAssetId: transfer.assetId },
        }];
      }));
    const deposits = await store.read(s => Object.values(s.deposits ?? {})
      .filter(d => d.ownerId === a.id && d.quote.confidentiality === "advanced")
      .sort((x, y) => y.createdAt - x.createdAt));
    return response({ deposits, internalReceipts });
  }
  return null;
}
