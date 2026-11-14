import {expect,it} from 'vitest';
import {render,screen} from '@testing-library/react';
import {WalletRecovery} from '../../id/components/wallet-recovery';
it.each([false,true])('focuses visible recovery heading on entry,provider=%s',provider=>{
  render(<WalletRecovery provider={provider} mode="recover" onComplete={()=>{}} onCancel={()=>{}}/>);
  expect(screen.getByRole('heading',{level:2})).toHaveFocus();
});
it.each([false,true])('hidden recovery heading preserves enclosing-view focus,provider=%s',provider=>{
  const view=render(<div><button>Enclosing control</button></div>);
  const control=screen.getByRole('button',{name:'Enclosing control'});control.focus();
  view.rerender(<div><button>Enclosing control</button><WalletRecovery provider={provider} hideHeading mode="recover" onComplete={()=>{}} onCancel={()=>{}}/></div>);
  expect(screen.queryByRole('heading',{level:2})).toBeNull();expect(control).toHaveFocus();
});
