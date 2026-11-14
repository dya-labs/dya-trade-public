// @vitest-environment node
import { expect, it, vi } from "vitest";
import { prepareTransfer, nearAccount } from "../../../backend/id/src/near/services/transfers";
import { readConfidentialBalances } from "../../../backend/id/src/near/providers/live";
const accountId="0x"+"a".repeat(40);
it("binds confidential deposit destination and external refund without public transactions",async()=>{
 const p=await prepareTransfer({direction:"deposit",asset:"USDC",amount:"1.000001",wallet:"sender.near",recipient:"attacker.near",confidentiality:"public"},accountId);
 expect(p.request).toMatchObject({amount:"1000001",depositType:"ORIGIN_CHAIN",recipientType:"CONFIDENTIAL_INTENTS",refundType:"ORIGIN_CHAIN",recipient:accountId,refundTo:"sender.near",confidentiality:"basic",dry:true});
 expect(p.transaction).toBeNull(); expect(p.depositAddress).toBeNull(); expect(p.submissionEnabled).toBe(false);
});
it("withdraws only from confidential balance and refunds there",async()=>{
 const p=await prepareTransfer({direction:"withdraw",asset:"NEAR",amount:"0.000000000000000000000001",wallet:"receiver.near"},accountId);
 expect(p.request).toMatchObject({amount:"1",depositType:"CONFIDENTIAL_INTENTS",recipientType:"DESTINATION_CHAIN",refundType:"CONFIDENTIAL_INTENTS",recipient:"receiver.near",refundTo:accountId});
 expect(p.intent).toBeNull();
});
it("does not silently look up public balances when private access is missing",async()=>{
 const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
 try { await expect(readConfidentialBalances(accountId)).rejects.toThrow("Confidential balance unavailable");expect(fetcher).not.toHaveBeenCalled(); } finally { vi.unstubAllGlobals(); }
});
it("rejects invalid accounts, amounts, assets and directions",async()=>{
 for(const id of [accountId,"Alice.near","a","intents.near","x..near"])expect(()=>nearAccount(id)).toThrow();
 for(const patch of [{asset:"ETH"},{amount:"-1"},{amount:"1e2"},{amount:"0.0000001"},{direction:"other"}])
 await expect(prepareTransfer({direction:"deposit",asset:"USDC",amount:"1",wallet:"sender.near",...patch},accountId)).rejects.toThrow();
});
