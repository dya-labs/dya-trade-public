import { z } from "zod";
const httpsUrl = z.string().url().refine(value => { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; } }, "Use an HTTPS URL without credentials");
export const networkSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  iconUrl: httpsUrl.or(z.literal("")), explorerUrl: httpsUrl.or(z.literal("")),
  evmChainId: z.number().int().positive().safe().nullable(),
  addressKind: z.enum(["evm", "near", "provider"]),
  status: z.enum(["pending", "approved", "disabled"]),
  deposits: z.boolean(), withdrawals: z.boolean(),
  discoveredAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
  reviewedBy: z.string().optional(), reviewedAt: z.number().int().nonnegative().optional(),
  revision: z.number().int().nonnegative(),
});
export type Network = z.infer<typeof networkSchema>;
export function networkAllowed(network: Network | undefined, direction: "deposits" | "withdrawals") {
  return network?.status === "approved" && network[direction] === true;
}
