import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WalletRecovery } from "../../id/components/wallet-recovery";
const mocks = vi.hoisted(() => ({ connect: vi.fn(), authorize: vi.fn(), authenticate: vi.fn(), approve: vi.fn(), register: vi.fn(), create: vi.fn(), replacement: vi.fn(), sign: vi.fn(), enroll: vi.fn(), recover: vi.fn() }));
vi.mock("../../id/lib/recovery-client", () => ({ connectRecoveryWallet: mocks.connect, recoveryClient: { authorize: mocks.authorize, approve: mocks.approve, register: mocks.register, replacement: mocks.replacement, enroll: mocks.enroll, recover: mocks.recover } }));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: mocks.authenticate, startRegistration: mocks.create }));
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { cleanup();vi.restoreAllMocks(); });
function configure(stage: string) {
  let release!: () => void;const gate = new Promise<void>(resolve => { release=resolve; }),deadline=Date.now()+60000;
  async function step<T>(name: string, value: T): Promise<T> { if(stage===name)await gate;return value; }
  mocks.connect.mockImplementation(() => step("connection", { address: "0x1111111111111111111111111111111111111111", chainId: 1, sign: mocks.sign }));
  mocks.authorize.mockImplementation(() => step("options", { challenge: "synthetic" }));mocks.register.mockImplementation(() => step("options", { challenge: "synthetic" }));
  mocks.authenticate.mockImplementation(() => step("device", { id: "synthetic" }));mocks.create.mockImplementation(() => step("device", { id: "synthetic" }));
  const proof={message:"Synthetic local-only recovery proof",expiresAt:deadline};
  mocks.approve.mockImplementation(() => step("verification",proof));mocks.replacement.mockImplementation(() => step("verification",proof));
  mocks.sign.mockImplementation(() => step("signature","synthetic-signature"));
  mocks.enroll.mockImplementation(() => step("submission",{ok:true,status:"local_test",recoveryId:"synthetic-enrolled"}));mocks.recover.mockImplementation(() => step("submission",{ok:true,status:"local_test"}));
  return { release, deadline };
}
async function reach(mode: "enroll" | "recover", stage: string) {
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));
  if(stage==="connection")return;
  fireEvent.click(await screen.findByRole("button", { name: mode==="enroll" ? "Approve with passkey" : "Create replacement passkey" }));
  if(["options","device","verification"].includes(stage))return;
  fireEvent.click(await screen.findByRole("button", { name: mode==="enroll" ? "Sign and enroll" : "Sign and recover" }));
}
const replacements=(["enroll","recover"]as const).flatMap(mode=>(["connection","options","device","verification","signature","submission"]as const).map(stage=>({mode,stage})));
it.each(replacements)("isolates local $mode recovery replacement during $stage",async({mode,stage})=>{
  const {release}=configure(stage),complete=vi.fn();
  const calls=mode==="enroll"?[mocks.connect,mocks.authorize,mocks.authenticate,mocks.approve,mocks.sign,mocks.enroll]:[mocks.connect,mocks.register,mocks.create,mocks.replacement,mocks.sign,mocks.recover];
  const stop=["connection","options","device","verification","signature","submission"].indexOf(stage);
  const view=render(<WalletRecovery mode={mode} recoveryId="synthetic-old" onComplete={complete} onCancel={()=>{}} />);
  await reach(mode,stage);await waitFor(()=>expect(calls[stop]).toHaveBeenCalledOnce());
  view.rerender(<WalletRecovery mode={mode} recoveryId="synthetic-new" onComplete={complete} onCancel={()=>{}} />);
  expect.soft(screen.queryByRole("button",{name:"Connect recovery wallet"})).not.toBeNull();
  await act(async()=>{release();});
  for(const[i,call]of calls.entries())expect(call).toHaveBeenCalledTimes(i<=stop?1:0);
  expect(screen.getByRole("button",{name:"Connect recovery wallet"})).toBeEnabled();
  expect(screen.queryByRole("button",{name:"Done"})).toBeNull();expect(complete).not.toHaveBeenCalled();
  expect(screen.getByText(/Local test only/)).toBeVisible();
  if(mode==="recover")expect(screen.getByLabelText("Recovery ID")).toHaveValue("synthetic-new");
});
it.each(["enroll","recover"]as const)("blocks local %s mutation when proof expires during wallet signing",async mode=>{
  const {release,deadline}=configure("signature"),complete=vi.fn();
  render(<WalletRecovery mode={mode} recoveryId="synthetic-old" onComplete={complete} onCancel={()=>{}} />);
  await reach(mode,"signature");await waitFor(()=>expect(mocks.sign).toHaveBeenCalledOnce());
  vi.spyOn(Date,"now").mockReturnValue(deadline);
  await act(async()=>{release();});
  expect(mocks.enroll).not.toHaveBeenCalled();expect(mocks.recover).not.toHaveBeenCalled();
  expect(await screen.findByText("Recovery request expired. Start again.")).toBeVisible();
  expect(screen.getByRole("button",{name:"Connect recovery wallet"})).toBeEnabled();
  expect(screen.queryByRole("button",{name:"Done"})).toBeNull();expect(complete).not.toHaveBeenCalled();
});
