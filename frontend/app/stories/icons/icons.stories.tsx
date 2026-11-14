import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import * as Icons from "@dya/ui/icons";
import { NavigationIcon, type NavigationIconName } from "@dya/ui/components/navigation-icon";
import { AnimatedNavLink } from "@dya/ui/components/animated-nav-link";
import { DyaLoader } from "@dya/ui/components/dya-loader";
import { MenuToggleIcon } from "@dya/ui/components/menu-toggle-icon";
import { Button } from "@dya/ui/components/button";
import { Input } from "@dya/ui/components/input";
import privacySvg from "../../../../packages/ui/src/brand/icons/privacy.svg?url";

function Gallery() {
  const [search, setSearch] = useState("");
  const [size, setSize] = useState(22);
  const [active, setActive] = useState<NavigationIconName>("markets");
  const [menuOpen, setMenuOpen] = useState(false);
  return <main className="mx-auto max-w-6xl space-y-8 p-6 text-foreground">
    <header className="space-y-2"><h1 className="text-xl font-semibold">Dya icon gallery</h1><p className="text-sm text-muted-foreground">Real shared components at their rendered sizes. Use the theme toolbar to compare light and dark.</p></header>
    <section className="space-y-4"><h2 className="font-medium">Custom navigation · inactive / active</h2><div className="grid gap-4 sm:grid-cols-3">{(["markets", "trade", "portfolio"] as const).map(icon => <div key={icon} className="space-y-4 rounded-lg border bg-card p-4"><h3 className="capitalize">{icon}</h3>{[16, 22, 32].map(px => <div key={px} className="flex items-center gap-6"><span className="w-10 text-xs text-muted-foreground">{px}px</span><NavigationIcon icon={icon} width={px} height={px} className="text-muted-foreground"/><NavigationIcon icon={icon} active width={px} height={px}/></div>)}</div>)}</div></section>
    <section className="space-y-4"><h2 className="font-medium">Privacy · Remix shield with DYA diamond</h2><div className="flex flex-wrap items-center gap-8 rounded-lg border bg-card p-6">{[16, 24, 48, 120].map(px => <div key={px} className="flex flex-col items-center gap-3"><Icons.PrivacyIcon width={px} height={px}/><span className="text-xs text-muted-foreground">{px}px</span></div>)}</div><a className="text-sm underline underline-offset-4" href={privacySvg} download="dya-privacy.svg">Download privacy SVG ↗</a></section>
    <section className="space-y-4"><h2 className="font-medium">Click to preview motion</h2><p className="text-sm text-muted-foreground">Markets bars stagger; Trade rotates from its inactive pose; Portfolio presses inward. Reduced motion follows your system preference.</p><nav aria-label="Icon animation preview" className="grid max-w-md grid-cols-3 border bg-card">{(["markets", "trade", "portfolio"] as const).map(icon => <AnimatedNavLink key={icon} href={`#${icon}`} icon={icon} aria-current={active === icon ? "page" : undefined} onClick={() => setActive(icon)} className="flex h-14 items-center justify-center gap-1.5 text-xs capitalize text-muted-foreground aria-[current=page]:text-foreground">{icon}</AnimatedNavLink>)}</nav><Button variant="outline" onClick={() => setMenuOpen(value => !value)} aria-expanded={menuOpen}><MenuToggleIcon open={menuOpen}/>Menu morph</Button></section>
    <section className="space-y-4"><h2 className="font-medium">Branded chart loader</h2><p className="text-sm text-muted-foreground">The real DyaLoader used while the chart initializes. The dedicated Shared / DyaLoader story also shows it full-screen.</p><div className="flex min-h-40 items-center justify-center rounded-lg border bg-card"><DyaLoader label="Loading TradingView chart"/></div></section>
    <section className="space-y-4"><h2 className="font-medium">Elastic loader</h2><p className="text-sm text-muted-foreground">Continuous stretch-and-trail motion at 16, 22, and 32px. Follows the system’s reduced-motion preference.</p><div className="flex items-center gap-8 rounded-lg border bg-card p-6">{[16, 22, 32].map(px => <div key={px} className="flex flex-col items-center gap-3"><Icons.LoaderCircle style={{ width: px, height: px }} className="text-primary"/><span className="text-xs text-muted-foreground">{px}px</span></div>)}<Button disabled><Icons.LoaderCircle className="size-4"/>Loading</Button></div></section>
    <section className="space-y-4"><h2 className="font-medium">Shared icon exports</h2><div className="flex flex-wrap gap-2"><Input aria-label="Filter icons" placeholder="Search icon names" value={search} onChange={event => setSearch(event.target.value)} className="max-w-sm"/>{[16, 22, 32].map(px => <Button key={px} variant={size === px ? "default" : "outline"} onClick={() => setSize(px)} aria-pressed={size === px}>{px}px</Button>)}</div><div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">{Object.entries(Icons).filter(([name]) => name.toLowerCase().includes(search.toLowerCase())).map(([name, Icon]) => <div key={name} className="flex min-h-28 flex-col items-center justify-center gap-3 rounded-lg border bg-card p-3"><Icon style={{ width: size, height: size }} aria-hidden="true"/><span className="max-w-full break-words text-center text-xs text-muted-foreground">{name}</span></div>)}</div></section>
  </main>;
}
const meta = { title: "Shared/Icons", component: Gallery, parameters: { layout: "fullscreen" } } satisfies Meta<typeof Gallery>;
export default meta;
type Story = StoryObj<typeof meta>;
export const GalleryPreview: Story = {};
