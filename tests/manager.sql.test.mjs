// Tests SQL : Manager Fii La Carrière — messages d'étape, missions du jour selon l'objectif et les commerçants, conversation
// (classement, réponse sans IA, remontée d'un problème, IA : rôle service seulement), analyse et propositions, back-office et
// rôle « Head of Stratégie et Développement ».
import assert from 'node:assert/strict';
import { createDb, rpc } from './db.mjs';

const db = await createDb();
let passed = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); passed++; results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
}
const ok = async (fn, args, opt) => { const r = await rpc(db, fn, args, opt); assert.equal(r.status, 200, `${fn} → ${JSON.stringify(r.body)}`); return r.body; };
const ko = async (fn, args, code, opt) => {
  const r = await rpc(db, fn, args, opt);
  assert.equal(r.status, 400, `${fn} aurait dû échouer, a renvoyé ${JSON.stringify(r.body)}`);
  if (code) assert.match(r.body.message, new RegExp(code));
};
const one = async (sql, a) => (await db.query(sql, a)).rows[0];
const user = async (email, role = null) => {
  const id = (await one(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email])).id;
  await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, $2)`, [id, email.split('@')[0]]);
  if (role) await db.query(`insert into fiila.staff (user_id, role) values ($1, $2)`, [id, role]);
  return { uid: id };
};
const SVC = { role: 'service_role' };
const GOOD = [1, 1, 0, 1, 0, 1, 1, 1, 1, 0];
let A, ADMIN, HEAD, AID;

await t('inscription : le Manager souhaite la bienvenue ; mission du jour = la formation', async () => {
  A = await user('awa.mgr@example.test'); ADMIN = await user('admin.mgr@example.test', 'super_admin'); HEAD = await user('head.mgr@example.test', 'strategy');
  await ok('fiila_ambassador_register', { p: { name: 'Awa Ndiaye', phone: '77 600 00 01', zone: 'Yoff', payout_method: 'wave', charter: true } }, A);
  AID = (await one(`select id from fiila.ambassadors where name = 'Awa Ndiaye'`)).id;
  const msgs = await ok('fiila_amb_messages', {}, A);
  assert.equal(msgs.length, 1); assert.equal(msgs[0].author, 'manager'); assert.match(msgs[0].body, /Bienvenue Awa/);
  const today = await ok('fiila_amb_today', {}, A);
  assert.equal(today.tasks.length, 1); assert.match(today.tasks[0].title, /formation/);
  assert.equal(today.unread, 0, 'lu en ouvrant la conversation');
});

await t('étapes : test réussi puis profil validé → messages du Manager ; missions de prospection selon l’objectif du mois', async () => {
  await ok('fiila_ambassador_quiz', { p_answers: GOOD }, A);
  await ok('fiila_admin_ambassador_decide', { p_id: AID, p_decision: 'approve', p_note: null }, ADMIN);
  const msgs = await ok('fiila_amb_messages', {}, A);
  assert.match(msgs.map((m) => m.body).join(' | '), /Bravo pour le test[\s\S]*profil est validé/);
  // Objectif fixé par le Head of Stratégie (pas par un rôle sans ce droit).
  await ko('fiila_bo_objective_set', { p: { brief: 'x' } }, 'not_allowed', A);
  await ok('fiila_bo_objective_set', { p: { target_active: 20, target_new: 40, focus_types: ['restauration', 'inconnu'], focus_zones: ['Yoff', 'Ouakam'], brief: 'Priorité aux restaurants de Yoff et Ouakam.' } }, HEAD);
  await db.query(`delete from fiila.amb_tasks where ambassador_id = $1`, [AID]); // nouveau jour
  const today = await ok('fiila_amb_today', {}, A);
  assert.equal(today.objective.brief, 'Priorité aux restaurants de Yoff et Ouakam.');
  assert.deepEqual(today.objective.focus_types, ['restauration'], 'type inconnu écarté');
  const p = today.tasks.find((x) => x.kind === 'prospect');
  assert.match(p.title, /restauration · Yoff, Ouakam/);
  assert.ok(today.tasks.length >= 2 && today.tasks.length <= 3);
  // Pas de doublon le même jour.
  assert.equal((await ok('fiila_amb_today', {}, A)).tasks.length, today.tasks.length);
});

await t('missions : un commerçant lié devient une mission « faire passer au niveau » ; mission faite avec retour → conversation', async () => {
  const CODE = (await one(`select code from fiila.ambassadors where id = $1`, [AID])).code;
  const k = (await ok('fiila_shop_save', { p_key: null, p: { name: 'Resto Fatou [TEST]', business_type: 'restauration' } })).key;
  await ok('fiila_ambassador_link', { p_key: k, p_code: CODE });
  await db.query(`delete from fiila.amb_tasks where ambassador_id = $1`, [AID]);
  const today = await ok('fiila_amb_today', {}, A);
  const s = today.tasks.find((x) => x.kind === 'shop');
  assert.match(s.title, /Aider Resto Fatou \[TEST\] à passer au niveau 1/); assert.match(s.body, /5 article\(s\) avec photo/);
  const r = await ok('fiila_amb_task_done', { p_id: s.id, p_feedback: 'Elle refuse, pas le temps cette semaine' }, A);
  assert.equal(r.left, today.tasks.length - 1);
  const m = await one(`select tags from fiila.amb_messages where ambassador_id = $1 and body like '[Mission%' `, [AID]);
  assert.ok(m.tags.includes('objection') && m.tags.includes('retour'));
  const B = await user('autre.mgr@example.test');
  await ko('fiila_amb_task_done', { p_id: s.id, p_feedback: null }, 'not_found', B);
});

await t('conversation sans IA : classement, réponse immédiate selon les règles, problème remonté à l’équipe', async () => {
  const r1 = await ok('fiila_amb_message_send', { p_body: 'Combien je gagne au niveau 2 ?' }, A);
  assert.equal(r1.pending, false);
  let msgs = await ok('fiila_amb_messages', {}, A);
  assert.match(msgs.at(-1).body, /5000 au niveau 2/);
  await ok('fiila_amb_message_send', { p_body: 'L’application plante quand je mets une photo' }, A);
  msgs = await ok('fiila_amb_messages', {}, A);
  assert.match(msgs.at(-1).body, /transmets tout de suite à l’équipe/);
  const esc = await one(`select escalate, tags from fiila.amb_messages where body like 'L’application plante%'`);
  assert.equal(esc.escalate, true); assert.ok(esc.tags.includes('probleme'));
  await ko('fiila_amb_message_send', { p_body: '   ' }, 'message_required', A);
});

await t('IA activée : message en attente ; contexte et réponse réservés au rôle service ; secours après une minute', async () => {
  await db.query(`update fiila.settings set value = '1' where key = 'amb_manager_llm'`);
  const r = await ok('fiila_amb_message_send', { p_body: 'Comment convaincre un restaurant ?' }, A);
  assert.equal(r.pending, true);
  await ko('fiila_amb_manager_context', { p_message: r.id }, 'permission denied', A);
  await ko('fiila_amb_manager_post', { p_message: r.id, p_reply: 'faux', p_tags: [], p_escalate: false }, 'permission denied', A);
  const ctx = await ok('fiila_amb_manager_context', { p_message: r.id }, SVC);
  assert.equal(ctx.message.body, 'Comment convaincre un restaurant ?');
  assert.equal(ctx.objective.brief, 'Priorité aux restaurants de Yoff et Ouakam.');
  assert.ok(!('payout_phone' in ctx.ambassador) && !('phone' in ctx.ambassador), 'pas de numéro envoyé au modèle');
  assert.equal(ctx.rules.length, 10); assert.ok(ctx.fallback);
  await ok('fiila_amb_manager_post', { p_message: r.id, p_reply: 'Montrez-lui une vraie vitrine de restaurant.', p_tags: ['question', 'objection', 'pirate'], p_escalate: false }, SVC);
  const dup = await ok('fiila_amb_manager_post', { p_message: r.id, p_reply: 'bis', p_tags: [], p_escalate: false }, SVC);
  assert.equal(dup.duplicate, true);
  const tags = (await one(`select tags from fiila.amb_messages where id = $1`, [r.id])).tags;
  assert.ok(!tags.includes('pirate'));
  // Fonction IA injoignable : la réponse de secours arrive à la lecture suivante, après une minute.
  const r2 = await ok('fiila_amb_message_send', { p_body: 'Et pour les photos ?' }, A);
  await db.query(`update fiila.amb_messages set created_at = now() - interval '2 minutes' where id = $1`, [r2.id]);
  const msgs = await ok('fiila_amb_messages', {}, A);
  assert.match(msgs.at(-1).body, /lumière du jour/);
  await db.query(`update fiila.settings set value = '0' where key = 'amb_manager_llm'`);
});

await t('analyse : objections fréquentes → proposition de mission ; décision du Head of Stratégie → mission active ; journal', async () => {
  for (const b of ['Il refuse', 'Pas intéressé', 'Elle a pas confiance']) await ok('fiila_amb_message_send', { p_body: b }, A);
  const d = await ok('fiila_bo_career', {}, HEAD);
  assert.equal(d.can_strategy, true);
  assert.equal(d.objective.target_active, 20);
  const prop = d.notes.find((n) => n.kind === 'mission');
  assert.ok(prop, 'proposition de mission');
  assert.ok(d.report && d.report.data.messages_7d >= 5);
  assert.ok(d.threads.find((x) => x.name === 'Awa Ndiaye').escalated >= 1);
  // Le rôle « finances » voit, mais ne décide pas.
  const FIN = await user('fin.mgr@example.test', 'finance');
  await ok('fiila_bo_career', {}, FIN);
  await ko('fiila_bo_note_decide', { p_id: prop.id, p_decision: 'accepted' }, 'not_allowed', FIN);
  await ok('fiila_bo_note_decide', { p_id: prop.id, p_decision: 'accepted' }, HEAD);
  assert.equal((await one(`select count(*)::int n from fiila.amb_missions where source = 'manager' and status = 'active'`)).n, 1);
  await ko('fiila_bo_note_decide', { p_id: prop.id, p_decision: 'rejected' }, 'not_found', HEAD);
  assert.equal((await one(`select count(*)::int n from fiila.admin_log where action = 'career_note_accepted'`)).n, 1);
  // Une seule analyse par jour.
  const before = (await one(`select count(*)::int n from fiila.amb_notes where kind = 'report'`)).n;
  await ok('fiila_bo_career', {}, HEAD);
  assert.equal((await one(`select count(*)::int n from fiila.amb_notes where kind = 'report'`)).n, before);
});

await t('back-office : conversation (lue, réponse de l’équipe), missions (créer, retirer), tableau de bord, rôle strategy', async () => {
  const th = await ok('fiila_bo_career_thread', { p_amb: AID }, ADMIN);
  assert.ok(th.messages.some((m) => m.escalate));
  assert.equal((await ok('fiila_bo_career', {}, ADMIN)).threads.find((x) => x.name === 'Awa Ndiaye').waiting, 0, 'lu');
  await ok('fiila_bo_career_reply', { p_amb: AID, p_body: 'Bonjour Awa, on corrige l’envoi de photo aujourd’hui.' }, ADMIN);
  const mine = await ok('fiila_amb_messages', {}, A);
  assert.equal(mine.at(-1).author, 'staff');
  const m = await ok('fiila_bo_mission_save', { p: { kind: 'daily', title: 'Visiter 2 restaurants de Ouakam', body: 'Montrez la vitrine Saveurs de Mame.', audience: 'active' } }, HEAD);
  await ok('fiila_bo_mission_save', { p: { id: m.id, status: 'retired' } }, HEAD);
  await ko('fiila_bo_mission_save', { p: { title: 'x' } }, 'not_allowed', A);
  const ov = await ok('fiila_bo_overview', {}, HEAD);
  assert.ok('proposals' in ov.queues && 'career' in ov.queues);
  assert.deepEqual((await ok('fiila_bo_me', {}, HEAD)).perms.sort(), ['ambassadors', 'dashboard', 'shops', 'strategy']);
  // Le super admin peut inviter un Head of Stratégie.
  const inv = await ok('fiila_bo_invite', { p_email: 'head2@example.test', p_role: 'strategy' }, ADMIN);
  assert.ok(inv.token);
  // Réglages : IA et propositions dans l'app.
  const st = await ok('fiila_bo_settings', {}, ADMIN);
  assert.equal(st.amb_manager_llm, 0); assert.equal(st.nudges, 1);
  await ok('fiila_bo_setting_set', { p_key: 'amb_manager_llm', p_value: 1 }, ADMIN);
  await ko('fiila_bo_setting_set', { p_key: 'amb_manager_llm', p_value: 2 }, 'invalid_value', ADMIN);
  await ok('fiila_bo_setting_set', { p_key: 'amb_manager_llm', p_value: 0 }, ADMIN);
});

await t('IA : données d’analyse et note enregistrée par le rôle service seulement', async () => {
  await ko('fiila_amb_manager_digest_data', {}, 'permission denied', ADMIN);
  const d = await ok('fiila_amb_manager_digest_data', {}, SVC);
  assert.ok(d.report && Array.isArray(d.messages) && d.messages.length >= 5);
  await ok('fiila_amb_manager_note', { p_kind: 'training', p_title: 'Fiche objection', p_body: 'Ajouter un exemple.' }, SVC);
  await ko('fiila_amb_manager_note', { p_kind: 'report', p_title: 'x', p_body: 'y' }, 'invalid_payload', SVC);
  assert.ok((await ok('fiila_bo_career', {}, HEAD)).notes.some((n) => n.ia && n.title === 'Fiche objection'));
});

await t('découverte progressive : réglage public, mesure anonyme des suggestions, taux dans le back-office', async () => {
  assert.deepEqual(await ok('fiila_app_flags', {}), { nudges: true, onboarding: true, discover: true });
  for (const v of ['shop_courier:shown', 'shop_courier:shown', 'shop_courier:click', 'home_shop:shown', 'home_shop:dismiss']) await ok('fiila_track', { p_event: 'nudge', p_variant: v });
  await ko('fiila_track', { p_event: 'nudge', p_variant: 'x:hack' }, 'invalid_event');
  await ko('fiila_bo_nudges', {}, 'not_allowed', A);
  const d = await ok('fiila_bo_nudges', {}, ADMIN);
  assert.equal(d.on, true);
  const c = d.items.find((x) => x.id === 'shop_courier');
  assert.equal(Number(c.shown), 2); assert.equal(Number(c.click), 1);
  await ok('fiila_bo_setting_set', { p_key: 'nudges', p_value: 0 }, ADMIN);
  assert.deepEqual(await ok('fiila_app_flags', {}), { nudges: false, onboarding: true, discover: true });
  await ok('fiila_bo_setting_set', { p_key: 'nudges', p_value: 1 }, ADMIN);
});

await t('WhatsApp : numéro du Manager (Head of Stratégie), message reçu sur WhatsApp dans la même conversation, réponse sur le même canal', async () => {
  await ko('fiila_bo_manager_whatsapp_set', { p_phone: '77 999 00 00' }, 'not_allowed', A);
  await ko('fiila_bo_manager_whatsapp_set', { p_phone: '12' }, 'phone_required', HEAD);
  assert.equal((await ok('fiila_bo_manager_whatsapp_set', { p_phone: '77 999 00 00' }, HEAD)).whatsapp, '221779990000');
  assert.equal((await ok('fiila_amb_today', {}, A)).whatsapp, '221779990000');
  assert.equal((await ok('fiila_bo_career', {}, ADMIN)).whatsapp, '221779990000');
  // Message WhatsApp d'Awa (numéro au format international) : reconnu, réponse sans IA sur WhatsApp.
  await ko('fiila_wa_inbound', { p_phone: '221776000001', p_body: 'x', p_wamid: 'w0' }, 'permission denied', A);
  assert.equal((await ok('fiila_wa_inbound', { p_phone: '221776000001', p_body: 'x', p_wamid: 'w0' }, SVC)).off, true, 'API coupée : rien enregistré');
  await ok('fiila_bo_setting_set', { p_key: 'amb_whatsapp', p_value: 1 }, ADMIN);
  const r = await ok('fiila_wa_inbound', { p_phone: '221776000001', p_body: 'Mon code ne marche pas', p_wamid: 'wamid.1' }, SVC);
  assert.equal(r.known, true); assert.match(r.reply, /transmets/);
  assert.equal((await ok('fiila_wa_inbound', { p_phone: '221776000001', p_body: 'Mon code ne marche pas', p_wamid: 'wamid.1' }, SVC)).duplicate, true, 'renvoi de Meta ignoré');
  const last2 = (await db.query(`select author, channel from fiila.amb_messages where ambassador_id = $1 order by created_at desc limit 2`, [AID])).rows;
  assert.deepEqual(last2.map((x) => x.channel), ['whatsapp', 'whatsapp']);
  const app = await ok('fiila_amb_messages', {}, A);
  assert.equal(app.at(-2).channel, 'whatsapp', 'visible aussi dans l’application');
  assert.equal((await ok('fiila_wa_inbound', { p_phone: '221700000000', p_body: 'Bonjour', p_wamid: 'wamid.2' }, SVC)).known, false);
  assert.match((await ok('fiila_wa_inbound', { p_phone: '+221 77 600 00 01', p_body: '', p_wamid: 'wamid.3' }, SVC)).reply, /messages écrits/);
  // Avec IA : en attente, la réponse rédigée part sur WhatsApp.
  await db.query(`update fiila.settings set value = '1' where key = 'amb_manager_llm'`);
  const p = await ok('fiila_wa_inbound', { p_phone: '221776000001', p_body: 'Comment avoir plus de clientes ?', p_wamid: 'wamid.4' }, SVC);
  assert.equal(p.pending, true);
  await ok('fiila_amb_manager_post', { p_message: p.message, p_reply: 'Partagez la vitrine.', p_tags: [], p_escalate: false }, SVC);
  assert.equal((await one(`select channel from fiila.amb_messages where author = 'manager' order by created_at desc limit 1`)).channel, 'whatsapp');
  await db.query(`update fiila.settings set value = '0' where key = 'amb_manager_llm'`);
  // Équipe : fenêtre de 24 h ouverte seulement si l'API est activée et l'agent a écrit sur WhatsApp.
  const th = await ok('fiila_bo_career_thread', { p_amb: AID }, ADMIN);
  assert.equal(th.ambassador.wa, '221776000001'); assert.equal(th.ambassador.wa_open, true);
  await ok('fiila_bo_career_reply', { p_amb: AID, p_body: 'On regarde votre code.' }, ADMIN);
  const push = await ok('fiila_wa_push_data', { p_amb: AID }, SVC);
  assert.deepEqual(push, { to: '221776000001', body: 'On regarde votre code.', open: true });
  await ok('fiila_bo_setting_set', { p_key: 'amb_whatsapp', p_value: 0 }, ADMIN);
  assert.equal((await ok('fiila_wa_push_data', { p_amb: AID }, SVC)).open, false, 'API coupée : rien n’est envoyé');
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL Manager Fii La Carrière réussis`);
process.exit(passed === results.length ? 0 : 1);
