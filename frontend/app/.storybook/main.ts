import type { StorybookConfig } from '@storybook/react-vite';
import { fileURLToPath } from 'node:url';
const config: StorybookConfig = {
  stories: ['../stories/brand/*.stories.tsx', '../stories/loading/*.stories.tsx', '../stories/icons/*.stories.tsx', '../stories/deposit/*.stories.tsx', '../stories/wallet/*.stories.tsx', '../stories/withdrawal/*.stories.tsx', '../stories/funding/*.stories.tsx', '../stories/orders/*.stories.tsx', '../stories/transfers/*.stories.tsx', '../stories/trades/*.stories.tsx', '../stories/trade-entry/*.stories.tsx'],
  staticDirs: ['../public'],
  framework: { name: '@storybook/react-vite', options: { builder: { viteConfigPath: '.storybook/vite.config.ts' } } },
  async viteFinal(config) {
    const mocks = fileURLToPath(new URL('../stories/deposit/api-mocks.ts', import.meta.url));
    const walletMocks = fileURLToPath(new URL('../stories/wallet/api-mocks.ts', import.meta.url));
    const withdrawalMocks = fileURLToPath(new URL('../stories/withdrawal/api-mocks.ts', import.meta.url));
    const ordersMocks = fileURLToPath(new URL('../stories/orders/api-mocks.ts', import.meta.url));
    config.resolve ??= {};
    config.resolve.dedupe = [...(config.resolve.dedupe ?? []), "react", "react-dom", "@tanstack/react-query"];
    config.resolve.alias = [
      { find: /^(?:\.\.\/)+lib\/near\/http\/request$/, replacement: fileURLToPath(new URL("../stories/wallet/request-mocks.ts", import.meta.url)) },
      { find: "../lib/recovery-client", replacement: fileURLToPath(new URL("../stories/wallet/recovery-api-mocks.ts", import.meta.url)) },
      { find: '@dya/wallet-ui/lib/near/http/confidential-client', replacement: walletMocks },
      { find: '@/lib/near/http/confidential-client', replacement: walletMocks },
      { find: /^(?:\.\.\/)+lib\/near\/http\/catalog-client$/, replacement: mocks },
      { find: /^(?:\.\.\/)+lib\/near\/http\/account-client$/, replacement: walletMocks },
      { find: /^(?:\.\.\/)+lib\/near\/http\/transfers-client$/, replacement: fileURLToPath(new URL('../stories/transfers/api-mocks.ts', import.meta.url)) },
      { find: '@/lib/near/http/account-client', replacement: walletMocks },
      { find: '@/lib/near/http/catalog-client', replacement: mocks },
      { find: '@/lib/near/http/transfers-client', replacement: fileURLToPath(new URL('../stories/transfers/api-mocks.ts', import.meta.url)) },
      { find: "../lib/wallet-client", replacement: fileURLToPath(new URL("../stories/wallet/id-api-mocks.ts", import.meta.url)) },
      { find: '@/lib/near/http/trading-client', replacement: ordersMocks },
      { find: '@simplewebauthn/browser', replacement: withdrawalMocks },
      { find: '@dya/wallet-sdk', replacement: withdrawalMocks },
      { find: '@dya/wallet-ui/lib/near/http/account-client', replacement: walletMocks },
      { find: '@/lib/near/http/funding-conversions-client', replacement: walletMocks },
      { find: '@/lib/near/client/sign-in', replacement: walletMocks },
      { find: '@dya/wallet-ui/lib/near/http/catalog-client', replacement: mocks },
      { find: '@dya/wallet-ui/lib/near/http/transfers-client', replacement: fileURLToPath(new URL('../stories/transfers/api-mocks.ts', import.meta.url)) },
      { find: /^next\/link$/, replacement: fileURLToPath(new URL('./next-link.tsx', import.meta.url)) },
      { find: /^next\/image$/, replacement: fileURLToPath(new URL('./next-image.tsx', import.meta.url)) },
      ...(Array.isArray(config.resolve.alias) ? config.resolve.alias : Object.entries(config.resolve.alias ?? {}).map(([find, replacement]) => ({ find, replacement }))),
    ];
    return config;
  },
};
export default config;
