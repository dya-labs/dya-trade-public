import {toast} from '@dya/ui/lib/toast';
import {TOAST_MESSAGES} from '@dya/config';
import type {ReactNode} from 'react';
import {WalletQueryProvider} from '@dya/wallet-ui/components/wallet-query-provider';
import {cleanup,render as renderUI,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,test,vi} from 'vitest';
import {TradingSetup} from '../../id/components/trading-setup';
import * as setup from '../../id/lib/outlayer-client';
import * as activation from '../../id/lib/outlayer-activation-client';
import {startAuthentication} from '@simplewebauthn/browser';
const replace=vi.hoisted(()=>vi.fn());
vi.mock('@dya/ui/lib/toast',()=>({toast:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({replace})}));
vi.mock('../../id/lib/outlayer-client',()=>({readTradingSetup:vi.fn(),prepareOwnerCheck:vi.fn(),verifyOwnerCheck:vi.fn(),prepareSetupQuote:vi.fn(),createTradingAccount:vi.fn(),resumeTradingAccount:vi.fn()}));
vi.mock('../../id/lib/outlayer-activation-client',()=>({readActivation:vi.fn(),prepareActivationReview:vi.fn()}));
vi.mock('@simplewebauthn/browser',()=>({startAuthentication:vi.fn()}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const empty={pilotEnabled:true,activation:null};
test('one review action prepares policy and capped payment, without automatically signing or paying',async()=>{
 vi.mocked(activation.readActivation).mockResolvedValue(empty);
 vi.mocked(setup.readTradingSetup).mockResolvedValue({setup:{owner:'verified'}} as never);
 vi.mocked(setup.prepareSetupQuote).mockResolvedValue({quote:{status:'estimated',actualPolicyPrepared:true}} as never);
 vi.mocked(activation.prepareActivationReview).mockResolvedValue(empty);
 render(<TradingSetup accountId="wallet-a"/>);
 await waitFor(()=>expect(activation.prepareActivationReview).toHaveBeenCalledWith('USDC','wallet-a'));
 expect(setup.prepareSetupQuote).toHaveBeenCalledWith('USDC','wallet-a');
 expect(startAuthentication).not.toHaveBeenCalled();
 expect(screen.queryByRole('button',{name:'Estimate setup cost'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Add recovery passkey'})).not.toBeInTheDocument();
});
test('policy preparation failure cannot advance to payment review',async()=>{
 vi.mocked(activation.readActivation).mockResolvedValue(empty);
 vi.mocked(setup.readTradingSetup).mockResolvedValue({setup:{owner:'verified'}} as never);
 vi.mocked(setup.prepareSetupQuote).mockResolvedValue({quote:{status:'unavailable',reason:'Policy unavailable. No payment was made.'}} as never);
 render(<TradingSetup accountId="wallet-a"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('No payment was made');
 expect(activation.prepareActivationReview).not.toHaveBeenCalled();
});
test('named additional account creation is explicit and does not prepare a wallet or payment on mount',async()=>{
 vi.mocked(setup.createTradingAccount).mockResolvedValue({account:{id:'new-wallet',name:'Strategy'}});
 vi.mocked(setup.resumeTradingAccount).mockResolvedValue({account:null});
 vi.mocked(activation.readActivation).mockResolvedValue({pilotEnabled:false,activation:null});
 render(<TradingSetup createNew/>);const user=userEvent.setup();
 expect(setup.createTradingAccount).not.toHaveBeenCalled();
 await user.type(await screen.findByRole('textbox',{name:'Name'}),'Strategy');
 await user.click(screen.getByRole('button',{name:'Payment token'}));
 await user.click(screen.getByRole('button',{name:'NEAR'}));
 await user.click(screen.getByRole('button',{name:'Continue'}));
 await waitFor(()=>expect(activation.readActivation).toHaveBeenCalledWith('new-wallet'));
 expect(setup.createTradingAccount).toHaveBeenCalledWith(expect.any(String),'Strategy','NEAR');
 expect(replace).not.toHaveBeenCalled();expect(startAuthentication).not.toHaveBeenCalled();expect(toast).not.toHaveBeenCalled();
});

function render(ui:ReactNode){return renderUI(ui,{wrapper:WalletQueryProvider});}

test('Create account resumes a pending setup without showing another name form or creating a record',async()=>{
 vi.mocked(setup.resumeTradingAccount).mockResolvedValue({account:{id:'pending-wallet',name:'Existing'}});
 vi.mocked(activation.readActivation).mockResolvedValue({pilotEnabled:false,activation:null});
 render(<TradingSetup createNew/>);
 await waitFor(()=>expect(activation.readActivation).toHaveBeenCalledWith('pending-wallet'));
 expect(toast).toHaveBeenCalledExactlyOnceWith(TOAST_MESSAGES.accountDraftResumed,{id:'account-draft-resumed:pending-wallet'});
 expect(setup.createTradingAccount).not.toHaveBeenCalled();expect(screen.queryByRole('textbox',{name:'Name'})).not.toBeInTheDocument();
});
