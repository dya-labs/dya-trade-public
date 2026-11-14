import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfidentialAccess } from "@/components/near/confidential-access";
import { WalletMenu } from "@/components/near/wallet-menu";
import { useOrderTicket } from "@/components/near/use-order-ticket";
import { prepareConfidentialAccess, unlockConfidentialAccess } from "@dya/wallet-ui/lib/near/http/confidential-client";
import { startAuthentication } from "@dya/wallet-sdk";
import { ConfidentialAccessRequired } from "@/lib/near/domain/confidential-access-error";
vi.mock("@dya/wallet-ui/lib/near/http/confidential-client",()=>({prepareConfidentialAccess:vi.fn(),unlockConfidentialAccess:vi.fn()}));
vi.mock("@dya/wallet-sdk",()=>({startAuthentication:vi.fn(),connect:vi.fn()}));
vi.mock("@/components/near/use-live-balances",()=>({useBalanceQuery:()=>({data:undefined,error:new ConfidentialAccessRequired(),isFetching:false}),useLiveBalances:()=>({balances:null,balanceError:"",accessRequired:true,loading:false,refresh:vi.fn()})}));
vi.mock("@dya/wallet-ui/hooks/use-wallet-queries",()=>({useCatalogQuery:()=>({data:{assets:[]},error:null})}));
vi.mock("@/components/near/use-market-quote",()=>({MARKET_QUOTE_DEBOUNCE_MS:300,useMarketQuote:()=>({currentQuote:null,currentQuoteError:"",retryQuote:vi.fn()})}));
vi.mock("@/lib/near/http/catalog-client",()=>({getTokenMarkets:async()=>({assets:{}})}));
vi.mock("@/lib/near/http/funding-conversions-client",()=>({fundingHistory:async()=>({operations:[]})}));
vi.mock("@/lib/near/http/transfers-client",()=>({getWithdrawals:async()=>({withdrawals:[]}),getDeposits:async()=>({deposits:[]}),getBridgeDeposits:async()=>({deposits:[]})}));
const clients:QueryClient[]=[];
beforeEach(()=>vi.resetAllMocks());
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());});
const cases=(["panel unmount","ticket unmount","wallet account replacement"]as const).flatMap(actor=>(["prepare","approval","verify"]as const).map(stage=>({actor,stage})));
it.each(cases)("retires Terminal unlock at $actor during $stage",async({actor,stage})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  async function step<T>(name:string,value:T):Promise<T>{if(stage===name)await gate;return value;}
  vi.mocked(prepareConfidentialAccess).mockImplementation(()=>step("prepare",{options:{challenge:"synthetic"}}as Awaited<ReturnType<typeof prepareConfidentialAccess>>));
  vi.mocked(startAuthentication).mockImplementation(()=>step("approval",{id:"synthetic"}as Awaited<ReturnType<typeof startAuthentication>>));
  vi.mocked(unlockConfidentialAccess).mockImplementation(()=>step("verify",{unlocked:true}));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);
  const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const invalidate=vi.spyOn(client,"invalidateQueries"),calls=[prepareConfidentialAccess,startAuthentication,unlockConfidentialAccess,invalidate],stop=["prepare","approval","verify"].indexOf(stage);
  let retire!:()=>void,pending:Promise<void>|undefined;
  if(actor==="ticket unmount"){
    const view=renderHook(()=>useOrderTicket({id:"synthetic-old",kind:"passkey"},4),{wrapper});
    act(()=>{pending=view.result.current.confirmAccess();});retire=()=>view.unmount();
  }else if(actor==="panel unmount"){
    const view=render(<ConfidentialAccess panel />,{wrapper});fireEvent.click(screen.getByRole("button",{name:"Unlock balances"}));retire=()=>view.unmount();
  }else{
    const props={onDeposit:vi.fn(),onWithdraw:vi.fn(),onFunding:vi.fn(),onSignOut:vi.fn(),onActivity:vi.fn()};
    const view=render(<WalletMenu {...props} account={{id:"synthetic-old",kind:"passkey"}} />,{wrapper});
    fireEvent.click(screen.getByRole("button",{name:"Open wallet"}));fireEvent.click(screen.getByRole("button",{name:"Unlock balances"}));
    retire=()=>{view.rerender(<WalletMenu {...props} account={{id:"synthetic-new",kind:"passkey"}} />);expect.soft(screen.queryByRole("button",{name:"Unlock balances"})).not.toBeNull();};
  }
  await waitFor(()=>expect(calls[stop]).toHaveBeenCalledOnce());retire();
  await act(async()=>{release();await pending;});
  for(const[i,call]of calls.entries())expect(call).toHaveBeenCalledTimes(i<=stop?1:0);
  if(actor==="wallet account replacement")expect(screen.getByRole("button",{name:"Unlock balances"})).toBeEnabled();
});
