import type {ReactNode} from 'react';
import {WalletQueryProvider} from '@dya/wallet-ui/components/wallet-query-provider';
import { cleanup,render as renderUI,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach,expect,test,vi } from 'vitest';
import { startAuthentication } from '@simplewebauthn/browser';
import { TradingActivation } from '../../id/components/trading-activation';
import * as client from '../../id/lib/outlayer-activation-client';
vi.mock('../../id/lib/outlayer-activation-client',()=>({readActivation:vi.fn(),prepareActivationReview:vi.fn(),prepareActivationPayment:vi.fn(),submitActivationPayment:vi.fn(),prepareActivationOwner:vi.fn(),submitActivationOwner:vi.fn(),advanceActivation:vi.fn(),refundActivation:vi.fn(),rebroadcastActivation:vi.fn(),discardSetup:vi.fn(),saveSetupPaymentAsset:vi.fn()}));
vi.mock('@simplewebauthn/browser',()=>({startAuthentication:vi.fn()}));
const op:client.ActivationPublic={id:'11111111-1111-4111-8111-111111111111',planHash:'plan',phase:'review',asset:'USDC',maximumPaymentRaw:'2000000',paymentDecimals:6,requiredYoctoNear:'1000000000000000000000000',costs:{initializationMax:'10000000000000000000000',controllerBalances:'10000000000000000000000',policyStorage:'10000000000000000000000',gasReserve:'970000000000000000000000'},controllerId:'controller',recoveryControllerId:'recovery',expiresAt:Date.now()+60000,deliveryAppFeeBps:20,refundedYoctoNear:'0',txHashes:[]};
const status=(activation:client.ActivationPublic|null):client.ActivationStatus=>({pilotEnabled:true,activation});
afterEach(()=>{cleanup();vi.clearAllMocks();});
test('shows capped terms without automatically signing or submitting a payment',async()=>{
 vi.mocked(client.readActivation).mockResolvedValue(status(op));render(<TradingActivation asset="USDC" ready onActivated={vi.fn()}/>);
 expect(await screen.findByRole('button',{name:'Pay and continue'})).toBeEnabled();expect(screen.getByText('Setup fees')).toBeInTheDocument();expect(screen.getByText('Review').closest('li')).toHaveAttribute('aria-current','step');expect(screen.getByText('Activate').closest('li')).not.toHaveAttribute('aria-current');expect(startAuthentication).not.toHaveBeenCalled();expect(client.submitActivationPayment).not.toHaveBeenCalled();
});
test('approved payment switches to settlement tracking without leaving another pay action',async()=>{
 vi.mocked(client.readActivation).mockResolvedValue(status(op));vi.mocked(client.prepareActivationPayment).mockResolvedValue({options:{challenge:'payment-challenge'}});vi.mocked(startAuthentication).mockResolvedValue({id:'assertion'} as never);vi.mocked(client.submitActivationPayment).mockResolvedValue(status({...op,phase:'payment-pending'}));
 const user=userEvent.setup();render(<TradingActivation asset="USDC" ready onActivated={vi.fn()}/>);await user.click(await screen.findByRole('button',{name:'Pay and continue'}));
 expect(await screen.findByText('Waiting for payment')).toBeInTheDocument();expect(client.submitActivationPayment).toHaveBeenCalledExactlyOnceWith({id:'assertion'},undefined);expect(screen.queryByRole('button',{name:'Pay and continue'})).not.toBeInTheDocument();
});
test('controller setup has its own passkey approval after payment',async()=>{
 vi.mocked(client.readActivation).mockResolvedValue(status({...op,phase:'await-owner'}));vi.mocked(client.prepareActivationOwner).mockResolvedValue({options:{challenge:'owner-challenge'}});vi.mocked(startAuthentication).mockResolvedValue({id:'owner'} as never);vi.mocked(client.submitActivationOwner).mockResolvedValue(status({...op,phase:'running',step:0}));
 const user=userEvent.setup();render(<TradingActivation asset="USDC" ready onActivated={vi.fn()}/>);await user.click(await screen.findByRole('button',{name:'Activate account'}));
 expect(await screen.findByText('Activating your account')).toBeInTheDocument();expect(client.submitActivationPayment).not.toHaveBeenCalled();expect(client.submitActivationOwner).toHaveBeenCalledExactlyOnceWith({id:'owner'},undefined);
});
test('partial refunds stay claimable without claiming completion or polling indefinitely',async()=>{
 vi.mocked(client.readActivation).mockResolvedValue(status({...op,phase:'refund',outcome:'active',refundPhase:'owed',refundOwedYoctoNear:'1000000000000000000000',refundedYoctoNear:'900000000000000000000000',reason:'Below provider minimum.'}));render(<TradingActivation asset="USDC" ready onActivated={vi.fn()}/>);
 expect(await screen.findByRole('button',{name:/^Claim refund \([\d.]+ NEAR\)$/})).toBeEnabled();expect(screen.getByRole("button",{name:"Open account"})).toBeEnabled();expect(client.advanceActivation).not.toHaveBeenCalled();
});
test('unknown payment status offers refresh without a replacement debit',async()=>{
 vi.mocked(client.readActivation).mockResolvedValue(status({...op,phase:'payment-pending'}));vi.mocked(client.advanceActivation).mockRejectedValue(new Error('Status unavailable.'));render(<TradingActivation asset="USDC" ready onActivated={vi.fn()}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh status'})).toBeInTheDocument(),{timeout:3500});expect(client.submitActivationPayment).not.toHaveBeenCalled();
});

test('single-passkey review and completion accurately report deferred recovery',async()=>{
 const single={...op,recoveryControllerId:undefined};
 vi.mocked(client.readActivation).mockResolvedValue(status({...single,phase:'refund',outcome:'active',refundPhase:'owed',refundOwedYoctoNear:'1'}));
 render(<TradingActivation asset="USDC" ready onActivated={vi.fn()}/>);
 expect(await screen.findByRole("heading",{name:"Your account is ready"})).toBeInTheDocument();
 expect(screen.queryByText(/Ownership and recovery were checked/)).not.toBeInTheDocument();
});

function render(ui:ReactNode){return renderUI(ui,{wrapper:WalletQueryProvider});}

test('unpaid discard requires confirmation and returns through the supplied callback',async()=>{
 vi.mocked(client.readActivation).mockResolvedValue({...status(null),canDiscard:true});
 vi.mocked(client.prepareActivationReview).mockResolvedValue({...status(op),canDiscard:true});
 vi.mocked(client.discardSetup).mockResolvedValue({...status(null),discarded:true});
 const done=vi.fn();render(<TradingActivation accountId="wallet-a" asset="USDC" ready onActivated={vi.fn()} onDiscarded={done} renderHeader={back=><button onClick={back}>Back</button>}/>);
 const user=userEvent.setup();await screen.findByRole('button',{name:'Pay and continue'});await user.click(screen.getByRole('button',{name:'Back'}));
 expect(client.discardSetup).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button',{name:'Cancel setup'}));
 await waitFor(()=>expect(done).toHaveBeenCalledOnce());expect(client.discardSetup).toHaveBeenCalledExactlyOnceWith('wallet-a');
});
test('resumed setup restores the saved token and paid states never offer discard',async()=>{
 vi.mocked(client.readActivation).mockResolvedValue({...status(null),paymentAsset:'NEAR',canDiscard:true});
 const r=render(<TradingActivation accountId="wallet-a" asset="USDC" ready onActivated={vi.fn()}/>);
 await waitFor(()=>expect(client.prepareActivationReview).toHaveBeenCalledWith('NEAR','wallet-a'));r.unmount();
 vi.mocked(client.readActivation).mockResolvedValue({...status({...op,phase:'payment-pending'}),canDiscard:false});
 render(<TradingActivation accountId="wallet-a" asset="USDC" ready onActivated={vi.fn()}/>);
 expect(await screen.findByText('Waiting for payment')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Cancel setup'})).not.toBeInTheDocument();
});
