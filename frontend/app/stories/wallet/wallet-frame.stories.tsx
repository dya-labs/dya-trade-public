import type {Meta,StoryObj} from '@storybook/react-vite';
import {useState} from 'react';
import {WalletFrame} from '../../../id/components/wallet-frame';
import {WalletReview} from '../../../id/components/wallet-review';
import {Button} from '@dya/ui/components/button';
function FrameFixture({embedded,busy}:{embedded:boolean;busy:boolean}){
  const [closed,setClosed]=useState(false);
  if(closed)return <p role="status">Request closed (fixture)</p>;
  return <WalletFrame embedded={embedded} busy={busy} requester="very-long-synthetic-requester.example" title="Review withdrawal" onCancel={()=>setClosed(true)}>
    <WalletReview review={{title:'Review withdrawal',details:{asset:'USDC',amount:'100',estimatedReceive:'99.80',minimumReceived:'98.80',network:'Base',recipient:'0x1111111111111111111111111111111111111111'}}}/>
    <Button className="w-full" disabled={busy}>{busy?'Confirming…':'Confirm (fixture)'}</Button>
  </WalletFrame>;
}
const meta={title:'ID/WalletFrame',component:FrameFixture,args:{embedded:true,busy:false},render:args=><FrameFixture key={`${args.embedded}:${args.busy}`} {...args}/>}satisfies Meta<typeof FrameFixture>;
export default meta;
type Story=StoryObj<typeof meta>;
export const Embedded:Story={};
export const Busy:Story={args:{busy:true}};
export const Standalone:Story={args:{embedded:false}};
