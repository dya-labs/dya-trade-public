import { writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { DYA_BRAND } from '@dya/config'
import { BRAND_MARK } from '@dya/ui/brand'
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="252" height="141" viewBox="${BRAND_MARK.viewBox}"><path d="${BRAND_MARK.path}" fill="${BRAND_MARK.color}"/></svg>`
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#060e0b"/><g transform="translate(474 180)">${logo.replace(/<\?xml[^>]*>/g, '')}</g><text x="600" y="420" text-anchor="middle" fill="#e4ebe8" font-family="sans-serif" font-size="44">${escape(DYA_BRAND.name)} Docs</text></svg>`
await writeFile(new URL('../docs/public/social-card.png', import.meta.url), await sharp(Buffer.from(svg)).png().toBuffer())
