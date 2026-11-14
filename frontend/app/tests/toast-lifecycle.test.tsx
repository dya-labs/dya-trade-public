import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { Toaster } from '@dya/ui/components/sonner';
import { toast } from '@dya/ui/lib/toast';

// jsdom has no text layout or Web Animations: exercise Torph's real reduced-motion path.
beforeEach(() => {
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
  vi.stubGlobal('matchMedia', vi.fn((media: string) => ({ matches: true, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); });
afterEach(() => { act(() => { toast.dismiss(); }); cleanup(); vi.unstubAllGlobals(); });
it('updates one operation in place and preserves unrelated loading toasts', async () => {
  render(<Toaster theme="dark" />);
  act(() => {
    toast.loading('Saving first', { id: 'first' });
    toast.loading('Saving first again', { id: 'first' });
    toast.loading('Saving second', { id: 'second' });
  });
  await screen.findByText('Saving first again');
  const initial = screen.getByText('Saving first again').closest('[data-sonner-toast]')!;
  const icon = initial.querySelector('.toast-transition-icon');
  const morph = initial.querySelector('.toast-transition-message');
  expect(initial.getAttribute('data-dismissible')).toBe('false');
  act(() => { toast.success('First saved', { id: 'first' }); });
  await screen.findByText('First saved');
  expect(screen.getByText('First saved').closest('[data-sonner-toast]')).toBe(initial);
  expect(initial.querySelector('.toast-transition-icon')).toBe(icon);
  expect(initial.querySelector('.toast-transition-message')).toBe(morph);
  expect(morph).toHaveTextContent('First saved');
  expect(morph).not.toHaveTextContent('Saving first again');
  expect(icon).toHaveAttribute('data-complete', 'true');
  expect(icon).toHaveAttribute('data-outcome', 'success');
  expect(screen.getByText('Saving second')).toBeInTheDocument();
  expect(initial.getAttribute('data-dismissible')).toBe('true');
  expect(initial.querySelector('[data-close-button]')).toBeNull();
});
it('uses the error morph for a pending operation, and clears pending state on dismissal', async () => {
  render(<Toaster theme="dark" />);
  let id!: string | number;
  act(() => { id = toast.loading('Connecting'); });
  await screen.findByText('Connecting');
  act(() => { toast.error('Connection failed', { id }); });
  const text = await screen.findByText('Connection failed');
  expect(text.closest('[data-sonner-toast]')!.querySelector('.toast-transition-icon')).toHaveAttribute('data-outcome', 'error');
  act(() => { toast.loading('Another request', { id: 'dismissed' }); });
  await screen.findByText('Another request');
  act(() => { toast.dismiss('dismissed'); toast.success('Standalone success', { id: 'dismissed' }); });
  await waitFor(() => expect(screen.getByText('Standalone success').closest('[data-sonner-toast]')).toHaveAttribute('data-type', 'success'));
});

it('can repeat a lifecycle with the same ID and preserves rich messages', async () => {
  render(<Toaster theme="dark" />);
  act(() => { toast.loading('Working', { id: 'reused' }); });
  await screen.findByText('Working');
  act(() => { toast.success('Done', { id: 'reused' }); });
  await screen.findByText('Done');
  act(() => { toast.loading('Working again', { id: 'reused' }); });
  await screen.findByText('Working again');
  act(() => { toast.error(<strong>Try again</strong>, { id: 'reused' }); });
  expect((await screen.findByText('Try again')).tagName).toBe('STRONG');
});
