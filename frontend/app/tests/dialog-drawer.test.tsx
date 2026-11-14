import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DialogDrawer, DialogDrawerContent, DialogDrawerHeader, DialogDrawerTitle, DialogDrawerDescription, DialogDrawerTrigger } from '@dya/ui/components/dialog-drawer';
import { Button } from '@dya/ui/components/button';

afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
function viewport(initial: boolean) {
  let mobile = initial;
  const listeners = new Set<()=>void>();
  vi.stubGlobal('matchMedia',vi.fn().mockImplementation(()=>({get matches(){return mobile;},addEventListener:(_event:string,cb:()=>void)=>listeners.add(cb),removeEventListener:(_event:string,cb:()=>void)=>listeners.delete(cb)})));
  return (next:boolean)=>act(()=>{mobile=next;listeners.forEach(listener=>listener());});
}
function Content() {return <DialogDrawerContent><DialogDrawerHeader><DialogDrawerTitle>Test settings</DialogDrawerTitle><DialogDrawerDescription>Change your preferences</DialogDrawerDescription></DialogDrawerHeader><input aria-label="Draft" defaultValue="saved"/></DialogDrawerContent>;}
it.each([false,true])('uses the correct presentation with accessible labels: mobile=%s',mobile=>{
  viewport(mobile);render(<DialogDrawer open><Content/></DialogDrawer>);
  const dialog=screen.getByRole('dialog',{name:'Test settings'});
  expect(dialog).toHaveAttribute('data-slot',mobile?'drawer-content':'dialog-content');
  expect(dialog).toHaveAccessibleDescription('Change your preferences');
});
it('keeps a mobile draft and presentation mounted while resizing an open drawer',()=>{
  const resize=viewport(true);render(<DialogDrawer open><Content/></DialogDrawer>);
  const input=screen.getByRole('textbox',{name:'Draft'});fireEvent.change(input,{target:{value:'unfinished'}});
  resize(false);
  expect(screen.getByRole('textbox',{name:'Draft'})).toBe(input);
  expect(input).toHaveValue('unfinished');
  expect(screen.getByRole('dialog')).toHaveAttribute('data-slot','drawer-content');
});
it('blocks dismissal while locked, and allows it once unlocked',()=>{
  viewport(true);const change=vi.fn();const view=render(<DialogDrawer open dismissible={false} onOpenChange={change}><Content/></DialogDrawer>);
  fireEvent.keyDown(screen.getByRole('textbox'),{key:'Escape'});expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Close'}));expect(change).not.toHaveBeenCalled();
  view.rerender(<DialogDrawer open dismissible onOpenChange={change}><Content/></DialogDrawer>);
  fireEvent.click(screen.getByRole('button',{name:'Close'}));expect(change).toHaveBeenCalledWith(false,expect.anything());
});
it('restores focus to its trigger after closing a mobile drawer',async()=>{
  viewport(true);render(<DialogDrawer><DialogDrawerTrigger render={<Button/>}>Open settings</DialogDrawerTrigger><Content/></DialogDrawer>);
  const trigger=screen.getByRole('button',{name:'Open settings'});fireEvent.click(trigger);
  expect(screen.getByRole('dialog')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Close'}));
  await waitFor(()=>expect(trigger).toHaveFocus());
});
