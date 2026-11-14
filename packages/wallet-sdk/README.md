# Internal DYA wallet SDK

Private, unpublished workspace packages: `@dya/wallet-sdk` and `@dya/wallet-react`. The integration targets DYA Terminal only; the server bridge must be installed/configured by the app. It is not an external developer SDK.

```tsx
import { DyaProvider, WalletButton, useDya } from '@dya/wallet-react';

function App() {
  return <DyaProvider><WalletButton /></DyaProvider>;
}
// Inside the provider: await useDya().connect(); await useDya().disconnect();
```

The provider renders the shared Terminal dialog from `@dya/ui` with wallet-owned content. Unsupported embedding and frame readiness timeout open the same DYA ID request in a separate desktop popup or mobile tab. Terminal remains open and its pending promise resumes on completion; closing the popup cancels it. Blocked popups show an explicit retry action. Without a provider, popup/tab is the default (blocked popups report an error). Origins/callbacks come from server configuration, not app-supplied URLs.

Terminal prepare/submit services use the SDK's internal `startAuthentication` / `startRegistration` adapters. These return opaque receipts, not WebAuthn assertions. The app BFF exchanges receipts for the server-recorded result of the exact prepared operation. Passkey signing and confidential credentials stay on DYA ID.
