import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WalletFrame} from '../../id/components/wallet-frame';
const restores:Array<()=>void>=[];
function property(target:object,key:string,value:unknown){const prior=Object.getOwnPropertyDescriptor(target,key);Object.defineProperty(target,key,{configurable:true,value});restores.push(()=>{if(prior)Object.defineProperty(target,key,prior);else Reflect.deleteProperty(target,key);});}
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();restores.splice(0).reverse().forEach(f=>f());});
function frame(embedded=false,busy=false){const cancel=vi.fn(),view=render(<WalletFrame embedded={embedded} busy={busy} requester="requester.example" title="Synthetic wallet request" onCancel={cancel}><p>Exact request content</p></WalletFrame>);return {...view,cancel};}
it.each([{embedded:false,busy:false},{embedded:false,busy:true},{embedded:true,busy:false},{embedded:true,busy:true}])('wallet frame cancellation embedded=$embedded busy=$busy',({embedded,busy})=>{
  const view=frame(embedded,busy),close=screen.getByRole('button',{name:'Close wallet'});
  expect(screen.getByRole('heading',{name:'Synthetic wallet request',level:1})).toBeVisible();expect(screen.getByText('requester.example')).toHaveAttribute('title','requester.example');expect(screen.getByText('Exact request content')).toBeVisible();
  expect(close).toHaveProperty('disabled',busy);fireEvent.click(close);expect(view.cancel).toHaveBeenCalledTimes(busy?0:1);
  expect(!!screen.queryByRole('dialog',{name:'Synthetic wallet request'})).toBe(embedded);
});
function observer(){
  let notify!:ResizeObserverCallback;const observe=vi.fn(),disconnect=vi.fn();
  vi.stubGlobal('ResizeObserver',class{constructor(callback:ResizeObserverCallback){notify=callback;}observe=observe;disconnect=disconnect;});
  property(window,'opener',{});vi.spyOn(navigator,'userAgent','get').mockReturnValue('Synthetic desktop');
  const resize=vi.spyOn(window,'resizeTo').mockImplementation(()=>{});
  const emit=(height:number,box=true)=>notify([{borderBoxSize:box?[{blockSize:height}]:[],contentRect:{height}} as unknown as ResizeObserverEntry],{} as ResizeObserver);
  return {observe,disconnect,resize,emit};
}
it.each([true,false])('popup frame resizes from border box or content fallback: borderBox=%s',box=>{
  vi.useFakeTimers();const o=observer();frame();expect(o.observe).toHaveBeenCalledOnce();
  act(()=>o.emit(320,box));expect(o.resize).not.toHaveBeenCalled();act(()=>vi.advanceTimersByTime(100));
  expect(o.resize).toHaveBeenCalledWith(window.outerWidth,Math.ceil(320)+24+window.outerHeight-window.innerHeight);
});
it('popup frame coalesces rapid size observations into the latest size',()=>{
  vi.useFakeTimers();const o=observer();frame();act(()=>o.emit(200));act(()=>vi.advanceTimersByTime(50));act(()=>o.emit(400.5));act(()=>vi.advanceTimersByTime(99));expect(o.resize).not.toHaveBeenCalled();act(()=>vi.advanceTimersByTime(1));
  expect(o.resize).toHaveBeenCalledOnce();expect(o.resize).toHaveBeenCalledWith(window.outerWidth,401+24+window.outerHeight-window.innerHeight);
});
it('popup frame disconnects observer and cancels pending resize on unmount',()=>{
  vi.useFakeTimers();const o=observer(),view=frame();act(()=>o.emit(320));view.unmount();act(()=>vi.advanceTimersByTime(100));expect(o.disconnect).toHaveBeenCalledOnce();expect(o.resize).not.toHaveBeenCalled();
});
it.each(['embedded','mobile','no opener','no observer'] as const)('frame skips popup sizing for %s',mode=>{
  vi.useFakeTimers();const o=observer();if(mode==='mobile')vi.spyOn(navigator,'userAgent','get').mockReturnValue('Synthetic iPhone');if(mode==='no opener')property(window,'opener',null);if(mode==='no observer')vi.stubGlobal('ResizeObserver',undefined);
  frame(mode==='embedded');expect(o.observe).not.toHaveBeenCalled();act(()=>vi.advanceTimersByTime(200));expect(o.resize).not.toHaveBeenCalled();
});
