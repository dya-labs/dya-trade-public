import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AlertDialogDrawer, AlertDialogDrawerContent, AlertDialogDrawerHeader, AlertDialogDrawerTitle, AlertDialogDrawerDescription, AlertDialogDrawerFooter, AlertDialogDrawerCancel, AlertDialogDrawerAction, AlertDialogDrawerTrigger } from '@dya/ui/components/alert-dialog-drawer';
import { Button } from '@dya/ui/components/button';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function viewport(initial: boolean) {
  let mobile = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ get matches() { return mobile; }, addEventListener: (_: string, cb: () => void) => listeners.add(cb), removeEventListener: (_: string, cb: () => void) => listeners.delete(cb) })));
  return (next: boolean) => act(() => { mobile = next; listeners.forEach(listener => listener()); });
}
function Content({ confirm = () => {} }: { confirm?: () => void }) {
  return <AlertDialogDrawerContent><AlertDialogDrawerHeader><AlertDialogDrawerTitle>Confirm change?</AlertDialogDrawerTitle><AlertDialogDrawerDescription className="sr-only">Review this account change.</AlertDialogDrawerDescription></AlertDialogDrawerHeader><AlertDialogDrawerFooter><AlertDialogDrawerCancel>Cancel</AlertDialogDrawerCancel><AlertDialogDrawerAction onClick={confirm}>Confirm</AlertDialogDrawerAction></AlertDialogDrawerFooter></AlertDialogDrawerContent>;
}
it.each([false, true])('has alert semantics, safe initial focus and explicit async actions: mobile=%s', async mobile => {
  viewport(mobile);
  const confirm = vi.fn(), change = vi.fn();
  render(<AlertDialogDrawer open onOpenChange={change}><Content confirm={confirm} /></AlertDialogDrawer>);
  const dialog = screen.getByRole('alertdialog', { name: 'Confirm change?' });
  expect(dialog).toHaveAccessibleDescription('Review this account change.');
  expect(dialog).toHaveAttribute('data-slot', mobile ? 'drawer-content' : 'dialog-content');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
  fireEvent.pointerDown(document.body);
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(change).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(change).toHaveBeenCalledWith(false);
});
it.each([false, true])('locks actions and Escape while busy: mobile=%s', mobile => {
  viewport(mobile);
  const change = vi.fn(), confirm = vi.fn();
  render(<AlertDialogDrawer open busy onOpenChange={change}><Content confirm={confirm} /></AlertDialogDrawer>);
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
  expect(change).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
});
it('keeps its presentation when resized and restores focus to the trigger', async () => {
  const resize = viewport(true);
  render(<AlertDialogDrawer><AlertDialogDrawerTrigger render={<Button />}>Open confirmation</AlertDialogDrawerTrigger><Content /></AlertDialogDrawer>);
  const trigger = screen.getByRole('button', { name: 'Open confirmation' });
  fireEvent.click(trigger);
  const dialog = screen.getByRole('alertdialog');
  resize(false);
  expect(screen.getByRole('alertdialog')).toBe(dialog);
  expect(dialog).toHaveAttribute('data-slot', 'drawer-content');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Open confirmation' })).toHaveFocus());
});
