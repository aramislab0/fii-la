// Fii La — envoi des codes de vérification par SMS via Africa's Talking (« Send SMS hook » de Supabase Auth).
// Supabase Auth génère le code et appelle cette fonction ; elle vérifie la signature (Standard Webhooks), puis transmet
// le SMS à Africa's Talking. Rien n'est enregistré : ni le numéro, ni le code. Aucun secret dans le code :
//   SEND_SMS_HOOK_SECRET  secret du crochet, fourni par Supabase (Authentication → Hooks), forme « v1,whsec_… »
//   AT_USERNAME           nom d'utilisateur de l'application Africa's Talking (« sandbox » pour le bac à sable)
//   AT_API_KEY            clé d'API Africa's Talking
//   AT_SENDER_ID          facultatif : nom d'expéditeur approuvé (sinon, le numéro par défaut d'Africa's Talking)
// Module sans dépendance d'exécution (testé sous Node, déployé sous Deno).

export const SMS_TEXT = (otp) => `Fii La : votre code est ${otp}. Ne le communiquez à personne.`;
const OK_CODES = new Set([100, 101, 102]); // Processed, Sent, Queued

export function recipient(ev) {
  const raw = (ev && ev.sms && ev.sms.phone) || (ev && ev.user && (ev.user.new_phone || ev.user.phone)) || '';
  const d = String(raw).replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? '+' + d : null;
}

export function makeHandler({ env, fetch, Webhook, timeoutMs = 4000 }) {
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  // Format d'erreur des crochets Supabase : { error: { http_code, message } }
  const fail = (code, message) => json(code, { error: { http_code: code, message } });
  return async (req) => {
    if (req.method !== 'POST') return fail(405, 'Méthode non autorisée');
    const secret = String(env('SEND_SMS_HOOK_SECRET') || '').replace(/^v1,whsec_/, '');
    const user = env('AT_USERNAME'), key = env('AT_API_KEY'), from = env('AT_SENDER_ID');
    if (!secret || !user || !key) return fail(500, 'Envoi des SMS non configuré');
    const payload = await req.text();
    let ev;
    try {
      ev = new Webhook(secret).verify(payload, Object.fromEntries(req.headers));
    } catch (_e) {
      return fail(401, 'Signature invalide');
    }
    // Seule la confirmation du numéro d'un compte existant est servie : une inscription ou une connexion par SMS
    // (non utilisées par Fii La) ne déclenche aucun envoi, donc aucun coût si quelqu'un appelle l'API directement.
    const type = ev && ev.sms && ev.sms.sms_type;
    if (type && type !== 'phone_change') return fail(403, 'Envoi de SMS réservé à la confirmation du numéro');
    const to = recipient(ev);
    const otp = String((ev && ev.sms && ev.sms.otp) || '');
    if (!to || !/^\d{4,10}$/.test(otp)) return fail(400, 'Numéro ou code manquant');
    const form = new URLSearchParams({ username: user, to, message: SMS_TEXT(otp) });
    if (from) form.set('from', from);
    const host = user === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(host + '/version1/messaging', {
        method: 'POST', signal: ctl.signal,
        headers: { apiKey: key, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const body = await res.json().catch(() => null);
      const r = body && body.SMSMessageData && body.SMSMessageData.Recipients && body.SMSMessageData.Recipients[0];
      if (!res.ok || !r || !OK_CODES.has(Number(r.statusCode))) {
        // Le statut d'Africa's Talking (jamais le numéro ni le code) aide à comprendre un refus : solde, expéditeur, réseau.
        console.error('africastalking', res.status, r ? r.status : (body && body.SMSMessageData && body.SMSMessageData.Message) || 'réponse inattendue');
        return fail(502, 'L’envoi du SMS a échoué');
      }
      return json(200, {});
    } catch (_e) {
      return fail(504, 'Africa’s Talking ne répond pas');
    } finally {
      clearTimeout(timer);
    }
  };
}
