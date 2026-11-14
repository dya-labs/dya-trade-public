import { bridgeRoutes, bridgeAddress, bridgeDeposits } from "./schemas/bridge";
import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { request } from "./request";
import { authenticationOptions } from "./schemas/account";
import { depositStatus } from "./schemas/common";
import * as schema from "./schemas/transfers";

type TransferInput = { wallet: string; amount: string; internalAccountId?: string };
export const prepareDeposit = (body: { sourceAssetId: string; targetAssetId: string; tradingWalletId?: string; wallet?: string }) => request("transfers/preview", schema.trackedDepositQuote, { ...body, direction: "deposit" });
export const prepareWithdrawal = (body: TransferInput & ({ asset: "USDC" | "wNEAR" } | { originAssetId: string; destinationAssetId: string })) => request("transfers/preview", z.object({ options: authenticationOptions, review: schema.withdrawalReview }), { ...body, direction: "withdraw" });
export const submitWithdrawal = (body: AuthenticationResponseJSON) => request("transfers/submit", z.object({ withdrawal: schema.withdrawal }), body);
export const getWithdrawals = (signal?: AbortSignal) => request("transfers/withdrawals", z.object({ withdrawals: z.array(schema.withdrawal.extend({ counterpartyAvatarSeed: z.string().optional(), counterpartyIsTrading: z.boolean().optional(), counterpartyName: z.string().optional() })) }), undefined, signal);
const internalReceipt = schema.deposit.pick({ id: true, createdAt: true, status: true, creditedAmount: true, originChainTxHashes: true }).extend({
  counterpartyAvatarSeed: z.string().optional(), counterpartyIsTrading: z.boolean().optional(), counterpartyName: z.string().optional(),
  quote: schema.depositQuote.pick({ asset: true, sourceChain: true, sourceAssetId: true, sourceNetwork: true }),
});
export const getDeposits = (signal?: AbortSignal) => request("transfers/deposits", z.object({ deposits: z.array(schema.deposit), internalReceipts: z.array(internalReceipt).optional() }), undefined, signal);
export const getWithdrawalStatus = (id: string, signal?: AbortSignal) => request("transfers/withdrawal-status", z.object({ withdrawal: schema.withdrawal }), { id }, signal);
export const getDepositStatus = (id: string, signal?: AbortSignal) => request("transfers/deposit-status", z.object({ deposit: schema.deposit, providerStatus: depositStatus }), { id }, signal);

export const getBridgeRoutes = (signal?: AbortSignal) => request("bridge/routes", bridgeRoutes, undefined, signal);
export const getBridgeAddress = (assetId: string) => request("bridge/address", bridgeAddress, { assetId });
export const getBridgeDeposits = (signal?: AbortSignal) => request("bridge/deposits", bridgeDeposits, {}, signal);
