import { DYA_URLS } from '@dya/config';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const pages = resolve(root, 'docs/pages');
async function routes(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await routes(path));
    else if (/\.mdx?$/.test(entry.name)) result.push(relative(pages, path).replace(/\\/g, '/').replace(/\.mdx?$/, '').replace(/(^|\/)index$/, ''));
  }
  return result;
}
const urls = (await routes(pages)).sort().map(route => `<url><loc>${DYA_URLS.docs}/${route.split('/').map(encodeURIComponent).join('/')}</loc></url>`);
await mkdir(resolve(root, 'docs/public'), { recursive: true });
await writeFile(resolve(root, 'docs/public/sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>\n`);

await writeFile(resolve(root, 'docs/public/robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${DYA_URLS.docs}/sitemap.xml\n`);
