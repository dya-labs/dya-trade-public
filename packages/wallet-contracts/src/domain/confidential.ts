// Production confidential verifier and treasury documented by NEAR Intents.
export const PRIVATE_VERIFIER = "intents.far";
export const PRIVATE_TREASURY = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
export const PRIVATE_SALT = "e110f317";
export function privateAssetId(assetId: string) { return `imt:${PRIVATE_TREASURY}:${assetId}`; }

export function validatePrivateTransfer(payload: Record<string, unknown>, receiver: string, assetId: string, amount: string) {
  if (payload.verifying_contract !== PRIVATE_VERIFIER || !Array.isArray(payload.intents) || payload.intents.length !== 1)
    throw new Error("Expected one confidential transfer. Public execution is disabled.");
  const nonce = typeof payload.nonce === "string" ? Buffer.from(payload.nonce, "base64") : Buffer.alloc(0);
  if (nonce.length !== 32 || nonce.subarray(0, 9).toString("hex") !== `5628f6c600${PRIVATE_SALT}`)
    throw new Error("Invalid confidential nonce.");
  const intent = payload.intents[0];
  if (!intent || intent.intent !== "transfer" || intent.receiver_id !== receiver ||
      Object.keys(intent).some(k => !["intent", "receiver_id", "tokens"].includes(k)) ||
      !intent.tokens || Object.keys(intent.tokens).length !== 1 || intent.tokens[privateAssetId(assetId)] !== amount)
    throw new Error("Confidential transfer differs from the reviewed amount or recipient.");
}
