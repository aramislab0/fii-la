// Fonction fiila-whatsapp : vérification du webhook, signature de Meta obligatoire, message d'un ambassadeur → réponse du Manager
// sur WhatsApp, numéro inconnu → lien d'inscription, IA, réponse de l'équipe poussée si la fenêtre de 24 h est ouverte.
// Meta, Supabase et l'API Claude sont simulés (aucun message réel, aucune clé réelle).
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeHandler, inboundMessages, GRAPH } from '../supabase/functions/fiila-whatsapp/handler.mjs';

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }
const ENV = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', WA_TOKEN: 'wa-test', WA_PHONE_ID: '123', WA_APP_SECRET: 'app-secret', WA_VERIFY_TOKEN: 'verif', PUBLIC_URL: 'https://app.test/' };
function sim(rpcs) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, init, body });
    if (url.startsWith(GRAPH)) return new Response('{}', { status: 200 });
    if (url.includes('api.anthropic.com')) return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"reply":"Réponse IA.","tags":["question"]}' }] }), { status: 200 });
    const fn = url.split('/rpc/')[1];
    const v = typeof rpcs[fn] === 'function' ? rpcs[fn](body) : rpcs[fn];
    return new Response(JSON.stringify(v ?? { ok: true }), { status: 200 });
  };
  return { fetch, calls, sent: () => calls.filter((c) => c.url.startsWith(GRAPH)).map((c) => ({ to: c.body.to, text: c.body.text.body })) };
}
const meta = (from, text, id = 'wamid.' + Math.random()) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [{ from, id, type: text == null ? 'audio' : 'text', text: text == null ? undefined : { body: text } }] } }] }] });
function signed(payload, secret = 'app-secret') {
  const raw = JSON.stringify(payload);
  return new Request('https://x/functions/v1/fiila-whatsapp', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'), 'content-type': 'application/json' } });
}

await t('vérification du webhook par Meta : jeton exact seulement', async () => {
  const h = makeHandler({ env: (k) => ENV[k], fetch: sim({}).fetch });
  const ok = await h(new Request('https://x/f?hub.mode=subscribe&hub.verify_token=verif&hub.challenge=42'));
  assert.equal(ok.status, 200); assert.equal(await ok.text(), '42');
  assert.equal((await h(new Request('https://x/f?hub.mode=subscribe&hub.verify_token=faux&hub.challenge=42'))).status, 403);
});

await t('signature de Meta obligatoire : sans elle ou fausse, rien n’est lu ni envoyé', async () => {
  const s = sim({});
  const h = makeHandler({ env: (k) => ENV[k], fetch: s.fetch });
  assert.equal((await h(signed(meta('221776000001', 'Bonjour'), 'autre-secret'))).status, 401);
  assert.equal(s.calls.length, 0);
});

await t('message d’un ambassadeur : réponse du Manager envoyée sur WhatsApp, au même numéro', async () => {
  const s = sim({ fiila_wa_inbound: { known: true, message: 'm1', reply: 'Votre code est K7M2QD.' } });
  const r = await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(signed(meta('221776000001', 'Mon code ?', 'wamid.A')));
  assert.equal(r.status, 200);
  assert.deepEqual(s.calls.find((c) => c.url.endsWith('fiila_wa_inbound')).body, { p_phone: '221776000001', p_body: 'Mon code ?', p_wamid: 'wamid.A' });
  assert.deepEqual(s.sent(), [{ to: '221776000001', text: 'Votre code est K7M2QD.' }]);
  assert.equal(s.calls.find((c) => c.url.startsWith(GRAPH)).init.headers.Authorization, 'Bearer wa-test');
});

await t('numéro inconnu : lien d’inscription ; message renvoyé par Meta ou réglage coupé : rien n’est envoyé', async () => {
  let s = sim({ fiila_wa_inbound: { known: false } });
  await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(signed(meta('221700000000', 'Bonjour')));
  assert.match(s.sent()[0].text, /https:\/\/app\.test\/#\/carriere/);
  for (const v of [{ duplicate: true }, { off: true }, { known: true, excluded: true }]) {
    s = sim({ fiila_wa_inbound: v });
    const r = await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(signed(meta('221776000001', 'x')));
    assert.equal(r.status, 200); assert.equal(s.sent().length, 0);
  }
});

await t('IA activée : réponse rédigée, enregistrée sur le canal WhatsApp, puis envoyée', async () => {
  const ctx = { message: { id: 'm2', body: 'Comment faire ?', tags: [], answered: false }, user_id: 'u', llm: true, ambassador: { name: 'Awa' }, rules: [], rewards: [], fallback: 'Secours.' };
  const s = sim({ fiila_wa_inbound: { known: true, message: 'm2', pending: true }, fiila_amb_manager_context: ctx });
  await makeHandler({ env: (k) => ({ ...ENV, ANTHROPIC_API_KEY: 'k' })[k], fetch: s.fetch })(signed(meta('221776000001', 'Comment faire ?')));
  assert.equal(s.calls.find((c) => c.url.endsWith('fiila_amb_manager_post')).body.p_reply, 'Réponse IA.');
  assert.deepEqual(s.sent(), [{ to: '221776000001', text: 'Réponse IA.' }]);
});

await t('réponse de l’équipe : droit « ambassadeurs » exigé ; envoyée seulement si la fenêtre de 24 h est ouverte', async () => {
  const push = (open, perms) => sim({ fiila_bo_me: { staff: true, perms }, fiila_wa_push_data: { to: '221776000001', body: 'On regarde.', open } });
  const req = () => new Request('https://x/f', { method: 'POST', body: JSON.stringify({ action: 'push', ambassador: 'a1' }), headers: { authorization: 'Bearer jwt-staff' } });
  let s = push(true, ['dashboard']);
  assert.equal((await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req())).status, 403);
  s = push(false, ['ambassadors']);
  assert.deepEqual(await (await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req())).json(), { ok: true, sent: false });
  s = push(true, ['ambassadors']);
  assert.deepEqual(await (await makeHandler({ env: (k) => ENV[k], fetch: s.fetch })(req())).json(), { ok: true, sent: true });
  assert.deepEqual(s.sent(), [{ to: '221776000001', text: 'On regarde.' }]);
});

await t('lecture des notifications : vocal ou image = texte vide (le Manager demande d’écrire)', async () => {
  assert.deepEqual(inboundMessages(meta('221776000001', null, 'w9')), [{ from: '221776000001', id: 'w9', text: '' }]);
  assert.deepEqual(inboundMessages({}), []);
});

console.log(`\n${passed}/${passed + failed} tests fonction WhatsApp réussis`);
process.exit(failed ? 1 : 0);
