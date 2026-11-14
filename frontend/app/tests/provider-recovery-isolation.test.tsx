import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderWalletRecovery } from "../../id/components/provider-wallet-recovery";
const m=vi.hoisted(()=>({connect:vi.fn(),enroll:vi.fn(),discover:vi.fn(),select:vi.fn(),advance:vi.fn(),status:vi.fn(),sign:vi.fn(),authenticate:vi.fn(),create:vi.fn()}));
vi.mock("../../id/lib/recovery-client",()=>({connectRecoveryWallet:m.connect,providerRecoveryClient:{enroll:m.enroll,discover:m.discover,select:m.select,advance:m.advance,status:m.status}}));
vi.mock("@simplewebauthn/browser",()=>({startAuthentication:m.authenticate,startRegistration:m.create}));
beforeEach(()=>{vi.resetAllMocks();localStorage.clear();});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function deferred(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return{promise,release};}
function wallet(){return{address:"0x1111111111111111111111111111111111111111",chainId:1,sign:m.sign};}
function proofStep(kind:string,deadline=Date.now()+60000){
  return kind==="registration"?{phase:"recover_register",expiresAt:deadline,options:{challenge:"synthetic",rp:{name:"Synthetic"},user:{id:"synthetic",name:"Synthetic",displayName:"Synthetic"},pubKeyCredParams:[{type:"public-key",alg:-7}]}}:
    kind==="authentication"?{phase:"recover_finish",expiresAt:deadline,options:{challenge:"synthetic"}}:
    {phase:"recover_discover",expiresAt:deadline,message:"Synthetic recovery ownership proof"};
}
const labels={registration:"Create replacement passkey",authentication:"Finish with new passkey",signature:"Find my accounts"};
function configureProof(kind:keyof typeof labels,stage:string){
  const gate=deferred(),deadline=Date.now()+60000;
  m.connect.mockResolvedValue(wallet());m.discover.mockResolvedValue(proofStep(kind,deadline));
  const native=kind==="registration"?m.create:kind==="authentication"?m.authenticate:m.sign;
  native.mockImplementation(async()=>{if(stage==="proof")await gate.promise;return kind==="signature"?"synthetic-signature":{id:"synthetic"};});
  const next=kind==="signature"?{phase:"recover_select",accounts:[{id:"found",label:"Synthetic found account"}]}:kind==="authentication"?{phase:"complete"}:{phase:"recover_add_pending",pending:true};
  m.advance.mockImplementation(async()=>{if(stage==="advance")await gate.promise;return next;});
  m.select.mockResolvedValue(proofStep("registration"));
  m.status.mockResolvedValue({phase:"recover_add_pending",pending:true});
  return{...gate,native,deadline};
}
const connections=(["enroll","recover"]as const).flatMap(mode=>(["connection","initial request"]as const).map(stage=>({mode,stage})));
it.each(connections)("isolates provider $mode context during $stage",async({mode,stage})=>{
  const gate=deferred(),complete=vi.fn(),initial=mode==="enroll"?m.enroll:m.discover;
  m.connect.mockImplementation(async()=>{if(stage==="connection")await gate.promise;return wallet();});
  initial.mockImplementation(async()=>{if(stage==="initial request")await gate.promise;return{phase:mode==="enroll"?"enroll_ownership":"recover_discover",message:"Synthetic ownership"};});
  const view=render(<ProviderWalletRecovery mode={mode} recoveryId="old" onComplete={complete} onCancel={()=>{}} />);
  fireEvent.click(screen.getByRole("button",{name:"Connect recovery wallet"}));
  await waitFor(()=>expect(stage==="connection"?m.connect:initial).toHaveBeenCalledOnce());
  view.rerender(<ProviderWalletRecovery mode={mode} recoveryId="replacement" onComplete={complete} onCancel={()=>{}} />);
  await act(async()=>{gate.release();});
  expect(m.connect).toHaveBeenCalledOnce();expect(initial).toHaveBeenCalledTimes(stage==="connection"?0:1);
  expect(screen.getByRole("button",{name:"Connect recovery wallet"})).toBeEnabled();expect(complete).not.toHaveBeenCalled();
});
const proofs=(["registration","authentication","signature"]as const).flatMap(kind=>(["proof","advance"]as const).map(stage=>({kind,stage})));
it.each(proofs)("isolates provider $kind context during $stage",async({kind,stage})=>{
  const gate=configureProof(kind,stage),complete=vi.fn();
  const view=render(<ProviderWalletRecovery mode="recover" recoveryId="old" onComplete={complete} onCancel={()=>{}} />);
  fireEvent.click(screen.getByRole("button",{name:"Connect recovery wallet"}));
  fireEvent.click(await screen.findByRole("button",{name:labels[kind]}));
  await waitFor(()=>expect(stage==="proof"?gate.native:m.advance).toHaveBeenCalledOnce());
  view.rerender(<ProviderWalletRecovery mode="recover" recoveryId="replacement" onComplete={complete} onCancel={()=>{}} />);
  localStorage.setItem("dya-id:credential:v1","replacement-hint");
  await act(async()=>{gate.release();});
  expect(m.advance).toHaveBeenCalledTimes(stage==="proof"?0:1);expect(m.select).not.toHaveBeenCalled();
  expect(screen.getByRole("button",{name:"Connect recovery wallet"})).toBeEnabled();
  expect(screen.queryByRole("button",{name:"Done"})).toBeNull();expect(complete).not.toHaveBeenCalled();
  expect(localStorage.getItem("dya-id:credential:v1")).toBe("replacement-hint");
});
it("ignores a retired provider status completion and preserves the replacement credential hint",async()=>{
  const gate=deferred();m.connect.mockResolvedValue(wallet());m.discover.mockResolvedValue({phase:"recover_add_pending",pending:true});
  m.status.mockImplementation(async()=>{await gate.promise;return{phase:"complete"};});
  const view=render(<ProviderWalletRecovery mode="recover" recoveryId="old" onComplete={()=>{}} onCancel={()=>{}} />);
  fireEvent.click(screen.getByRole("button",{name:"Connect recovery wallet"}));fireEvent.click(await screen.findByRole("button",{name:"Check status"}));
  await waitFor(()=>expect(m.status).toHaveBeenCalledOnce());
  view.rerender(<ProviderWalletRecovery mode="recover" recoveryId="replacement" onComplete={()=>{}} onCancel={()=>{}} />);
  localStorage.setItem("dya-id:credential:v1","replacement-hint");
  await act(async()=>{gate.release();});
  expect(screen.getByRole("button",{name:"Connect recovery wallet"})).toBeEnabled();expect(localStorage.getItem("dya-id:credential:v1")).toBe("replacement-hint");
  expect(m.advance).not.toHaveBeenCalled();
});
it("ignores retired automatic account selection when its response arrives after context replacement",async()=>{
  const gate=configureProof("signature","none"),selection=deferred();
  m.select.mockImplementation(async()=>{await selection.promise;return proofStep("registration");});
  const view=render(<ProviderWalletRecovery mode="recover" recoveryId="old" onComplete={()=>{}} onCancel={()=>{}} />);
  fireEvent.click(screen.getByRole("button",{name:"Connect recovery wallet"}));fireEvent.click(await screen.findByRole("button",{name:labels.signature}));
  await waitFor(()=>expect(m.select).toHaveBeenCalledExactlyOnceWith("found"));
  view.rerender(<ProviderWalletRecovery mode="recover" recoveryId="replacement" onComplete={()=>{}} onCancel={()=>{}} />);
  await act(async()=>{selection.release();gate.release();});
  expect(screen.getByRole("button",{name:"Connect recovery wallet"})).toBeEnabled();expect(m.advance).toHaveBeenCalledOnce();
});
it.each(["registration","authentication","signature"]as const)("checks provider proof expiry after %s completion before advancing",async kind=>{
  const gate=configureProof(kind,"proof"),complete=vi.fn();
  render(<ProviderWalletRecovery mode="recover" onComplete={complete} onCancel={()=>{}} />);
  fireEvent.click(screen.getByRole("button",{name:"Connect recovery wallet"}));fireEvent.click(await screen.findByRole("button",{name:labels[kind]}));
  await waitFor(()=>expect(gate.native).toHaveBeenCalledOnce());vi.spyOn(Date,"now").mockReturnValue(gate.deadline);
  await act(async()=>{gate.release();});
  expect(m.advance).not.toHaveBeenCalled();expect(m.status).toHaveBeenCalledOnce();
  expect(await screen.findByRole("button",{name:"Check status"})).toBeEnabled();
  expect(screen.queryByRole("button",{name:"Done"})).toBeNull();expect(complete).not.toHaveBeenCalled();
});
it("treats an explicit zero provider deadline as expired before prompting",async()=>{
  configureProof("authentication","none");m.discover.mockResolvedValue(proofStep("authentication",0));
  render(<ProviderWalletRecovery mode="recover" onComplete={()=>{}} onCancel={()=>{}} />);
  fireEvent.click(screen.getByRole("button",{name:"Connect recovery wallet"}));
  fireEvent.click(await screen.findByRole("button",{name:labels.authentication}));
  await screen.findByRole("button",{name:"Check status"});
  expect(m.authenticate).not.toHaveBeenCalled();expect(m.advance).not.toHaveBeenCalled();expect(m.status).toHaveBeenCalledOnce();
});
