// Fonction fiila-manager (IA) : identité vérifiée, réponse du modèle enregistrée, secours sans clé ou réponse illisible,
// analyse réservée au droit « strategy ». Supabase et l'API Claude sont simulés (aucun appel réel, aucune clé réelle).
import assert from 'node:assert/strict';
import { makeHandler, replyPrompt, parseJson, DEFAULT_MODEL } from '../supabase/functions/fiila-manager/handler.mjs';

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }
const BASE_ENV = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
const CTX = { message: { id: 'm1', body: 'Comment convaincre un restaurant ?', tags: ['question'], answered: false }, user_id: 'u-amb', llm: true,
  ambassador: { name: 'Awa Ndiaye', zone: 'Yoff', status: 'active', grade: 'ambassadeur', code: 'K7M2QD', shops: [{ shop: 'Resto Fatou', level: 0, photos: 2, public: false, clients: 0 }] },
  objective: { brief: 'Priorité aux restaurants.', focus_types: ['restauration'], focus_zones: ['Yoff'] }, tasks: [{ title: 'Aider Resto Fatou', done: false }],
  rules: ['Règle 1'], rewards: [2000, 5000, 10000], fallback: 'Réponse sans IA.' };
function sim({ claude, user = 'u-amb', me = null, ctx = CTX }) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify(user ? { id: user } : {}), { status: user ? 200 : 401 });
    if (url.includes('api.anthropic.com')) return claude ? new Response(JSON.stringify({ content: [{ type: 'text', text: claude }] }), { status: 200 }) : new Response('{}', { status: 500 });
    const fn = url.split('/rpc/')[1];
    if (fn === 'fiila_amb_manager_context') return new Response(JSON.stringify(ctx), { status: 200 });
    if (fn === 'fiila_bo_me') return new Response(JSON.stringify(me), { status: 200 });
    if (fn === 'fiila_amb_manager_digest_data') return new Response(JSON.stringify({ report: { messages_7d: 9 } }), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  return { fetch, calls };
}
const req = (body, token = 'jwt-user') => new Request('https://x/functions/v1/fiila-manager', { method: 'POST', body: JSON.stringify(body), headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } });

await t('réponse IA : contexte en clé de service, consignes (règles, cap, pas de numéro), réponse et étiquettes filtrées enregistrées', async () => {
  const s = sim({ claude: 'Voici : {"reply": "Montrez-lui une vraie vitrine de restaurant.", "tags": ["question", "pirate"], "escalate": false}' });
  const h = makeHandler({ env: (k) => ({ ...BASE_ENV, ANTHROPIC_API_KEY: 'cle-test' })[k], fetch: s.fetch });
  const r = await h(req({ action: 'reply', message: 'm1' }));
  assert.equal(r.status, 200); assert.equal((await r.json()).mode, 'ia');
  const ctxCall = s.calls.find((c) => c.url.endsWith('fiila_amb_manager_context'));
  assert.equal(ctxCall.init.headers.Authorization, 'Bearer service-test');
  const ai = s.calls.find((c) => c.url.includes('anthropic'));
  assert.equal(ai.body.model, DEFAULT_MODEL); assert.equal(ai.init.headers['x-api-key'], 'cle-test');
  assert.match(ai.body.system, /ne décide jamais d’un gain/); assert.match(ai.body.system, /Priorité aux restaurants/);
  assert.match(ai.body.system, /Resto Fatou : niveau 0\/3/);
  const post = s.calls.find((c) => c.url.endsWith('fiila_amb_manager_post'));
  assert.equal(post.body.p_reply, 'Montrez-lui une vraie vitrine de restaurant.'); assert.deepEqual(post.body.p_tags, ['question']);
});

await t('sans clé, réglage désactivé ou réponse illisible : la réponse sans IA est enregistrée (jamais de silence)', async () => {
  for (const [env, claude, ctx] of [[BASE_ENV, null, CTX], [{ ...BASE_ENV, ANTHROPIC_API_KEY: 'k' }, 'pas du json', CTX], [{ ...BASE_ENV, ANTHROPIC_API_KEY: 'k' }, '{"reply":"x"}', { ...CTX, llm: false }]]) {
    const s = sim({ claude, ctx });
    const r = await makeHandler({ env: (k) => env[k], fetch: s.fetch })(req({ action: 'reply', message: 'm1' }));
    assert.equal((await r.json()).mode, 'rules');
    assert.equal(s.calls.find((c) => c.url.endsWith('fiila_amb_manager_post')).body.p_reply, 'Réponse sans IA.');
    if (!ctx.llm) assert.ok(!s.calls.some((c) => c.url.includes('anthropic')), 'aucun appel payant si le réglage est à 0');
  }
});

await t('identité : sans session 401 ; le message d’un autre ambassadeur 403, rien enregistré', async () => {
  const s = sim({ claude: null, user: 'u-autre' });
  const h = makeHandler({ env: (k) => BASE_ENV[k], fetch: s.fetch });
  assert.equal((await h(new Request('https://x', { method: 'POST', body: '{}' }))).status, 401);
  assert.equal((await h(req({ action: 'reply', message: 'm1' }))).status, 403);
  assert.ok(!s.calls.some((c) => c.url.endsWith('fiila_amb_manager_post')));
});

await t('analyse : réservée au droit « strategy » ; propositions du modèle enregistrées (4 au plus, types contrôlés)', async () => {
  const items = { items: [{ kind: 'training', title: 'Fiche objections', body: 'b' }, { kind: 'pirate', title: 'x' }, { kind: 'mission', title: 'Visites restaurants', body: 'c' }] };
  let s = sim({ claude: JSON.stringify(items), me: { staff: true, perms: ['dashboard', 'finance'] } });
  let r = await makeHandler({ env: (k) => ({ ...BASE_ENV, ANTHROPIC_API_KEY: 'k' })[k], fetch: s.fetch })(req({ action: 'digest' }));
  assert.equal(r.status, 403);
  s = sim({ claude: JSON.stringify(items), me: { staff: true, perms: ['ambassadors', 'strategy'] } });
  r = await makeHandler({ env: (k) => ({ ...BASE_ENV, ANTHROPIC_API_KEY: 'k' })[k], fetch: s.fetch })(req({ action: 'digest' }));
  assert.deepEqual(await r.json(), { ok: true, mode: 'ia', items: 2 });
  assert.equal(s.calls.find((c) => c.url.endsWith('fiila_bo_me')).init.headers.Authorization, 'Bearer jwt-user', 'droits vérifiés avec la session de la personne');
  assert.equal(s.calls.filter((c) => c.url.endsWith('fiila_amb_manager_note')).length, 2);
});

await t('outils : lecture du JSON entouré de texte ; consignes sans numéro de téléphone', async () => {
  assert.deepEqual(parseJson('ok ```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(parseJson('rien'), null);
  assert.ok(!/77\s?\d{3}/.test(replyPrompt(CTX)));
});

console.log(`\n${passed}/${passed + failed} tests fonction Manager réussis`);
process.exit(failed ? 1 : 0);
