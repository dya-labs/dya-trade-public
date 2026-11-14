import { Toaster } from '@dya/ui/components/sonner';
import type { Preview } from '@storybook/react-vite';
import '../src/globals.css';
const preview: Preview = {
  parameters: { options: { storySort: { order: ['Brand', 'Shared', 'ID', 'App'] } }, layout: 'fullscreen' },
  globalTypes: { theme: { toolbar: { icon: 'paintbrush', items: ['light', 'dark'] } } },
  initialGlobals: { theme: 'dark' },
  decorators: [(Story, context) => {
    document.documentElement.classList.add('antialiased');
    document.documentElement.classList.toggle('dark', context.globals.theme === 'dark');
    return <><Story /><Toaster theme={context.globals.theme === "light" ? "light" : "dark"} /></>;
  }],
};
export default preview;
