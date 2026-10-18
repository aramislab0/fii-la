// Captures avant/après pour la revue design : 4 écrans × clair/sombre, données synthétiques locales.
// Usage : node scripts/design-shots.mjs <racine du dépôt à servir> <dossier de sortie> <préfixe>
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const [root, out, prefix] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { startServer } = await import(join(root, 'tests/dev-server.mjs'));
const { rpc } = await import(join(root, 'tests/db.mjs'));
const { chromium, devices } = require('/home/claude/fii-la/node_modules/playwright');
mkdirSync(out, { recursive: true });
const local = await startServer(0);
const ok = async (fn, args) => { const r = await rpc(local.db, fn, args); if (r.status !== 200) throw new Error(fn + JSON.stringify(r.body)); return r.body; };
const photo = readFileSync('/home/claude/fii-la/tests/fixtures/door-with-exif.jpg').toString('base64');
const P = await ok('fiila_create_place', { p: { kind: 'address', label: 'Chez Awa, villa 12', locality: 'Ouakam', instruction: 'Portail vert après la boutique de tissus. Sonnez deux fois.', entry: { lat: 14.7215, lng: -17.4893 }, vehicle_ok: true } });
const R = await ok('fiila_create_request', { p: { requester_name: 'Boutique Awa', purpose: 'Livraison de votre commande', order_ref: 'N° 0012' } });
const b = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const ctx = await b.newContext({ ...devices['iPhone 13'], locale: 'fr-FR', serviceWorkers: 'block', colorScheme: theme });
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  await ctx.addInitScript(([o, t]) => { localStorage.setItem('fiila-theme', t); if (!localStorage.getItem('fiila.owned')) localStorage.setItem('fiila.owned', JSON.stringify(o)); },
    [[{ type: 'place', kind: 'address', id: P.id, owner: P.owner_token, share: P.share_token, label: 'Chez Awa, villa 12' }], theme]);
  const pg = await ctx.newPage();
  const shot = async (hash, name, wait) => {
    await pg.goto(local.url + '#/'); await pg.goto(local.url + hash);
    await pg.locator(wait).first().waitFor(); await pg.waitForTimeout(500);
    await pg.screenshot({ path: `${out}/${prefix}-${name}-${theme}.png`, fullPage: true });
  };
  await shot('#/', '1-accueil', 'h2');
  await shot('#/a/' + P.share_token, '2-fiche-recue', 'h1');
  await shot('#/m/' + P.id, '3-gestion', 'h1');
  await shot('#/d/' + R.share_token, '4-demande-recue', 'h1');
  await ctx.close();
}
await b.close(); local.server.close();
console.log('ok', prefix);
