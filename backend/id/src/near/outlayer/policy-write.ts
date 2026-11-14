import { createHash, createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
const signedPolicy = z.object({
 signature_hex:z.string().regex(/^[0-9a-f]{128}$/),
 public_key_hex:z.string().regex(/^(ed25519:)?[0-9a-f]{64}$/),
 version:z.number().int().positive().safe(), locked:z.boolean(),
 valid_until:z.number().int().positive().safe(), policy_hash:z.string().regex(/^[0-9a-f]{64}$/),
});
/** Verify the exact caller/ciphertext signature before constructing a chain call.
 * This is policy-write authorization, not a trading session or custody recovery. */
type ExpectedPolicy = {walletPublicKey:string;controllerId:string;encryptedPolicy:string;policyHash:string};

export function verifyInitialPolicyWrite(input: unknown, expected: ExpectedPolicy, now = Date.now()) {
 return verifyPolicyWrite(input, { ...expected, version: 1 }, now);
}

export function verifyPolicyWrite(input: unknown, expected: ExpectedPolicy & { version: number; locked?: boolean }, now = Date.now()) {
 const value=signedPolicy.parse(input);
 const key=value.public_key_hex.replace(/^ed25519:/,'');
 if(value.locked!==(expected.locked??true) || key!==expected.walletPublicKey || value.version!==expected.version || value.policy_hash!==expected.policyHash)throw new Error('Policy signature does not match the expected wallet, version, or policy.');
 if(value.valid_until*1000<=now+60_000 || value.valid_until*1000>now+8*86400_000)throw new Error('Policy write signature has an invalid deadline.');
 const walletKey=`ed25519:${key}`;
 const message=`store_wallet_policy:v2:${walletKey}:${value.version}:${Number(value.locked)}:${value.valid_until}:${Buffer.byteLength(expected.encryptedPolicy)}:${expected.encryptedPolicy}:${expected.controllerId}`;
 const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(key,'hex')]),format:'der',type:'spki'});
 if(!verify(null,createHash('sha256').update(message).digest(),publicKey,Buffer.from(value.signature_hex,'hex')))throw new Error('Policy write signature is invalid.');
 return {wallet_pubkey:walletKey,encrypted_data:expected.encryptedPolicy,wallet_signature:value.signature_hex,version:value.version,locked:value.locked,valid_until:value.valid_until};
}
