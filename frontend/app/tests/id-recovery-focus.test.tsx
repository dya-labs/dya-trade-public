import {afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {WalletDashboard} from '../../id/components/wallet-dashboard';
const mocks=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('@dya/wallet-ui/lib/near/http/request',()=>({request:mocks.request}));
vi.mock('next/image',()=>({default:(props:{src:string;alt:string})=><img src={props.src} alt={props.alt}/> }));
vi.mock('../../id/components/wallet-recovery',()=>({WalletRecovery:({onCancel}:{onCancel:()=>void})=><button onClick={onCancel}>Back from recovery</button>}));
afterEach(()=>vi.resetAllMocks());
it.each(['provider','local_test'])('restores signed-out recovery trigger focus after Back in %s mode',async recoveryMode=>{
  mocks.request.mockResolvedValue({account:null,recoveryMode,passkeyOrigin:'https://id.example.test'});
  render(<WalletDashboard/>);
  const trigger=await screen.findByRole('button',{name:'Recover'});
  trigger.focus();fireEvent.click(trigger);
  const back=screen.getByRole('button',{name:'Back from recovery'});back.focus();fireEvent.click(back);
  expect(screen.getByRole('button',{name:'Recover'})).toHaveFocus();
  expect(mocks.request.mock.calls.every(([path])=>path==='state')).toBe(true);
});
