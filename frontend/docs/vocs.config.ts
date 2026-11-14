import { DYA_BRAND, DYA_URLS } from '@dya/config'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vocs'

export default defineConfig({
  title: `${DYA_BRAND.name} Docs`,
  description: `Guides to ${DYA_BRAND.name} wallets, confidential spot trading, and your portfolio.`,
  titleTemplate: `%s · ${DYA_BRAND.name} Docs`,
  baseUrl: DYA_URLS.docs,
  logoUrl: '/dya-mark.svg',
  iconUrl: '/favicon.svg',
  ogImageUrl: `${DYA_URLS.docs}/social-card.png`,
  aiCta: false,
  // Inline the public links read by @dya/config (DYA_APP_URL, DYA_ID_URL, DYA_DOCS_URL) into page bundles.
  vite: {
    define: {
      'process.env.DYA_APP_URL': JSON.stringify(DYA_URLS.app),
      'process.env.DYA_ID_URL': JSON.stringify(DYA_URLS.id),
      'process.env.DYA_DOCS_URL': JSON.stringify(DYA_URLS.docs),
    },
    server: { fs: { allow: [
      fileURLToPath(new URL('../../node_modules/@fontsource-variable/plus-jakarta-sans', import.meta.url)),
      fileURLToPath(new URL('../../node_modules/@fontsource-variable/geist-mono', import.meta.url)),
    ] } },
  },
  font: {},
  topNav: [{ text: 'Open app', link: DYA_URLS.app }],
  sidebar: [
    { text: 'Overview', link: '/' },
    { text: `Using ${DYA_BRAND.name}`, items: [
      { text: 'Getting started', link: '/getting-started' },
      { text: 'Deposits and withdrawals', link: '/transfers' },
      { text: 'Trading', link: '/trading' },
      { text: 'Portfolio', link: '/portfolio' },
    ] },
    { text: 'Your account', items: [
      { text: 'Privacy', link: '/privacy' },
      { text: 'Security and recovery', link: '/security' },
      { text: 'Troubleshooting', link: '/troubleshooting' },
    ] },
  ],
  theme: {
    colorScheme: 'dark',
    variables: {
      color: {
        background: 'var(--background)', background2: 'var(--card)',
        backgroundDark: 'var(--card)', backgroundDarkTint: 'var(--muted)',
        background3: 'var(--muted)', background4: 'var(--accent)', background5: 'var(--accent)',
        backgroundAccent: 'var(--primary)', backgroundAccentHover: 'var(--primary)', backgroundAccentText: 'var(--primary-foreground)',
        border: 'var(--border)', border2: 'var(--border)', borderAccent: 'var(--primary)',
        heading: 'var(--foreground)', title: 'var(--foreground)', text: 'var(--foreground)',
        text2: 'var(--muted-foreground)', text3: 'var(--muted-foreground)', text4: 'var(--muted-foreground)',
        textAccent: 'var(--primary)', textAccentHover: 'var(--primary)', textHover: 'var(--foreground)',
      },
      fontFamily: { default: 'var(--font-brand-sans)', mono: '"Geist Mono Variable", monospace' },
    },
  },
})
