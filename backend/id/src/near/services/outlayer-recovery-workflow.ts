import { generateAuthenticationOptions, generateRegistrationOptions, verifyRegistrationResponse, type AuthenticationResponseJSON, type RegistrationResponseJSON, type AuthenticatorTransport } from '@simplewebauthn/server';
import type { OutlayerRecoveryEnrollment } from '../../../../../packages/wallet-contracts/src/domain/outlayer-setup';
import { AppError, ErrorCode } from '../../../../../packages/wallet-contracts/src/domain/errors';
import { verifyAssertion } from '../auth/passkeys';
import { accountFor, consumeChallenge, hash, type Account, type Challenge, type State } from '../repositories/store';
import { nextRecoveryEnrollment } from '../outlayer/recovery';
import { ownerPlan } from '../outlayer/owner';
import { CEREMONY, cookieOptions, response, saveChallenge, setCookie, type AccountWorkflowContext } from './workflow-context';

const TTL = 300_000;
const invalid = () => new AppError(ErrorCode.InvalidRequest);
function bound(s: State, context: AccountWorkflowContext, flow: OutlayerRecoveryEnrollment) {
  const a = accountFor(s, context.session);
  if (!a || a.id !== context.account.id || a.localRecovery || a.providerRecovery?.operation && !['complete','rejected'].includes(a.providerRecovery.operation.phase)) throw invalid();
  if (flow.sessionHash !== hash(context.session!) || a.credentialId !== flow.sourceCredentialId || a.publicKey !== flow.sourcePublicKey || a.outlayerRecovery) throw invalid();
  return a;
}
function duplicate(s: State, credential: { id: string; publicKey: string }) {
  return Object.values(s.accounts).some(a => [
    { id:a.credentialId, publicKey:a.publicKey },
    a.backup,
    a.outlayerRecovery,
    a.providerRecovery?.operation?.pendingCredential,
  ].some(c => c && (c.id === credential.id || c.publicKey === credential.publicKey)));
}
async function issue(context: AccountWorkflowContext, flow: OutlayerRecoveryEnrollment, value: string, options: unknown) {
  const raw = await saveChallenge(context.store, { purpose:'outlayer-recovery', accountId:context.account.id, value, expires:Date.now()+TTL, outlayerRecovery:flow }, context.ceremony);
  const result=response({ options, phase:flow.phase });
  setCookie(result,CEREMONY,raw,{...cookieOptions(),maxAge:TTL/1000});
  return result;
}
/** Only stages a possession-tested recovery credential. No controller extension,
 * provider permission, new login credential, payment or NEAR write is installed. */
export async function runOutlayerRecovery(context: AccountWorkflowContext, verifier = verifyAssertion, registrationVerifier = verifyRegistrationResponse) {
  const {route,account,store,body,deployment}=context;
  if (!route.startsWith('outlayer/recovery/')) return null;
  if (!account.credentialId || !account.publicKey || account.outlayerRecovery) throw invalid();
  if (route==='outlayer/recovery/prepare') {
    if (Object.keys(body).length) throw invalid();
    const flow:OutlayerRecoveryEnrollment={phase:'authorize',sourceCredentialId:account.credentialId,sourcePublicKey:account.publicKey,sessionHash:hash(context.session!)};
    await store.read(s=>bound(s,context,flow));
    const options=await generateAuthenticationOptions({rpID:deployment.rpId,userVerification:'required',allowCredentials:[{id:account.credentialId,transports:account.transports}]});
    return issue(context,flow,options.challenge,options);
  }
  const c:Challenge=await consumeChallenge(store,context.ceremony??'','outlayer-recovery');
  const flow=c.outlayerRecovery;
  if (!flow || c.accountId!==account.id) throw invalid();
  const current=await store.read(s=>bound(s,context,flow));
  if (route==='outlayer/recovery/authorize' && flow.phase==='authorize') {
    const counter=await verifier(current,body as unknown as AuthenticationResponseJSON,c.value);
    await store.transaction(s=>{const a=bound(s,context,flow);if(a.counter!==current.counter)throw invalid();a.counter=counter;});
    const options=await generateRegistrationOptions({rpName:'DYA Trading recovery',rpID:deployment.rpId,userID:new TextEncoder().encode(`outlayer-recovery:${account.id}`),userName:`Trading recovery ${account.id.slice(0,8)}`,supportedAlgorithmIDs:[-7],attestationType:'none',authenticatorSelection:{residentKey:'required',userVerification:'required'},excludeCredentials:[{id:account.credentialId,transports:account.transports},...(account.backup?[{id:account.backup.id}]:[])]});
    return issue(context,nextRecoveryEnrollment(flow,{type:'authorized'})!,options.challenge,options);
  }
  if (route==='outlayer/recovery/register' && flow.phase==='register') {
    const verified=await registrationVerifier({response:body as unknown as RegistrationResponseJSON,expectedChallenge:c.value,expectedOrigin:deployment.origin,expectedRPID:deployment.rpId,requireUserVerification:true,supportedAlgorithmIDs:[-7]});
    if (!verified.verified || !verified.registrationInfo) throw invalid();
    const credential=verified.registrationInfo.credential;
    const candidate={id:credential.id,publicKey:Buffer.from(credential.publicKey).toString('base64url'),counter:credential.counter,transports:credential.transports?.filter((value): value is AuthenticatorTransport => ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"].includes(value))};
    ownerPlan(candidate.publicKey); // Reject unsupported/invalid COSE keys before saving.
    if (await store.read(s=>duplicate(s,candidate))) throw invalid();
    const next=nextRecoveryEnrollment(flow,{type:'registered',candidate});
    if(!next)throw invalid();
    const options=await generateAuthenticationOptions({rpID:deployment.rpId,userVerification:'required',allowCredentials:[{id:candidate.id,transports:candidate.transports}]});
    return issue(context,next,options.challenge,options);
  }
  if (route==='outlayer/recovery/test' && flow.phase==='test') {
    const candidate:Account={id:account.id,kind:'passkey',credentialId:flow.candidate.id,publicKey:flow.candidate.publicKey,counter:flow.candidate.counter,transports:flow.candidate.transports};
    const counter=await verifier(candidate,body as unknown as AuthenticationResponseJSON,c.value);
    const next=nextRecoveryEnrollment(flow,{type:'tested',counter});
    if(next?.phase!=='prepared')throw invalid();
    await store.transaction(s=>{
      const a=bound(s,context,flow);
      if(duplicate(s,next.candidate))throw invalid();
      a.outlayerRecovery={phase:'prepared',...next.candidate,sourceCredentialId:flow.sourceCredentialId,sourcePublicKey:flow.sourcePublicKey,verifiedAt:Date.now(),authority:'full-owner'};
    });
    const result=response({recovery:{status:'prepared' as const,authority:'full-owner' as const,installedOnChain:false as const}});
    setCookie(result,CEREMONY,'',{...cookieOptions(),maxAge:0});
    return result;
  }
  throw invalid();
}
