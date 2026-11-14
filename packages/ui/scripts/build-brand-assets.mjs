import {writeFileSync} from 'node:fs';
import sharp from 'sharp';
import { BRAND_MARK } from '../src/brand/mark.js';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const {path,width,height,color,viewBox}=BRAND_MARK;
const [originX,originY]=viewBox.split(" ").map(Number);
const logo=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" fill="none"><path d="${path}" fill="${color}"/></svg>\n`;
const scale=56/width,y=(64-height*scale)/2;
const favicon=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g transform="translate(4 ${y}) scale(${scale}) translate(${-originX} ${-originY})"><path d="${path}" fill="${color}"/></g></svg>\n`;
const sizes=[16,32,48,64];const pngs=await Promise.all(sizes.map(s=>sharp(Buffer.from(favicon)).resize(s,s).png().toBuffer()));
const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
sizes.forEach((s,i)=>{const p=6+i*16;header[p]=s;header[p+1]=s;header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(pngs[i].length,p+8);header.writeUInt32LE(offset,p+12);offset+=pngs[i].length;});const ico=Buffer.concat([header,...pngs]);
for(const dir of ['frontend/app/public','frontend/id/public','frontend/docs/docs/public']){writeFileSync(root+dir+(dir === 'frontend/docs/docs/public' ? '/dya-mark.svg' : '/dya-logo.svg'),logo);writeFileSync(root+dir+'/favicon.svg',favicon);writeFileSync(root+dir+'/favicon.ico',ico);}
console.log("Generated logo and favicon assets for Terminal, ID and Docs.");
