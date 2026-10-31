// Tests SQL : salons (beauté & bien-être) — prestations à durée et caution, horaires, créneaux, réservation sans compte,
// caution par Wave ou Orange Money confirmée par le salon, expiration, annulation, réalisations copiées dans le stockage,
// modèle Premium « Rituel », back-office (fondateur, 31/10/2026 ; migration 20261031100000).
import assert from 'node:assert/strict';
import { createDb, rpc } from './db.mjs';

const db = await createDb();
let passed = 0;
const results = [];
async function t(name, fn) { try { await fn(); passed++; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } }
const ok = async (fn, args, opt) => { const r = await rpc(db, fn, args, opt); assert.equal(r.status, 200, `${fn} → ${JSON.stringify(r.body)}`); return r.body; };
const ko = async (fn, args, code, opt) => { const r = await rpc(db, fn, args, opt); assert.notEqual(r.status, 200, `${fn} aurait dû échouer : ${JSON.stringify(r.body)}`); if (code) assert.match(r.body.message, new RegExp(code)); };
const one = async (sql, a) => (await db.query(sql, a)).rows[0];
const F = { uid: (await one(`insert into auth.users (id, email) values (gen_random_uuid(), 'f@example.test') returning id`)).id };
await db.query(`insert into fiila.profiles (user_id, display_name) values ($1, 'Fondateur')`, [F.uid]);
await db.query(`insert into fiila.staff (user_id, role) values ($1, 'super_admin')`, [F.uid]);

const s = await ok('fiila_shop_save', { p_key: null, p: { name: 'Salon Test [TEST]', business_type: 'coiffure' } });
const KEY = s.key;
const v = await ok('fiila_shop_vitrine', { p_key: KEY, p: { public: true } });
const SLUG = v.slug;
const ALL = { 0: ['09:00', '21:00'], 1: ['09:00', '21:00'], 2: ['09:00', '21:00'], 3: ['09:00', '21:00'], 4: ['09:00', '21:00'], 5: ['09:00', '21:00'], 6: ['09:00', '21:00'] };
const day = async (n) => (await one(`select ((now() at time zone 'Africa/Dakar')::date + $1::int)::text d`, [n])).d;
const D1 = await day(1), D2 = await day(2);
let CUT, FADE;
const book = (prod, d, time, pay, phone) => ({ p_slug: SLUG, p: { product_id: prod, day: d, time, pay, customer: { name: 'Awa Test', phone: phone || '77 000 00 01' } } });

await t('prestation : durée et caution (entre 0 et le prix) enregistrées et renvoyées', async () => {
  await ko('fiila_product_save', { p_key: KEY, p: { name: 'Coupe', price: 5000, duration: 2 } }, 'invalid_duration');
  await ko('fiila_product_save', { p_key: KEY, p: { name: 'Coupe', price: 5000, deposit: 6000 } }, 'invalid_deposit');
  CUT = await ok('fiila_product_save', { p_key: KEY, p: { name: 'Coupe', price: 5000, duration: 30, rubric: 'Coupes' } });
  assert.equal(CUT.duration, 30); assert.equal(CUT.deposit, undefined);
  FADE = await ok('fiila_product_save', { p_key: KEY, p: { name: 'Dégradé + barbe', price: 8000, duration: 60, deposit: 2000 } });
  assert.equal(FADE.deposit, 2000);
  const again = await ok('fiila_product_save', { p_key: KEY, p: { id: FADE.id, name: 'Dégradé + barbe', price: 8000 } });
  assert.equal(again.duration, 60, 'durée gardée si absente');
});

await t('horaires : contrôlés ; jour sans horaire = fermé ; site du salon : prestations avec durée et caution', async () => {
  await ko('fiila_shop_salon', { p_key: KEY, p: { hours: { 1: ['21:00', '09:00'] } } }, 'invalid_hours');
  await ko('fiila_shop_salon', { p_key: KEY, p: { hours: { 8: ['09:00', '18:00'] } } }, 'invalid_hours');
  await ko('fiila_shop_salon', { p_key: KEY, p: { seats: 0 } }, 'invalid_seats');
  const r = await ok('fiila_shop_salon', { p_key: KEY, p: { hours: ALL, seats: 1, step: '30' } });
  assert.equal(r.salon, true); assert.equal(r.seats, 1); assert.equal(r.step, 30);
  const site = await ok('fiila_vitrine', { p_slug: SLUG });
  assert.equal(site.shop.salon, true); assert.deepEqual(site.shop.hours['1'], ['09:00', '21:00']);
  const f = site.products.find((x) => x.id === FADE.id); assert.equal(f.duration, 60); assert.equal(f.deposit, 2000);
});

await t('créneaux : au pas de 30 min, la prestation tient avant la fermeture ; jour fermé ; au-delà de 30 jours refusé', async () => {
  const sl = await ok('fiila_vitrine_slots', { p_slug: SLUG, p_product: FADE.id, p_day: D1 });
  assert.equal(sl.slots[0], '09:00'); assert.equal(sl.slots.at(-1), '20:00', 'une heure avant 21:00'); assert.equal(sl.slots.length, 23);
  const dow = (await one(`select extract(dow from $1::date)::int n`, [D2])).n;
  const h = { ...ALL }; delete h[dow];
  await ok('fiila_shop_salon', { p_key: KEY, p: { hours: h } });
  assert.equal((await ok('fiila_vitrine_slots', { p_slug: SLUG, p_product: CUT.id, p_day: D2 })).closed, true);
  await ok('fiila_shop_salon', { p_key: KEY, p: { hours: ALL } });
  await ko('fiila_vitrine_slots', { p_slug: SLUG, p_product: CUT.id, p_day: await day(40) }, 'invalid_day');
});

let T1;
await t('réservation sans caution : confirmée ; le créneau est pris (1 poste), libre de nouveau avec 2 postes', async () => {
  const b = await ok('fiila_vitrine_book', book(CUT.id, D1, '10:00'));
  assert.equal(b.status, 'confirmed'); assert.match(b.ref, /^R0001$/); T1 = b.token;
  await ko('fiila_vitrine_book', book(CUT.id, D1, '10:00', null, '77 000 00 02'), 'slot_taken');
  await ko('fiila_vitrine_book', book(FADE.id, D1, '09:30', null, '77 000 00 02'), 'slot_taken'); // 09:30–10:30 chevauche
  const sl = await ok('fiila_vitrine_slots', { p_slug: SLUG, p_product: CUT.id, p_day: D1 });
  assert.ok(!sl.slots.includes('10:00') && sl.slots.includes('10:30'));
  await ok('fiila_shop_salon', { p_key: KEY, p: { seats: 2 } });
  assert.ok((await ok('fiila_vitrine_slots', { p_slug: SLUG, p_product: CUT.id, p_day: D1 })).slots.includes('10:00'));
  await ok('fiila_shop_salon', { p_key: KEY, p: { seats: 1 } });
  await ko('fiila_vitrine_book', book(CUT.id, D1, '08:30', null, '77 000 00 02'), 'slot_taken'); // avant l'ouverture
});

let T2, B2;
await t('caution : sans numéro Wave/OM la réservation est confirmée ; avec numéro, mode exigé, en attente, numéro sur la page du rendez-vous', async () => {
  const nb = await ok('fiila_vitrine_book', book(FADE.id, D1, '14:00', null, '77 000 00 03'));
  assert.equal(nb.status, 'confirmed', 'pas de numéro : pas de caution demandée');
  await ok('fiila_shop_vitrine', { p_key: KEY, p: { policies: { pay: ['livraison', 'wave'], wave_to: '77 111 22 33' } } });
  await ko('fiila_vitrine_book', book(FADE.id, D1, '16:00', null, '77 000 00 04'), 'pay_required');
  await ko('fiila_vitrine_book', book(FADE.id, D1, '16:00', 'om', '77 000 00 04'), 'invalid_pay');
  const b = await ok('fiila_vitrine_book', book(FADE.id, D1, '16:00', 'wave', '77 000 00 04'));
  assert.equal(b.status, 'pending'); T2 = b.token;
  const pub = await ok('fiila_booking_public', { p_token: T2 });
  assert.equal(pub.booking.status, 'pending'); assert.equal(pub.booking.deposit, 2000); assert.match(pub.booking.pay_to, /77\s?111\s?22\s?33|771112233/);
  assert.ok(pub.booking.hold_until); assert.equal(pub.booking.customer_phone, undefined, 'numéro de la cliente pas sur la page publique');
  B2 = pub.booking.id;
  const site = await ok('fiila_vitrine', { p_slug: SLUG });
  assert.equal(site.shop.policies.wave_to, undefined, 'numéro jamais sur le site');
});

await t('salon : liste du jour, « Caution reçue » confirme ; actions contrôlées', async () => {
  const l = await ok('fiila_bookings', { p_key: KEY, p_from: D1, p_days: 1 });
  assert.equal(l.items.length, 3); assert.equal(l.waiting, 1);
  await ko('fiila_booking_set', { p_key: KEY, p_id: B2, p_action: 'fly' }, 'invalid_action');
  const b = await ok('fiila_booking_set', { p_key: KEY, p_id: B2, p_action: 'deposit' });
  assert.equal(b.status, 'confirmed'); assert.equal(b.deposit_paid, true);
  const pub = await ok('fiila_booking_public', { p_token: T2 });
  assert.equal(pub.booking.pay_to, undefined, 'plus de numéro une fois la caution reçue');
  const done = await ok('fiila_booking_set', { p_key: KEY, p_id: B2, p_action: 'done' });
  assert.equal(done.status, 'done');
  await ko('fiila_booking_set', { p_key: KEY, p_id: B2, p_action: 'cancel' }, 'invalid_action');
});

await t('caution non reçue à temps : le créneau se libère, rendez-vous « expiré » puis annulé par l’entretien', async () => {
  const b = await ok('fiila_vitrine_book', book(FADE.id, D1, '18:00', 'wave', '77 000 00 05'));
  await db.query(`update fiila.bookings set created_at = now() - interval '2 hours' where token = $1`, [b.token]);
  assert.equal((await ok('fiila_booking_public', { p_token: b.token })).booking.status, 'expired');
  assert.ok((await ok('fiila_vitrine_slots', { p_slug: SLUG, p_product: FADE.id, p_day: D1 })).slots.includes('18:00'));
  await db.query(`update fiila.settings set value = (now() - interval '1 hour')::text where key = 'housekeeping_at'`);
  await ok('fiila_bookings', { p_key: KEY, p_from: D1, p_days: 1 });
  const row = await one(`select status, cancel_reason from fiila.bookings where token = $1`, [b.token]);
  assert.deepEqual(row, { status: 'cancelled', cancel_reason: 'expired' });
});

await t('annulation par la cliente : possible jusqu’à 2 h avant ; trop tard ensuite', async () => {
  const c = await ok('fiila_booking_cancel', { p_token: T1 });
  assert.equal(c.booking.status, 'cancelled'); assert.equal(c.booking.cancel_reason, 'client');
  await ko('fiila_booking_cancel', { p_token: T1 }, 'not_cancellable');
  const b = await ok('fiila_vitrine_book', book(CUT.id, D1, '11:00', null, '77 000 00 06'));
  await db.query(`update fiila.bookings set start_at = now() + interval '1 hour', end_at = now() + interval '90 minutes' where token = $1`, [b.token]);
  await ko('fiila_booking_cancel', { p_token: b.token }, 'too_late');
});

await t('une même personne : 3 rendez-vous à venir au plus', async () => {
  for (const tm of ['12:00', '12:30', '13:00']) await ok('fiila_vitrine_book', book(CUT.id, D2, tm, null, '77 000 00 07'));
  await ko('fiila_vitrine_book', book(CUT.id, D2, '13:30', null, '77 000 00 07'), 'too_many');
});

await t('adresse du salon : lien d’une fiche Fii, montrée sur le site ; lien inconnu refusé', async () => {
  const pl = await one(`insert into fiila.places (kind, share_token, owner_hash, label, locality, entry_lat, entry_lng)
    values ('address', 'salonTestToken0123456', '\\x00', 'Immeuble Test', 'Point E', 14.69, -17.46) returning share_token`);
  await ko('fiila_shop_salon', { p_key: KEY, p: { place: 'https://getfii.app/#/a/inconnuInconnu01234' } }, 'place_not_found');
  const r = await ok('fiila_shop_salon', { p_key: KEY, p: { place: 'https://getfii.app/#/a/' + pl.share_token } });
  assert.equal(r.place.label, 'Immeuble Test');
  assert.equal((await ok('fiila_vitrine', { p_slug: SLUG })).shop.place.token, pl.share_token);
});

const png = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAYAAABirU3bAAAAHklEQVR4AWM8EWDznwEJMDGgASYGNMDEgAaYGNAAAMF1Al31VHyvAAAAAElFTkSuQmCC', 'base64'), Buffer.alloc(200)]).toString('base64');
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(40)]).toString('base64');
await t('réalisations : photo + vidéo MP4, copiées dans le stockage (chemin r/), gardées tant qu’elles servent', async () => {
  await ko('fiila_reel_add', { p_key: KEY, p: { video: mp4 } }, 'photo_required');
  await ko('fiila_reel_add', { p_key: KEY, p: { poster: png, video: Buffer.from('pas une video du tout').toString('base64') } }, 'invalid_video');
  const r = await ok('fiila_reel_add', { p_key: KEY, p: { poster: png, video: mp4, caption: 'Low fade' } });
  assert.equal(r.length, 1); assert.equal(r[0].video_pending, true);
  const site = await ok('fiila_vitrine', { p_slug: SLUG });
  assert.equal(site.shop.reels[0].caption, 'Low fade'); assert.equal(site.shop.reels[0].video, undefined, 'vidéo pas encore copiée');
  const pend = (await db.query(`select public.fiila_media_pending(20) j`)).rows[0].j;
  const vid = pend.find((x) => x.kind === 'reel'), pos = pend.find((x) => x.kind === 'reel_poster');
  assert.ok(vid && pos); assert.equal(vid.ctype, 'video/mp4');
  await db.query(`select public.fiila_media_done('reel', $1, $2, $3, 100)`, [vid.ref, vid.hash, `r/${vid.ref}-${vid.hash}.mp4`]);
  await db.query(`select public.fiila_media_done('reel_poster', $1, $2, $3, 100)`, [pos.ref, pos.hash, `r/${pos.ref}-${pos.hash}.png`]);
  await db.query(`insert into fiila.settings (key, value) values ('media_base', 'https://cdn.example.test/media/') on conflict (key) do update set value = excluded.value`);
  const site2 = await ok('fiila_vitrine', { p_slug: SLUG });
  assert.match(site2.shop.reels[0].video, /\/r\/.+\.mp4$/);
  assert.equal((await one(`select fiila.media_used($1) u`, [`r/${vid.ref}-${vid.hash}.mp4`])).u, true);
  await ok('fiila_reel_delete', { p_key: KEY, p_id: vid.ref });
  assert.equal((await one(`select fiila.media_used($1) u`, [`r/${vid.ref}-${vid.hash}.mp4`])).u, false);
});

await t('modèle Premium « Rituel » : réservé à Premium ; boutique ordinaire sans réservation', async () => {
  await ko('fiila_shop_vitrine', { p_key: KEY, p: { theme: 'rituel' } }, 'premium_required');
  await db.query(`update fiila.shops set plan = 'premium' where slug = $1`, [SLUG]);
  assert.equal((await ok('fiila_shop_vitrine', { p_key: KEY, p: { theme: 'rituel' } })).theme, 'rituel');
  const o = await ok('fiila_shop_save', { p_key: null, p: { name: 'Mode Test [TEST]', business_type: 'mode' } });
  const ov = await ok('fiila_shop_vitrine', { p_key: o.key, p: { public: true } });
  const P = await ok('fiila_product_save', { p_key: o.key, p: { name: 'Sac', price: 1000 } });
  assert.equal((await ok('fiila_vitrine', { p_slug: ov.slug })).shop.salon, undefined);
  await ko('fiila_vitrine_slots', { p_slug: ov.slug, p_product: P.id, p_day: D1 }, 'not_found');
});

await t('back-office : rendez-vous et réalisations du salon (équipe seulement), réglages salon_booking et book_hold', async () => {
  const sid = (await one(`select id from fiila.shops where slug = $1`, [SLUG])).id;
  await ko('fiila_bo_bookings', { p_shop: sid });
  const bo = await ok('fiila_bo_bookings', { p_shop: sid }, F);
  assert.equal(bo.salon, true); assert.ok(bo.items.length >= 5); assert.equal(bo.items[0].customer_phone, undefined);
  assert.ok(bo.counts.done >= 1);
  const st = await ok('fiila_bo_settings', {}, F);
  assert.equal(st.book_hold, 60); assert.equal(st.salon_booking, 1);
  await ok('fiila_bo_setting_set', { p_key: 'salon_booking', p_value: 0 }, F);
  assert.equal((await ok('fiila_vitrine', { p_slug: SLUG })).shop.salon, undefined);
  await ko('fiila_vitrine_book', book(CUT.id, D2, '15:00', null, '77 000 00 08'), 'not_found');
  await ok('fiila_bo_setting_set', { p_key: 'salon_booking', p_value: 1 }, F);
  const r = await ok('fiila_reel_add', { p_key: KEY, p: { poster: png, caption: 'Soin visage' } });
  const after = await ok('fiila_bo_reel_delete', { p_id: r[0].id }, F);
  assert.equal(after.reels.length, 0);
});

for (const r of results) console.log(r[0], r[1], r[2] ? '\n    ' + r[2] : '');
console.log(`\n${passed}/${results.length} tests SQL salons réussis`);
process.exit(passed === results.length ? 0 : 1);
