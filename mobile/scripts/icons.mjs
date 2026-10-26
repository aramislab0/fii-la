// Icônes et écrans de démarrage Android et iPhone, à partir des icônes validées de web/icons (aucun dessin nouveau).
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));
const icons = join(root, '..', 'web', 'icons');
const ICON = join(icons, 'icon-512.png'), MASK = join(icons, 'icon-maskable-512.png');
const BG = '#1E4A34';
const res = join(root, 'android', 'app', 'src', 'main', 'res');
const D = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const png = (src, size) => sharp(src).resize(size, size).png();
async function splash(w, h, out) {
  const logo = Math.round(Math.min(w, h) * 0.28);
  const img = await sharp(MASK).resize(logo, logo).png().toBuffer();
  await sharp({ create: { width: w, height: h, channels: 3, background: BG } })
    .composite([{ input: img, gravity: 'center' }]).png().toFile(out);
}
for (const [d, k] of Object.entries(D)) {
  await png(ICON, Math.round(48 * k)).toFile(join(res, `mipmap-${d}`, 'ic_launcher.png'));
  await png(ICON, Math.round(48 * k)).toFile(join(res, `mipmap-${d}`, 'ic_launcher_round.png'));
  // Icône adaptative : l'icône « maskable » (zone sûre déjà prévue) sur 108 dp.
  await png(MASK, Math.round(108 * k)).toFile(join(res, `mipmap-${d}`, 'ic_launcher_foreground.png'));
  await splash(Math.round(320 * k), Math.round(480 * k), join(res, `drawable-port-${d}`, 'splash.png'));
  await splash(Math.round(480 * k), Math.round(320 * k), join(res, `drawable-land-${d}`, 'splash.png'));
}
await splash(480, 800, join(res, 'drawable', 'splash.png'));
// iPhone : icône 1024 sans transparence ; écran de démarrage 2732².
const xc = join(root, 'ios', 'App', 'App', 'Assets.xcassets');
await sharp(ICON).resize(1024, 1024).flatten({ background: BG }).removeAlpha().png().toFile(join(xc, 'AppIcon.appiconset', 'AppIcon-512@2x.png'));
for (const f of readdirSync(join(xc, 'Splash.imageset')).filter((x) => x.endsWith('.png'))) await splash(2732, 2732, join(xc, 'Splash.imageset', f));
console.log('icônes et écrans de démarrage écrits');
