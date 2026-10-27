// Fii — domaine propre d'une boutique : échanges avec Cloudflare for SaaS (docs/PLAN-DOMAINES-FII.md §4).
// Appelée par l'application (clé de boutique ou session) et par le back-office (session de l'équipe) :
//   { action: 'sync', id, key }     crée le nom d'hôte chez Cloudflare s'il n'existe pas, puis relit son état ;
//                                   écrit le résultat (statut, certificat, enregistrements à afficher, erreur) dans la base.
//   { action: 'cleanup', id, key }  supprime chez Cloudflare un nom d'hôte déjà déconnecté ou expiré dans Fii.
// Le droit d'agir est vérifié par la base (fiila_domain_target, avec l'identité de la personne qui appelle) ; l'écriture du
// résultat utilise la clé de service (fiila_domain_cf_update n'est ouverte à aucun rôle public).
// Les enregistrements affichés à la boutique sont ceux que Cloudflare renvoie, plus le CNAME vers la cible : rien n'est inventé.
// Secrets (Supabase → Edge Functions → Secrets, saisis par le fondateur ; jamais dans le dépôt) :
//   CF_API_TOKEN      jeton d'API limité à la zone (Custom Hostnames et SSL : édition)
//   CF_ZONE_ID        identifiant de la zone des sites (getfii.app)
//   CF_SAAS_TARGET    cible du CNAME des boutiques : sites.getfii.app
// Sans ces secrets : { configured: false } et la demande reste « en attente » (rien n'est envoyé nulle part).
// SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.

import { corsFor, readText, MB } from '../_shared/http.mjs';

const CF = 'https://api.cloudflare.com/client/v4';
const LIVE = ['pending', 'verifying', 'active', 'failed'];

// Enregistrements à afficher, à partir de la réponse de Cloudflare (custom hostname).
export function recordsOf(host, target, cf) {
  const out = [{ type: 'CNAME', name: host, value: target, purpose: 'route' }];
  const ov = cf && cf.ownership_verification;
  if (ov && ov.name && ov.value && cf.status !== 'active') out.push({ type: String(ov.type || 'txt').toUpperCase(), name: ov.name, value: ov.value, purpose: 'ownership' });
  const vr = (cf && cf.ssl && Array.isArray(cf.ssl.validation_records)) ? cf.ssl.validation_records : [];
  for (const r of vr) {
    if (r.txt_name && r.txt_value) out.push({ type: 'TXT', name: r.txt_name, value: r.txt_value, purpose: 'certificate' });
    else if (r.cname && r.cname_target) out.push({ type: 'CNAME', name: r.cname, value: r.cname_target, purpose: 'certificate' });
  }
  return out;
}
export function errorOf(cf) {
  const errs = [].concat((cf && cf.verification_errors) || [], (cf && cf.ssl && cf.ssl.validation_errors || []).map((e) => e.message || e));
  return errs.filter(Boolean).map(String).join(' ; ').slice(0, 300) || null;
}

export function makeHandler({ env, fetch }) {
  const base = () => String(env('SUPABASE_URL') || '').replace(/\/$/, '');
  // auth : en-tête Authorization de la personne (session ou clé publique) ; null = clé de service.
  // caller : { auth } = identité de la personne (session, ou aucune : clé publique seule, droits par la clé de boutique) ;
  // null = clé de service.
  async function rpc(fn, args, caller) {
    const key = caller ? env('SUPABASE_ANON_KEY') : env('SUPABASE_SERVICE_ROLE_KEY');
    const headers = { 'Content-Type': 'application/json', apikey: key };
    if (!caller) headers.Authorization = 'Bearer ' + key;
    else if (caller.auth) headers.Authorization = caller.auth;
    const r = await fetch(`${base()}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args || {}) });
    const body = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error((body && body.message) || 'rpc ' + r.status); e.status = r.status; e.code = /fiila:([a-z_]+)/.exec((body && body.message) || '')?.[1]; throw e; }
    return body;
  }
  async function cf(path, init = {}) {
    const r = await fetch(`${CF}/zones/${env('CF_ZONE_ID')}${path}`, { ...init,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env('CF_API_TOKEN') } });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok && body.success !== false, status: r.status, body };
  }
  const configured = () => !!(env('CF_API_TOKEN') && env('CF_ZONE_ID') && env('CF_SAAS_TARGET'));

  async function sync(d) {
    let res = null;
    if (d.cf_id) {
      const g = await cf(`/custom_hostnames/${encodeURIComponent(d.cf_id)}`);
      if (g.ok) res = g.body.result;
      else if (g.status !== 404) return { error: 'Cloudflare indisponible (' + g.status + ')' };
    }
    if (!res) {
      const c = await cf('/custom_hostnames', { method: 'POST', body: JSON.stringify({ hostname: d.hostname, ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } } }) });
      if (c.ok) res = c.body.result;
      else {
        // Déjà présent chez Cloudflare (demande précédente expirée ou déconnectée) : la base garantit qu'aucune autre boutique
        // ne détient ce nom aujourd'hui ; on reprend l'entrée existante, dont la propriété reste à prouver par le DNS.
        const l = await cf(`/custom_hostnames?hostname=${encodeURIComponent(d.hostname)}`);
        res = l.ok && Array.isArray(l.body.result) ? l.body.result.find((x) => x.hostname === d.hostname) : null;
        if (!res) return { error: ((c.body.errors || [])[0] || {}).message || 'Création refusée par Cloudflare' };
      }
    }
    return { cf_id: res.id, cf_status: res.status, ssl_status: res.ssl && res.ssl.status, records: recordsOf(d.hostname, env('CF_SAAS_TARGET'), res), error: errorOf(res) };
  }

  return async (req) => {
    const cors = corsFor(req);
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json(405, { error: 'method' });
    // Sans session (boutique sans compte, clé publique au nouveau format) : pas d'en-tête Authorization ; la base vérifie
    // alors les droits par la clé de la boutique.
    const auth = { auth: req.headers.get('authorization') || '' };
    let body;
    const raw = await readText(req, MB);
    if (raw === null) return json(413, { error: 'too_large' });
    try { body = JSON.parse(raw); } catch { return json(400, { error: 'invalid' }); }
    if (!body || !body.id || !['sync', 'cleanup'].includes(body.action)) return json(400, { error: 'invalid' });
    let d;
    try { d = await rpc('fiila_domain_target', { p_key: body.key || null, p_id: body.id }, auth); }
    catch (e) { return json(e.status === 400 ? 403 : 502, { error: e.code || 'not_allowed' }); }
    if (!configured()) return json(200, { configured: false, domain: d });
    try {
      if (body.action === 'cleanup') {
        if (LIVE.includes(d.status)) return json(409, { error: 'still_live' });
        if (d.cf_id) { const r = await cf(`/custom_hostnames/${encodeURIComponent(d.cf_id)}`, { method: 'DELETE' }); if (!r.ok && r.status !== 404) return json(502, { error: 'cloudflare' }); }
        return json(200, { configured: true, removed: true });
      }
      if (!LIVE.includes(d.status)) return json(409, { error: 'not_live' });
      const p = await sync(d);
      const out = await rpc('fiila_domain_cf_update', { p_id: d.id, p }, null);
      return json(200, { configured: true, domain: out });
    } catch (e) {
      return json(502, { error: 'failed' });
    }
  };
}
