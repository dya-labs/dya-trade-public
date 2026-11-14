import { z } from "zod";
import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { request } from "./request";
import { balances } from "./schemas/account";
export const prepareConfidentialAccess = () => request("confidential/prepare", z.object({ options: z.custom<PublicKeyCredentialRequestOptionsJSON>() }), {});
export const unlockConfidentialAccess = (assertion: AuthenticationResponseJSON) => request("confidential/unlock", z.object({ unlocked: z.literal(true) }), assertion);
/** Direct ID calls only: also returns all-asset balances, absent when the read failed after unlocking. */
export const unlockConfidentialAccessWithBalances = (assertion: AuthenticationResponseJSON) => request("confidential/unlock?balances=all", z.object({ unlocked: z.literal(true), balances: balances.optional() }), assertion);
export const getConfidentialBalances = () => request("confidential/balances", z.object({ balances: z.array(z.object({ tokenId: z.string(), available: z.string(), source: z.literal("private") })) }), {});
