import { expect, test } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { verifyInitialPolicyWrite } from '../src/near/outlayer/policy-write';
function fixture() {
 const pair=generateKeyPairSync('ed25519'),now=1800000000000;
 const key=pair.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex');
 const expected={walletPublicKey:key,controllerId:`0s${'a'.repeat(40)}`,encryptedPolicy:Buffer.from('ciphertext').toString('base64'),policyHash:'b'.repeat(64)};
 const body={public_key_hex:key,version:1,locked:true,valid_until:Math.floor(now/1000)+3600,policy_hash:expected.policyHash,signature_hex:''};
 const message=`store_wallet_policy:v2:ed25519:${key}:1:1:${body.valid_until}:${Buffer.byteLength(expected.encryptedPolicy)}:${expected.encryptedPolicy}:${expected.controllerId}`;
 body.signature_hex=sign(null,createHash('sha256').update(message).digest(),pair.privateKey).toString('hex');
 return {body,expected,now};
}
test('verifies a caller-bound initial policy write and preserves exact signed call arguments',()=>{
 const f=fixture(),write=verifyInitialPolicyWrite(f.body,f.expected,f.now);
 expect(write).toMatchObject({wallet_pubkey:`ed25519:${f.expected.walletPublicKey}`,encrypted_data:f.expected.encryptedPolicy,version:1,locked:true,valid_until:f.body.valid_until});
});
test.each(['controllerId','encryptedPolicy','walletPublicKey','policyHash'] as const)('rejects altered %s',field=>{
 const f=fixture();
 expect(()=>verifyInitialPolicyWrite(f.body,{...f.expected,[field]:field==='walletPublicKey'?'c'.repeat(64):`${f.expected[field]}changed`},f.now)).toThrow();
});
test.each([{version:2},{locked:false},{valid_until:1},{signature_hex:'0'.repeat(128)},{status:'pending_approval'}])('rejects invalid or pending initial policy response %j',change=>{
 const f=fixture();
 const value='status' in change?change:{...f.body,...change};
 expect(()=>verifyInitialPolicyWrite(value,f.expected,f.now)).toThrow();
});
