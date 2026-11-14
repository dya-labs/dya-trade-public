# DYA Docs

Public user documentation built with Vocs 1.4.1.

From the repository root:

- `bun run dev:docs` — http://localhost:3105
- `bun run build:docs` — static output in `frontend/docs/docs/dist`
- `bun run typecheck:docs` — configuration type check

Edit Markdown/MDX in `docs/pages`, navigation in `vocs.config.ts`, and public images in `docs/public`. Colors and font choices follow the shared UI theme. Vocs owns the documentation shell; interactive product components should come from `@dya/ui` rather than introducing another UI kit.

Keep guides aligned with shipped behavior. Never publish account records, real support credentials, recovery secrets, or unverified privacy/recovery guarantees. Terms and Privacy Policy require their own approved documents; the guides do not replace them.
