// Fii La — le Manager Fii La Carrière sur WhatsApp (API WhatsApp Business de Meta, « Cloud API »).
//   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…  vérification du webhook par Meta ;
//   POST (Meta, signé X-Hub-Signature-256)  messages reçus des ambassadeurs : même conversation que dans l'application ; le Manager
//        répond sur WhatsApp (règles, ou IA si activée) ; un numéro inconnu reçoit le lien d'inscription ;
//   POST { action: 'push', ambassador }  (membre de l'équipe connecté) : envoie sur WhatsApp la dernière réponse de l'équipe, si
//        l'ambassadeur a écrit sur WhatsApp dans les dernières 24 heures (règle de Meta).
// Rien ne part si le réglage amb_whatsapp vaut 0. Toujours 200 à Meta (sinon Meta renvoie le même message en boucle).
// Secrets (Supabase → Edge Functions → Secrets, saisis par le fondateur) :
//   WA_TOKEN          jeton d'accès permanent (utilisateur système du Business Manager)
//   WA_PHONE_ID       identifiant du numéro WhatsApp Business (Phone number ID)
//   WA_APP_SECRET     clé secrète de l'application Meta (contrôle de la signature)
//   WA_VERIFY_TOKEN   jeton choisi par le fondateur pour la vérification du webhook
//   PUBLIC_URL        facultatif : adresse publique de l'application (lien d'inscription)
// Module sans dépendance (testé sous Node, déployé sous Deno).
import { draftReply } from './manager.mjs';

export const GRAPH = 'https://graph.facebook.com/v21.0';
export const UNKNOWN_TEXT = (url) => `Bonjour ! Ici le Manager de Fii La Carrière. Ce numéro n’est pas encore celui d’un ambassadeur Fii La. Pour nous rejoindre : ${url}#/carriere`;

async function hmacHex(secret, raw) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(raw));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function same(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

// Messages texte reçus dans une notification Meta : [{ from, id, text }] (texte vide pour un vocal, une image…).
export function inboundMessages(payload) {
  const out = [];
  for (const e of (payload && payload.entry) || []) for (const c of e.changes || []) for (const m of (c.value && c.value.messages) || []) {
    out.push({ from: String(m.from || ''), id: String(m.id || ''), text: m.type === 'text' && m.text ? String(m.text.body || '') : '' });
  }
  return out;
}

export function makeHandler({ env, fetch, timeoutMs = 20000 }) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });
  const base = () => String(env('SUPABASE_URL') || '').replace(/\/$/, '');
  async function rest(fn, args, token) {
    const key = token ? env('SUPABASE_ANON_KEY') : env('SUPABASE_SERVICE_ROLE_KEY');
    const r = await fetch(`${base()}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + (token || key) }, body: JSON.stringify(args || {}) });
    const body = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error((body && body.message) || 'rpc ' + r.status); e.status = r.status; throw e; }
    return body;
  }
  async function send(to, body) {
    if (!env('WA_TOKEN') || !env('WA_PHONE_ID') || !to || !body) return false;
    const r = await fetch(`${GRAPH}/${env('WA_PHONE_ID')}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env('WA_TOKEN') },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: String(body).slice(0, 4000), preview_url: true } }) });
    return r.ok;
  }
  async function handleInbound(m) {
    const r = await rest('fiila_wa_inbound', { p_phone: m.from, p_body: m.text, p_wamid: m.id });
    if (r.off || r.duplicate || r.excluded) return;
    if (!r.known) return send(m.from, UNKNOWN_TEXT(String(env('PUBLIC_URL') || 'https://aramislab0.github.io/fii-la/').replace(/\/?$/, '/')));
    if (r.reply) return send(m.from, r.reply);
    if (r.pending) {
      const ctx = await rest('fiila_amb_manager_context', { p_message: r.message });
      const d = await draftReply({ env, fetch, timeoutMs }, ctx);
      await rest('fiila_amb_manager_post', { p_message: r.message, p_reply: d.reply, p_tags: d.tags, p_escalate: d.escalate });
      return send(m.from, d.reply);
    }
  }
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    if (req.method === 'GET') {
      const ok = url.searchParams.get('hub.mode') === 'subscribe' && env('WA_VERIFY_TOKEN') && url.searchParams.get('hub.verify_token') === env('WA_VERIFY_TOKEN');
      return ok ? new Response(url.searchParams.get('hub.challenge') || '', { status: 200 }) : new Response('forbidden', { status: 403 });
    }
    if (req.method !== 'POST') return json(405, { error: 'method' });
    const raw = await req.text();
    let body;
    try { body = JSON.parse(raw || '{}'); } catch { return json(400, { error: 'invalid' }); }
    // Réponse de l'équipe à pousser sur WhatsApp.
    if (body.action === 'push') {
      const token = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (!token) return json(401, { error: 'auth_required' });
      try {
        const me = await rest('fiila_bo_me', {}, token);
        if (!me || !me.staff || !(me.perms || []).includes('ambassadors')) return json(403, { error: 'not_allowed' });
        const p = await rest('fiila_wa_push_data', { p_amb: body.ambassador });
        if (!p.open || !p.body) return json(200, { ok: true, sent: false });
        return json(200, { ok: true, sent: await send(p.to, p.body) });
      } catch (e) { return json(e.status === 400 ? 400 : 502, { error: 'failed' }); }
    }
    // Notification de Meta : signature obligatoire.
    const secret = env('WA_APP_SECRET');
    const sig = String(req.headers.get('x-hub-signature-256') || '').replace(/^sha256=/, '');
    if (!secret || !sig || !same(sig, await hmacHex(secret, raw))) return new Response('bad signature', { status: 401 });
    for (const m of inboundMessages(body)) {
      try { await handleInbound(m); } catch (_e) { /* un message en échec n'empêche pas les autres ; la réponse de secours arrive à la lecture suivante */ }
    }
    return json(200, { ok: true });
  };
}
