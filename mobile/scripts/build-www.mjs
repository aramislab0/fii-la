// Construit mobile/www à partir de web/ : mêmes fichiers que le site, compressés comme en production, avec une
// configuration propre à l'app (pas de service worker, adresse publique pour les liens partagés).
// Variables : SUPABASE_URL, SUPABASE_KEY (clé publique), PUBLIC_URL (adresse web publique, pour les liens et le retour
// depuis Wave), APP_LINK_HOSTS (autres hôtes ouverts dans l'app, séparés par des virgules), SHOP_ZONE, DOMAINS_LIVE.
import { cpSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('..', import.meta.url));
const web = join(here, '..', 'web'), www = join(here, 'www');
rmSync(www, { recursive: true, force: true });
cpSync(web, www, { recursive: true, filter: (src) => !/(^|\/)(sw\.js|manifest\.webmanifest|config\.js)$/.test(src) });
const L = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
const cfg = {
  supabaseUrl: process.env.SUPABASE_URL || '', supabaseKey: process.env.SUPABASE_KEY || '',
  publicUrl: process.env.PUBLIC_URL || 'https://aramislab0.github.io/fii-la/',
  appLinkHosts: L(process.env.APP_LINK_HOSTS), shopZone: process.env.SHOP_ZONE || '', domainsLive: process.env.DOMAINS_LIVE === '1',
  serviceWorker: false, appHosts: [], movedTo: '', legacyOrigins: [], native: true
};
if (!cfg.supabaseUrl || !cfg.supabaseKey) console.warn('Attention : SUPABASE_URL ou SUPABASE_KEY absent — l’app ne pourra pas joindre la base.');
writeFileSync(join(www, 'config.js'), 'window.FIILA_CONFIG=' + JSON.stringify(cfg) + ';\n');
// Page : pas de manifeste d'installation (c'est déjà une app).
const idx = join(www, 'index.html');
// Noyau Capacitor (enregistrement des modules natifs : partage, préférences, retour…), chargé avant l'application.
cpSync(join(here, 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js'), join(www, 'capacitor.js'));
writeFileSync(idx, readFileSync(idx, 'utf8').replace(/<link rel="manifest"[^>]*>\n?/, '')
  .replace('<script src="config.js"></script>', '<script src="capacitor.js"></script>\n<script src="config.js"></script>'));
const minify = join(here, '..', 'scripts', 'minify.mjs');
if (existsSync(minify)) execFileSync(process.execPath, [minify, www], { stdio: 'inherit' });
console.log('www prêt :', www);
