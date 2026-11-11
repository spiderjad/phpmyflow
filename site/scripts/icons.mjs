// PNG icons from the phpMyFlow logo (public/favicon.svg, the same mark as the app):
// favicon-32.png and apple-touch-icon.png (180×180, full-bleed: iOS rounds the corners).
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const svg = readFileSync(join(pub, 'favicon.svg'), 'utf8');
const square = svg.replace('rx="7" ', '');
await sharp(Buffer.from(svg), { density: 384 }).resize(32, 32).png().toFile(join(pub, 'favicon-32.png'));
await sharp(Buffer.from(square), { density: 1152 }).resize(180, 180).png().toFile(join(pub, 'apple-touch-icon.png'));
console.log('icons written to public/');
