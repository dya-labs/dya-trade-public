import { selectedTradingAccount, tradingAccountsView } from "../outlayer/accounts";
import { discoverTokens, requireToken } from "./token-policy";
import { ACTIVE_PAIR } from "../../../../../packages/wallet-contracts/src/domain/assets";
import { requireNetwork, discoverNetworks } from "./network-policy";
import { resolveDepositAssets } from "../../../../../packages/wallet-contracts/src/domain/deposit-assets";
import { requireDepositRefund } from "./deposit-refund-policy";
import { accountIdentity } from "../auth/intents";
import { StorageUnavailableError } from "../repositories/storage-error";
import { readCatalog } from "../providers/catalog";
import { resolveWithdrawalAssets } from "../../../../../packages/wallet-contracts/src/domain/withdrawal-assets";
import { createBridgeAddress, readBridgeDeposits, readBridgeRoutes } from "../providers/bridge";
import { setCookie } from "./workflow-context";
import { canReconcile, nextRevision, mergeHashes, operationState, isTerminalDeposit } from "../../../../../packages/wallet-contracts/src/domain/reconciliation";

import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { verifyAssertion } from "../auth/passkeys";

import { prepareWithdrawal, publishWithdrawal, validateWithdrawal } from "./one-click-withdraw";

import { createDepositQuote, readDepositStatus } from "./one-click-deposit";

import { encodeAssertion } from "../auth/intents";
import { randomUUID } from "node:crypto";

import { generateAuthenticationOptions, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { accountFor, consumeChallenge } from "../repositories/store";

import { CEREMONY, cookieOptions, response, requireAccount, saveChallenge, type AccountWorkflowContext } from "./workflow-context";

export async function runTransfers(context: AccountWorkflowContext) {
  const { route, body, store, deployment, url, session, ceremony, balanceReader, account } = context;
    if (route === "bridge/address" || route === "bridge/deposits") {
      if (account.kind !== "passkey" || !account.publicKey) throw new AppError(ErrorCode.ConnectAPasskeyFirst);
      const identity = accountIdentity(account);
      if (route === "bridge/address") {
        const assets = await readCatalog();
        await discoverTokens(store, assets);
        const asset = assets.find(a => a.assetId === body.assetId);
        if (!asset) throw new AppError(ErrorCode.ChooseASupportedTransferRoute);
        await store.read(s => { requireDepositRefund(s, asset.blockchain); requireToken(s, asset, "deposits"); });
      }
      const result = route === "bridge/address"
        ? await createBridgeAddress(identity.accountId, body.assetId, fetch, async () => readBridgeRoutes(fetch, readCatalog, await store.read(s => Object.values(s.networks ?? {}))))
        : { deposits: await readBridgeDeposits(identity.accountId) };
      if ((await requireAccount(store, session)).id !== account.id) throw new AppError(ErrorCode.SessionChanged);
      return response(result);
    }
    if (route === "transfers/preview") {
      if (account.kind !== "passkey" || !account.publicKey || !account.credentialId) throw new AppError(ErrorCode.ConnectAPasskeyFirst);
      const identity = accountIdentity(account);
      if (body.direction === "deposit") {
        let recipient = identity.accountId;
        if (body.tradingWalletId !== undefined) {
          const id = body.tradingWalletId;
          if (typeof id !== "string" || !tradingAccountsView(account).wallets.some(wallet => wallet.id === id)) {
            throw new AppError(ErrorCode.ChooseASupportedTransferRoute);
          }
          const draft = selectedTradingAccount(account, id).outlayerSetupDraft;
          if (draft?.phase !== "policy-ready") throw new AppError(ErrorCode.ChooseASupportedTransferRoute);
          recipient = draft.walletPublicKey;
        }
        const assets = await readCatalog();
        await discoverTokens(store, assets);
        const registry = await store.read(s => Object.values(s.tokens ?? {}));
        let chain = "bsc";
        let selected: { source: typeof assets[number]; target: typeof assets[number] };
        if (body.sourceAssetId !== undefined || body.targetAssetId !== undefined) {
          await discoverNetworks(store, assets);
          selected = resolveDepositAssets(assets, body.targetAssetId, body.sourceAssetId, registry);
          chain = selected.source.blockchain;
        }
        else {
          const matches = assets.filter(a => a.blockchain === "bsc" && a.symbol === "USDC");
          if (matches.length !== 1) throw new AppError(ErrorCode.ChooseASupportedTransferRoute);
          selected = { source: matches[0], target: matches[0] };
        }
        const refundAddress = await store.read(s => { requireToken(s, selected.source, "deposits"); requireToken(s, selected.target, "deposits"); return requireDepositRefund(s, chain); });
        const quote = await createDepositQuote(body, recipient, process.env.ONE_CLICK_JWT ?? "", undefined, undefined, true, registry, refundAddress);
        if ((quote.sourceNetwork ?? (quote.sourceChain === "BSC" ? "bsc" : undefined)) !== chain) throw new AppError(ErrorCode.ChooseASupportedTransferRoute);
        if ((await requireAccount(store, session)).id !== account.id) throw new AppError(ErrorCode.SessionChanged);
        const id = randomUUID();
        const deposit = await store.transaction(s => {
          if (accountFor(s, session)?.id !== account.id) throw new AppError(ErrorCode.SessionChanged);
          if (requireDepositRefund(s, chain) !== refundAddress) throw new AppError(ErrorCode.NetworkTransferUnavailable);
          requireToken(s, selected.source, "deposits"); requireToken(s, selected.target, "deposits");
          s.deposits ??= {};
          const record = { id, ownerId: account.id, createdAt: Date.now(), updatedAt: Date.now(), quote, status: "PENDING_DEPOSIT" as const };
          s.deposits[id] = record;
          return record;
        });
        return response({ ...quote, id: deposit.id });
      }
      if (body.direction !== "withdraw") throw new AppError(ErrorCode.ChooseASupportedTransferRoute);
      if (url.hostname !== deployment.rpId) throw new AppError(ErrorCode.PasskeyOriginRequired, deployment.origin);
      let internalRecipient: string | undefined;
      if (body.internalAccountId !== undefined) {
        const wallet = tradingAccountsView(account).wallets.find(item => item.id === body.internalAccountId);
        const target = wallet && selectedTradingAccount(account, wallet.id).outlayerSetupDraft;
        if (target?.phase !== "policy-ready" || body.originAssetId === undefined || body.originAssetId !== body.destinationAssetId) {
          throw new AppError(ErrorCode.ChooseASupportedTransferRoute);
        }
        internalRecipient = target.walletPublicKey;
      }
      const catalog = await readCatalog();
      await discoverTokens(store, catalog);
      const explicit = body.originAssetId !== undefined || body.destinationAssetId !== undefined;
      const legacyOrigin = catalog.find(a => a.assetId === (body.asset === "wNEAR" ? ACTIVE_PAIR.base.assetId : ACTIVE_PAIR.quote.assetId));
      const legacyDestinations = catalog.filter(a => a.symbol === body.asset && a.blockchain === (body.asset === "wNEAR" ? "near" : "bsc"));
      const selection = explicit ? resolveWithdrawalAssets(catalog, body.originAssetId, body.destinationAssetId) : legacyOrigin && legacyDestinations.length === 1 ? { origin: legacyOrigin, destination: legacyDestinations[0] } : undefined;
      if (!selection) throw new AppError(ErrorCode.ChooseASupportedTransferRoute);
      await store.read(s => { requireToken(s, selection.origin, "withdrawals"); requireToken(s, selection.destination, "withdrawals"); });
      const chain = selection?.destination.blockchain ?? (body.asset === "wNEAR" ? "near" : "bsc");
      await store.read(s => { const n = requireNetwork(s, chain, "withdrawals"); const address = typeof body.wallet === "string" ? body.wallet : undefined; if (!internalRecipient && n.addressKind === "evm" && address !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new AppError(ErrorCode.ChooseASupportedTransferRoute); });
      const balances = await balanceReader(identity.accountId, undefined, selection ? [selection.origin] : undefined);
      const review = await prepareWithdrawal({ ...body, originAssetId: selection.origin.assetId, destinationAssetId: selection.destination.assetId }, balances, process.env.ONE_CLICK_JWT ?? "", undefined, undefined, catalog, true, await store.read(s => Object.values(s.tokens ?? {})), internalRecipient);
      if ((await requireAccount(store, session)).id !== account.id) throw new AppError(ErrorCode.SessionChanged);
      const options = await generateAuthenticationOptions({
        rpID: deployment.rpId, challenge: Buffer.from(review.challenge, "base64url"), userVerification: "required",
        allowCredentials: [{ id: account.credentialId, transports: account.transports }],
      });
      const raw = await saveChallenge(store, { value: options.challenge, purpose: "withdraw", payload: review.payload,
        withdrawal: review, accountId: account.id, expires: Date.parse(review.deadline) }, ceremony);
      const res = response({ options, review: { ...review, payload: undefined, challenge: undefined } });
      setCookie(res, CEREMONY, raw, { ...cookieOptions(), maxAge: Math.max(1, Math.floor((Date.parse(review.deadline) - Date.now()) / 1000)) });
      return res;
    }
    if (route === "transfers/submit") {
      if (account.kind !== "passkey" || !account.publicKey) throw new AppError(ErrorCode.ConnectAPasskeyFirst);
      if (url.hostname !== deployment.rpId) throw new AppError(ErrorCode.PasskeyOriginRequired, deployment.origin);
      const c = await consumeChallenge(store, ceremony ?? "", "withdraw");
      if (c.accountId !== account.id || !c.payload || !c.withdrawal) throw new AppError(ErrorCode.WithdrawalChallengeMismatch);
      const identity = accountIdentity(account);
      if (c.withdrawal.confidentiality !== "advanced") throw new AppError(ErrorCode.PublicWithdrawalSignaturesAreDisabled);
      validateWithdrawal(c.withdrawal, identity.accountId);
      const catalog = await readCatalog();
      await discoverTokens(store, catalog);
      const selected = [c.withdrawal.originAsset, c.withdrawal.destinationAsset].map(id => catalog.find(a => a.assetId === id));
      if (selected.some(a => !a)) throw new AppError(ErrorCode.TokenOperationUnavailable);
      const reviewed = c.withdrawal.route;
      if (!reviewed) throw new AppError(ErrorCode.TokenOperationUnavailable);
      await store.read(s => { requireToken(s, reviewed.origin, "withdrawals"); requireToken(s, reviewed.destination, "withdrawals"); selected.forEach(a => requireToken(s, a!, "withdrawals")); });
      const chain = c.withdrawal.route?.destination.blockchain ?? (c.withdrawal.asset === "wNEAR" ? "near" : "bsc");
      await store.read(s => { const n = requireNetwork(s, chain, "withdrawals"); const address = c.withdrawal!.destinationWallet; if (c.withdrawal!.destinationChain !== "Confidential Intents" && n.addressKind === "evm" && address !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new AppError(ErrorCode.ChooseASupportedTransferRoute); });
      const assertion = body as unknown as AuthenticationResponseJSON;
      const counter = await verifyAssertion(account, assertion, c.value);
      const signed = encodeAssertion(identity, c.payload, assertion);
      // The reviewed private payload is authorized locally by WebAuthn and
      // submitted only to 1Click. Never disclose it to the public verifier RPC.
      const withdrawalId = randomUUID();
      await store.transaction(s => {
        const current = accountFor(s, session);
        if (!current || current.id !== account.id || current.counter !== account.counter) throw new AppError(ErrorCode.ConcurrentSignatureTryAgain);
        requireNetwork(s, chain, "withdrawals");
        requireToken(s, reviewed.origin, "withdrawals"); requireToken(s, reviewed.destination, "withdrawals");
        selected.forEach(a => requireToken(s, a!, "withdrawals"));
        current.counter = counter;
        s.withdrawals ??= {};
        s.withdrawals[withdrawalId] = { id: withdrawalId, ownerId: account.id, createdAt: Date.now(), updatedAt: Date.now(), state: "signing", review: c.withdrawal! };
      });
      try {
        const published = await publishWithdrawal(signed, process.env.ONE_CLICK_JWT ?? "");
        const withdrawal = await store.transaction(s => {
          const current = s.withdrawals![withdrawalId]; current.state = "submitted"; current.intentHash = published.intentHash; current.updatedAt = nextRevision(current.updatedAt); return current;
        });
        return response({ withdrawal: { ...withdrawal, review: { ...withdrawal.review, payload: undefined, challenge: undefined } } });
      } catch (error) {
        if (error instanceof StorageUnavailableError) throw error;
        await store.transaction(s => { const current = s.withdrawals![withdrawalId]; current.state = "unknown"; current.updatedAt = Date.now(); });
        throw new AppError(ErrorCode.WithdrawalOutcomeIsUnknownCheckItsStatusBeforeRetrying);
      }
    }
    if (route === "transfers/withdrawal-status") {
      const id = typeof body.id === "string" ? body.id : "";
      const withdrawal = await store.read(s => s.withdrawals?.[id]);
      if (!withdrawal || withdrawal.ownerId !== account.id) throw new AppError(ErrorCode.WithdrawalNotFound);
      const status = await readDepositStatus({ depositAddress: withdrawal.review.depositAddress }, process.env.ONE_CLICK_JWT ?? "");
      const updated = await store.transaction(s => {
        const current = s.withdrawals![id];
        if (!canReconcile(current, withdrawal)) return current;
        current.state = operationState(current.state, status.status) as typeof current.state;
        current.originChainTxHashes = mergeHashes(current.originChainTxHashes, status.originChainTxHashes);
        current.destinationChainTxHashes = mergeHashes(current.destinationChainTxHashes, status.destinationChainTxHashes);
        current.updatedAt = nextRevision(current.updatedAt); return current;
      });
      return response({ withdrawal: { ...updated, review: { ...updated.review, payload: undefined, challenge: undefined } }, providerStatus: status.status });
    }
    if (route === "transfers/deposit-status") {
      const id = typeof body.id === "string" ? body.id : "";
      const deposit = await store.read(s => s.deposits?.[id]);
      if (!deposit || deposit.ownerId !== account.id) throw new AppError(ErrorCode.DepositNotFound);
      const status = await readDepositStatus({ depositAddress: deposit.quote.depositAddress, depositMemo: deposit.quote.depositMemo }, process.env.ONE_CLICK_JWT ?? "");
      const updated = await store.transaction(s => {
        const current = s.deposits![id];
        if (!canReconcile(current, deposit)) return current;
        if (!isTerminalDeposit(current.status)) current.status = status.status; if (status.creditedAmount) current.creditedAmount = status.creditedAmount; current.originChainTxHashes = mergeHashes(current.originChainTxHashes, status.originChainTxHashes); current.destinationChainTxHashes = mergeHashes(current.destinationChainTxHashes, status.destinationChainTxHashes); current.updatedAt = nextRevision(current.updatedAt); return current;
      });
      return response({ deposit: updated, providerStatus: updated.status });
    }
  return null;
}
