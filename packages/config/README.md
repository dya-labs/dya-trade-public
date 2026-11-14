# @dya/config

Shared public configuration for DYA apps. Import `DYA_URLS` from `@dya/config` for links to the app, ID, docs, X profile (`x`), X follow intent (`xFollow`), and Telegram (`telegram`). The app, ID and docs links read `DYA_APP_URL`, `DYA_ID_URL` and `DYA_DOCS_URL` and default to the local dev servers (`http://localhost:3100`, `:3101`, `:3105`). Server code and Node build scripts read them from `process.env`; Vite-built bundles (Terminal, Docs) inline them through `define` in their Vite/Vocs config. Edit `DYA_SOCIAL_HANDLES` in `src/index.js` to change the X or Telegram handle; social URLs are derived from those handles. Add new public destinations here.

These are navigation destinations, not authentication settings. Keep origin overrides, passkey domains, redirect validation, and trusted-origin allowlists in their environment-specific configuration. Do not put secrets here.

Use `DYA_BRAND.name` for Terminal’s display name and browser titles, `DYA_BRAND.idName` for the separate ID product name (Dya ID), `DYA_BRAND.accountName` for the account display name (Dya Account), `DYA_BRAND.tagline` for the broader vision, and `DYA_BRAND.desc` for the current product description and app metadata. Change the name in `src/index.js` to update UI branding; this does not rename technical packages, authentication identities, or URLs.

Use `TOAST_MESSAGES` and `TOAST_ACTIONS` for static toast copy in apps and Storybook. `ToastMessageId` and `ToastActionId` provide typed keys. Brand-dependent messages resolve from the same shared configuration. Dynamic service errors remain runtime messages and require separate handling.
