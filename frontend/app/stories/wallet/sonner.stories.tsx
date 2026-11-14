import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef } from 'react';
import { Button } from '@dya/ui/components/button';
import { toast } from '@dya/ui/lib/toast';
import { TOAST_MESSAGES, TOAST_ACTIONS } from "@dya/config";

type GalleryProps = { persistent: boolean; position: 'bottom-right' | 'bottom-center' | 'top-right' | 'top-center' };
type Preview = {
  options: { duration: number; position: GalleryProps['position'] };
  remember: (id: string | number) => string | number;
  later: (show: () => void) => void;
};
const examples: { name: string; show: (preview: Preview) => void }[] = [
  { name: 'Default', show: ({ remember, options }) => remember(toast(TOAST_MESSAGES.accountReady, options)) },
  { name: 'Success', show: ({ remember, options }) => remember(toast.success(TOAST_MESSAGES.changesSaved, options)) },
  { name: 'Info', show: ({ remember, options }) => remember(toast.info(TOAST_MESSAGES.networkAvailable, options)) },
  { name: 'Warning', show: ({ remember, options }) => remember(toast.warning(TOAST_MESSAGES.sessionEnding, options)) },
  { name: 'Error', show: ({ remember, options }) => remember(toast.error(TOAST_MESSAGES.connectionFailed, options)) },
  { name: 'Loading', show: ({ remember, options }) => remember(toast.loading(TOAST_MESSAGES.connecting, options)) },
  { name: 'Action', show: ({ remember, options }) => remember(toast(TOAST_MESSAGES.changesSaved, { ...options, action: { label: TOAST_ACTIONS.undo, onClick: () => { remember(toast.info(TOAST_MESSAGES.changeUndone, options)); } } })) },
  { name: 'Cancel action', show: ({ remember, options }) => remember(toast(TOAST_MESSAGES.keepChanges, { ...options, action: { label: TOAST_ACTIONS.keep, onClick: () => {} }, cancel: { label: TOAST_ACTIONS.cancel, onClick: () => {} } })) },
  { name: 'Loading → success', show: ({ remember, later, options }) => {
    const id = remember(toast.loading(TOAST_MESSAGES.savingChanges, options));
    later(() => { toast.success(TOAST_MESSAGES.changesSaved, { ...options, id }); });
  } },
  { name: 'Loading → error', show: ({ remember, later, options }) => {
    const id = remember(toast.loading(TOAST_MESSAGES.savingChanges, options));
    later(() => { toast.error(TOAST_MESSAGES.saveFailed, { ...options, id }); });
  } },
  { name: 'Long content', show: ({ remember, options }) => remember(toast.error(TOAST_MESSAGES.requestFailed, options)) },
];
function ToastGallery({ persistent, position }: GalleryProps) {
  const ids = useRef(new Set<string | number>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { ids.current.forEach(id => toast.dismiss(id)); timers.current.forEach(clearTimeout); }, []);
  const remember = (id: string | number) => { ids.current.add(id); return id; };
  const later = (show: () => void) => { timers.current.push(setTimeout(show, 1500)); };
  const options = { duration: persistent ? Infinity : 5000, position };
  const clear = () => { ids.current.forEach(id => toast.dismiss(id)); ids.current.clear(); timers.current.forEach(clearTimeout); timers.current = []; };
  return <main className="min-h-dvh space-y-8 bg-background p-6 text-foreground">
    <header className="space-y-2"><h1 className="text-xl font-medium">Sonner toast gallery</h1><p className="text-sm text-muted-foreground">Shared production Toaster, icons and theme. Click a variant to preview it; use the Storybook theme toolbar for light/dark.</p></header>
    <section className="space-y-3"><h2 className="font-medium">Variants and content</h2><div className="flex max-w-3xl flex-wrap gap-3">{examples.map(example => <Button key={example.name} variant="outline" onClick={() => example.show({ remember, later, options })}>{example.name}</Button>)}</div></section>
    <section className="space-y-3"><h2 className="font-medium">Sign-in states</h2><p className="text-sm text-muted-foreground">Presentation previews only; these controls do not open a wallet or start authentication.</p><div className="flex flex-wrap gap-3">
      <Button variant="outline" onClick={() => { remember(toast.loading(TOAST_MESSAGES.idWindow, { position, duration: Infinity, dismissible: false })); }}>ID popup open</Button>
      <Button variant="outline" onClick={() => {
        const show = () => remember(toast.error(TOAST_MESSAGES.signInExpired, { ...options, action: { label: TOAST_ACTIONS.retry, onClick: () => { remember(toast.loading(TOAST_MESSAGES.idWindow, { position, duration: Infinity, dismissible: false })); } } }));
        show();
      }}>Session expired + retry</Button>
    </div></section>
    <Button variant="secondary" onClick={clear}>Dismiss all previews</Button>
  </main>;
}
const meta = {
  title: 'Shared/Sonner', component: ToastGallery,
  args: { persistent: true, position: 'bottom-right' },
  argTypes: { persistent: { control: 'boolean' }, position: { control: 'select', options: ['bottom-right', 'bottom-center', 'top-right', 'top-center'] } },
} satisfies Meta<typeof ToastGallery>;
export default meta;
export const Gallery: StoryObj<typeof meta> = {};
