import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
const folder = new URL('../src/brand/loading/', import.meta.url);
const source = readFileSync(new URL('source.svg', folder), 'utf8');
const defs = source.match(/<defs>[\s\S]*?<\/defs>/)![0];
const arcs = [...source.matchAll(/<g class="app-loading-arc-(?:left|right)"[^>]*><g[\s\S]*?<\/g><\/g>/g)].map(match=>match[0]);
if(arcs.length!==8) throw new Error('Expected eight original circle layers');
for(const [index,arc] of arcs.entries()) {
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="2770" height="1080" viewBox="-425 0 2770 1080">${defs}${arc}</svg>`;
  await sharp(Buffer.from(svg)).webp({lossless:true}).toFile(new URL(`arc-${index}.webp`,folder).pathname);
}
let base=source;
for(const arc of arcs) base=base.replace(arc,'');
await sharp(Buffer.from(base)).webp({lossless:true}).toFile(new URL('grid.webp',folder).pathname);
console.log('Generated eight transparent arc layers and the original grid/texture.');
