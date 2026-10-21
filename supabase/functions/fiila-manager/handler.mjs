// Fii — le Manager Fii Carrière (IA). Deux actions, appelées par l'application avec la session de la personne :
//   { action: 'reply', message }  un agent vient d'écrire : réponse rédigée par le modèle, enregistrée dans la conversation ;
//   { action: 'digest' }          un membre de l'équipe (droit « strategy ») demande l'analyse : rapport et propositions.
// Sans clé d'API, ou réglage amb_manager_llm = 0, ou réponse du modèle inutilisable : la réponse du Manager sans IA (règles du
// programme) est enregistrée à la place. Garde-fous dans les consignes ET dans la base : le modèle ne décide jamais d'un gain,
// d'un statut ni d'une validation ; il ne reçoit aucun numéro de téléphone.
// Secrets (Supabase → Edge Functions → Secrets, saisis par le fondateur) :
//   ANTHROPIC_API_KEY   clé de l'API Claude (facturée à l'usage)
//   MANAGER_MODEL       facultatif, modèle utilisé (par défaut claude-haiku-5-5)
// SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase à toute fonction.
// Module sans dépendance (testé sous Node, déployé sous Deno).

export const DEFAULT_MODEL = 'claude-haiku-5-5';
const TAGS = ['question', 'objection', 'probleme', 'gains', 'idee', 'positif', 'retour', 'formation', 'motivation'];

export function replyPrompt(ctx) {
  const a = ctx.ambassador || {}, o = ctx.objective;
  const shops = (a.shops || []).map((s) => `- ${s.shop} : niveau ${s.level}/3${s.expired ? ' (délai dépassé)' : ''}, ${s.photos} article(s) avec photo, vitrine ${s.public ? 'ouverte' : 'fermée'}, ${s.clients || 0} cliente(s)`).join('\n') || '- aucun commerçant pour l’instant';
  return [
    'Tu es le Manager de Fii Carrière, le programme des Agents Fii : des personnes rémunérées pour installer et accompagner les commerçants sur Fii (boutique en ligne gratuite pour les commerçants de Dakar : vitrine, commandes, factures, adresse exacte des clientes en une photo).',
    'Tu encadres chaque agent au quotidien : tu l’aides à réussir ses missions, tu réponds à ses questions, tu le motives, tu recueilles ses retours du terrain. Tu travailles sous la tutelle du Head of Stratégie et Développement : tu suis le cap du mois.',
    'Style : français simple et chaleureux, phrases courtes, tutoiement interdit (vouvoiement), 2 à 5 phrases, une action concrète à la fin. Pas de jargon, pas de superlatifs, pas d’émojis en excès (au plus un).',
    'Règles absolues : ne promets jamais d’argent, de ventes ni de délai de paiement autre que les règles ; ne décide jamais d’un gain, d’une validation, d’une suspension ou d’une exclusion (c’est l’équipe) ; n’invente aucune fonction de l’application ; ne demande jamais de numéro de téléphone ni de donnée de cliente ; en cas de problème technique, de fraude, de conflit ou de question que tu ne sais pas traiter, dis que tu transmets à l’équipe et mets "escalate": true.',
    'Règles du programme :\n' + (ctx.rules || []).map((r) => '- ' + r).join('\n'),
    `Gains par niveau : ${(ctx.rewards || []).join(' / ')} FCFA (niveau 1 / 2 / 3).`,
    o ? `Cap du mois : ${o.brief || '—'} ; types de commerce prioritaires : ${(o.focus_types || []).join(', ') || '—'} ; quartiers : ${(o.focus_zones || []).join(', ') || '—'}.` : 'Pas d’objectif fixé ce mois-ci.',
    `Agent : ${a.name}, ${a.zone || 'quartier non précisé'}, statut ${a.status}, grade ${a.grade}, code ${a.code}.`,
    'Ses commerçants :\n' + shops,
    'Ses missions du jour :\n' + ((ctx.tasks || []).map((t) => `- ${t.done ? '[fait] ' : ''}${t.title}`).join('\n') || '- aucune'),
    'Réponds UNIQUEMENT par un objet JSON : {"reply": "...", "tags": [...], "escalate": false}. tags parmi : ' + TAGS.join(', ') + '.'
  ].join('\n\n');
}

export function digestPrompt(d) {
  return [
    'Tu es le Manager de Fii Carrière (programme des Agents Fii, Dakar). Tu prépares l’analyse hebdomadaire pour le Head of Stratégie et Développement.',
    'Données de la semaine (JSON) :\n' + JSON.stringify(d).slice(0, 20000),
    'Produis au plus 4 éléments, utiles et concrets, fondés sur les données (cite les chiffres) : constats ("insight"), améliorations de formation ("training"), nouvelles missions ("mission"). Pas de généralités. Ne propose rien qui change les gains ou les règles de paiement.',
    'Réponds UNIQUEMENT par un objet JSON : {"items": [{"kind": "insight|training|mission", "title": "... (80 caractères au plus)", "body": "... (3 phrases au plus)"}]}.'
  ].join('\n\n');
}

export function parseJson(text) {
  const s = String(text || ''), i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; }
}

// Appel au modèle ; null si pas de clé, erreur ou réponse illisible.
export async function askClaude({ env, fetch, timeoutMs = 25000 }, system, user, maxTokens) {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) return null;
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: env('MANAGER_MODEL') || DEFAULT_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }) });
    if (!r.ok) return null;
    const b = await r.json();
    return parseJson((b.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''));
  } catch { return null; } finally { clearTimeout(timer); }
}
// Réponse du Manager à un message (contexte de fiila_amb_manager_context) : IA si activée et utilisable, sinon règles.
export async function draftReply(deps, ctx) {
  let out = ctx.llm ? await askClaude(deps, replyPrompt(ctx), ctx.message.body, 600) : null;
  const usable = !!(out && typeof out.reply === 'string' && out.reply.trim().length > 1);
  if (!usable) out = { reply: ctx.fallback, tags: [], escalate: (ctx.message.tags || []).includes('probleme') };
  return { reply: String(out.reply).trim().slice(0, 1500), tags: Array.isArray(out.tags) ? out.tags.filter((t) => TAGS.includes(t)) : [], escalate: !!out.escalate, mode: usable ? 'ia' : 'rules' };
}

export function makeHandler({ env, fetch, timeoutMs = 25000 }) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });
  const base = () => String(env('SUPABASE_URL') || '').replace(/\/$/, '');
  async function rest(fn, args, token) {
    const key = token ? env('SUPABASE_ANON_KEY') : env('SUPABASE_SERVICE_ROLE_KEY');
    const r = await fetch(`${base()}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + (token || key) }, body: JSON.stringify(args || {}) });
    const body = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error((body && body.message) || 'rpc ' + r.status); e.status = r.status; throw e; }
    return body;
  }
  const claude = (system, user, maxTokens) => askClaude({ env, fetch, timeoutMs }, system, user, maxTokens);
  async function userOf(token) {
    const r = await fetch(`${base()}/auth/v1/user`, { headers: { apikey: env('SUPABASE_ANON_KEY'), Authorization: 'Bearer ' + token } });
    if (!r.ok) return null;
    const u = await r.json().catch(() => null);
    return u && u.id ? u.id : null;
  }
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json(405, { error: 'method' });
    const token = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json(401, { error: 'auth_required' });
    let body;
    try { body = await req.json(); } catch { return json(400, { error: 'invalid' }); }
    const uid = await userOf(token);
    if (!uid) return json(401, { error: 'auth_required' });
    try {
      if (body.action === 'reply') {
        const ctx = await rest('fiila_amb_manager_context', { p_message: body.message });
        if (ctx.user_id !== uid) return json(403, { error: 'not_allowed' });
        if (ctx.message.answered) return json(200, { ok: true, mode: 'done' });
        const d = await draftReply({ env, fetch, timeoutMs }, ctx);
        await rest('fiila_amb_manager_post', { p_message: ctx.message.id, p_reply: d.reply, p_tags: d.tags, p_escalate: d.escalate });
        return json(200, { ok: true, mode: d.mode });
      }
      if (body.action === 'digest') {
        const me = await rest('fiila_bo_me', {}, token);
        if (!me || !me.staff || !(me.perms || []).includes('strategy')) return json(403, { error: 'not_allowed' });
        const d = await rest('fiila_amb_manager_digest_data', {});
        const out = await claude('Tu réponds uniquement en JSON valide.', digestPrompt(d), 1500);
        if (!out || !Array.isArray(out.items)) return json(200, { ok: true, mode: 'rules', items: 0 });
        let n = 0;
        for (const it of out.items.slice(0, 4)) {
          if (!it || !['insight', 'training', 'mission'].includes(it.kind) || !it.title) continue;
          await rest('fiila_amb_manager_note', { p_kind: it.kind, p_title: String(it.title).slice(0, 140), p_body: String(it.body || '').slice(0, 2000) });
          n++;
        }
        return json(200, { ok: true, mode: 'ia', items: n });
      }
      return json(400, { error: 'invalid' });
    } catch (e) {
      return json(e.status === 400 ? 400 : 502, { error: 'failed' });
    }
  };
}
