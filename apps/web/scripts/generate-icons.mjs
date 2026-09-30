// Génère les icônes PNG de la PWA à partir de public/favicon.svg.
// iOS exige un PNG 180 × 180 sans transparence ; Android et Windows utilisent 192, 512 et la version « maskable ».
import { mkdir, readFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = await readFile(new URL('../public/favicon.svg', import.meta.url));
const out = new URL('../public/icons/', import.meta.url);
await mkdir(out, { recursive: true });

const plain = (size, name) => sharp(svg).resize(size, size).flatten({ background: '#0d0d0d' }).png().toFile(new URL(name, out).pathname);

// Version « maskable » : le dessin tient dans la zone sûre centrale (80 %), le fond remplit tout le carré.
const maskable = async () => {
  const inner = await sharp(svg).resize(360, 360).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0d0d0d' } })
    .composite([{ input: inner, top: 76, left: 76 }])
    .png()
    .toFile(new URL('icon-maskable-512.png', out).pathname);
};

await Promise.all([
  plain(180, 'apple-touch-icon.png'),
  plain(192, 'icon-192.png'),
  plain(512, 'icon-512.png'),
  maskable(),
]);
console.log('Icônes générées dans public/icons/');
