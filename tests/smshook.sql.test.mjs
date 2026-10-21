// Crochet d'envoi des SMS (Africa's Talking) : signature Standard Webhooks obligatoire, numéro et code transmis,
// erreurs au format des crochets Supabase, aucune donnée enregistrée. Africa's Talking est simulé (aucun SMS réel).
import assert from 'node:assert/strict';
import { Webhook } from 'standardwebhooks';
import { makeHandler, recipient, SMS_TEXT } from '../supabase/functions/fiila-send-sms/handler.mjs';

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }
const SECRET = Buffer.from('secret-de-test-fii-0123456789').toString('base64');
const ENV = { SEND_SMS_HOOK_SECRET: 'v1,whsec_' + SECRET, AT_USERNAME: 'fiila-test', AT_API_KEY: 'cle-de-test', AT_SENDER_ID: 'FIILA' };
const calls = [];
function atFetch(status, recipients) {
  return async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ SMSMessageData: { Message: 'Sent to 1/1', Recipients: recipients } }), { status }); };
}
function signed(payload, secret = SECRET) {
  const body = JSON.stringify(payload);
  const id = 'msg_' + Math.random().toString(36).slice(2), ts = new Date();
  const sig = new Webhook(secret).sign(id, ts, body);
  return new Request('https://x/functions/v1/fiila-send-sms', { method: 'POST', body,
    headers: { 'webhook-id': id, 'webhook-timestamp': String(Math.floor(ts / 1000)), 'webhook-signature': sig, 'content-type': 'application/json' } });
}
const ev = { user: { id: 'u1', phone: '', new_phone: '221771234567' }, sms: { otp: '482913', sms_type: 'phone_change' } };

await t('signature valide : SMS envoyé à Africa’s Talking (numéro +221, texte, expéditeur), réponse 200 vide', async () => {
  calls.length = 0;
  const h = makeHandler({ env: (k) => ENV[k], fetch: atFetch(201, [{ statusCode: 101, status: 'Success', number: '+221771234567' }]), Webhook });
  const res = await h(signed(ev));
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.africastalking.com/version1/messaging');
  assert.equal(calls[0].init.headers.apiKey, 'cle-de-test');
  const f = new URLSearchParams(calls[0].init.body);
  assert.deepEqual(Object.fromEntries(f), { username: 'fiila-test', to: '+221771234567', message: SMS_TEXT('482913'), from: 'FIILA' });
  assert.match(f.get('message'), /^Fii : votre code est 482913\./);
});

await t('signature absente, fausse ou d’un autre secret : refus 401, aucun SMS', async () => {
  calls.length = 0;
  const h = makeHandler({ env: (k) => ENV[k], fetch: atFetch(201, [{ statusCode: 101 }]), Webhook });
  const r1 = await h(new Request('https://x', { method: 'POST', body: JSON.stringify(ev) }));
  assert.equal(r1.status, 401); assert.deepEqual(await r1.json(), { error: { http_code: 401, message: 'Signature invalide' } });
  const other = Buffer.from('un-autre-secret-un-autre-secret!').toString('base64');
  assert.equal((await h(signed(ev, other))).status, 401);
  assert.equal(calls.length, 0);
});

await t('numéro choisi : sms.phone, sinon nouveau numéro, sinon numéro du compte', async () => {
  assert.equal(recipient({ sms: { phone: '221700000001' }, user: { phone: '221700000002' } }), '+221700000001');
  assert.equal(recipient({ user: { new_phone: '221700000003', phone: '221700000004' } }), '+221700000003');
  assert.equal(recipient({ user: { phone: '+221 70 000 00 05' } }), '+221700000005');
  assert.equal(recipient({ user: {} }), null);
});

await t('refus d’Africa’s Talking (solde, expéditeur) ou absence de réponse : erreur 502/504 au format Supabase', async () => {
  const h = makeHandler({ env: (k) => ENV[k], fetch: atFetch(201, [{ statusCode: 405, status: 'InsufficientBalance' }]), Webhook });
  const r = await h(signed(ev));
  assert.equal(r.status, 502); assert.equal((await r.json()).error.http_code, 502);
  const slow = makeHandler({ env: (k) => ENV[k], timeoutMs: 50, Webhook,
    fetch: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('abort')))) });
  assert.equal((await slow(signed(ev))).status, 504);
});

await t('inscription ou connexion par SMS (non utilisées) : aucun envoi, donc aucun coût', async () => {
  calls.length = 0;
  const h = makeHandler({ env: (k) => ENV[k], fetch: atFetch(201, [{ statusCode: 101 }]), Webhook });
  for (const ty of ['signup', 'sms', 'confirmation']) assert.equal((await h(signed({ ...ev, sms: { otp: '111111', sms_type: ty } }))).status, 403);
  assert.equal(calls.length, 0);
});

await t('bac à sable (« sandbox ») et configuration absente', async () => {
  calls.length = 0;
  const env2 = { ...ENV, AT_USERNAME: 'sandbox', AT_SENDER_ID: '' };
  await makeHandler({ env: (k) => env2[k], fetch: atFetch(201, [{ statusCode: 101 }]), Webhook })(signed(ev));
  assert.equal(calls[0].url, 'https://api.sandbox.africastalking.com/version1/messaging');
  assert.equal(new URLSearchParams(calls[0].init.body).get('from'), null);
  const none = await makeHandler({ env: () => undefined, fetch: atFetch(201, []), Webhook })(signed(ev));
  assert.equal(none.status, 500);
});

console.log(`\n${passed}/${passed + failed} tests crochet SMS réussis`);
process.exit(failed ? 1 : 0);
