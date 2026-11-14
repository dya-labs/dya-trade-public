# Shared DYA UI

Private, unpublished React workspace used by Terminal, DYA ID, and the wallet React SDK. It holds the shared component recipes, color tokens, radii, typography, dark theme, and tab motion. No wallet/provider logic belongs here.

```tsx
import { Button } from '@dya/ui/components/button';
import { DialogDrawer, DialogDrawerContent } from '@dya/ui/components/dialog-drawer';
import { ThemeProvider } from '@dya/ui/components/theme-provider';
import { cn } from '@dya/ui/lib/utils';
```

Each app imports `@dya/ui/globals.css` from its global stylesheet and uses the shared self-hosted Plus Jakarta Sans typography, with Geist Mono for numeric/monospace contexts. The shared stylesheet owns Tailwind setup, tokens, base rules, and shared component CSS; its `@source` directive scans shared components. App-specific layout/behavior CSS stays in its app. Next.js transpiles the workspace source through `transpilePackages`.

## Responsive dialogs

Use `DialogDrawer` and its `Content`, `Header`, `Footer`, `Title`, `Description`, `Trigger`, and `Close` parts from `@dya/ui/components/dialog-drawer` for application dialogs. They use a centered dialog at widths of 640px and above and a Base UI bottom drawer below 640px. The presentation stays fixed while open, so resizing does not reset a form.

```tsx
<DialogDrawer open={open} onOpenChange={setOpen} dismissible={!busy}>
  <DialogDrawerContent>
    <DialogDrawerHeader>
      <DialogDrawerTitle>Review transfer</DialogDrawerTitle>
    </DialogDrawerHeader>
    {children}
  </DialogDrawerContent>
</DialogDrawer>
```

Mobile drawers support swipe dismissal, keyboard-aware focus/scrolling, safe-area padding, and reduced motion. Keep busy workflows controlled and set `dismissible={false}` when cancelling is unsafe. Use the raw `dialog` primitives for the transparent wallet iframe transport only; its ID-owned visible frame uses `DialogDrawer` so there is one visible drawer. The lower-level `drawer` primitives are available for explicitly drawer-only surfaces.

## shadcn CLI

Following [shadcn’s monorepo setup](https://ui.shadcn.com/docs/monorepo), Terminal, ID, and this workspace each have `components.json`. Both apps point `ui` and `utils` at the package exports and point `tailwind.css` at the shared stylesheet. Keep style (`base-nova`), icon library (`lucide`), and baseColor (`neutral`) consistent; these CLI settings do not replace the Terminal theme. Tailwind v4 leaves the config field empty.

Run component additions from the consuming app:

```sh
cd frontend/id
bunx --bun shadcn add button
```

The CLI routes shared primitives to `packages/ui/src/components` and app-specific blocks to the consuming app. Do not overwrite customized Terminal recipes without reviewing the diff. `shadcn info` from either app confirms the resolved shared component, utility, and CSS paths.

React is a peer dependency; UI runtime dependencies are declared here. Package exports expose components, utilities, optional CLI-generated hooks, and the shared stylesheet. `bun run typecheck:ui` checks the package independently. Both apps’ tests/builds and Terminal Storybook verify consumers.

## Brand mark

`src/brand/mark.js` is the canonical geometry and color. Import `BrandMark` from `@dya/ui/components/brand-mark` for app UI; provide `label` when it needs an accessible name. `DyaLoader` reuses the same geometry with its reveal mask.

Run `bun run build:brand` at the repository root to regenerate the public logo SVGs and SVG/ICO favicons for Terminal, ID and Docs. App build scripts also run this generator. Public copies are generated assets for metadata and Docs, not independent sources. The Docs social-card renderer reads `@dya/ui/brand` directly.

### General UI icons

Import general UI icons from `@dya/ui/icons` in apps and shared components:

```tsx
import { Check, ChevronDown } from "@dya/ui/icons";
```

`src/icons.ts` is the icon-pack adapter and the only module that imports `@remixicon/react` directly. Add or remap icons there when changing packs; preserve the exported names and the component props callers use (`className`, sizing, accessibility, and refs). Keep named imports so builds can tree-shake unused icons. Brand, social, and animated menu marks retain their dedicated shared components.

Custom Dya icons are exported from the same adapter. ScanFace, Network, and RefreshCw use Lucide; the remaining pack-backed icons use Remix. NavigationIcon owns the shared active/inactive navigation shapes. Review icons and motion in Terminal Storybook under **Shared / Icons / Gallery Preview** (`bun run --filter app storybook`, port 6006).
