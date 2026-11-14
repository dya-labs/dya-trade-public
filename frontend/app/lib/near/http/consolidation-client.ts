import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { request } from "./request";
import { authenticationOptions } from "./schemas/account";
import { consolidationReview, consolidationOperation } from "./schemas/consolidation";
export const prepareFunding = (inputs: { assetId: string; amount: string }[], skipUnavailable = false) => request("funding/prepare", z.object({ options: authenticationOptions, review: consolidationReview }), { inputs, skipUnavailable });
export const submitFunding = (assertion: AuthenticationResponseJSON) => request("funding/submit", z.object({ operation: consolidationOperation }), assertion);
export const fundingHistory = () => request("funding/history", z.object({ operations: z.array(consolidationOperation) }), {});
export const fundingStatus = (id: string) => request("funding/status", z.object({ operation: consolidationOperation }), { id });
