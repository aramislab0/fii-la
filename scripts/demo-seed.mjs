// Génère scripts/demo-seed.sql : boutiques de DÉMONSTRATION (fictives), une ou deux par catégorie, avec articles, photos
// synthétiques (aplats dessinés ici), tailles, couleurs, stock et notes variées. Toutes marquées demo = true :
// jamais dans les 25 places, visibles seulement en « mode démo », effaçables par scripts/demo-clear.sql.
// Usage : node scripts/demo-seed.mjs  puis exécuter le SQL (Supabase, ou base de test).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(buf) { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// Fond en dégradé doux + une forme claire (cercle, rectangle arrondi ou losange) : lisible, sans prétendre être une vraie photo.
function png(bg, shape, W = 320, H = 320) {
  const [r, g, b] = hex(bg), rows = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 3);
    for (let x = 0; x < W; x++) {
      const t = 0.82 + 0.18 * (y / H);
      const dx = x - W / 2, dy = y - H / 2;
      const inside = shape === 0 ? Math.hypot(dx, dy) < W * 0.26
        : shape === 1 ? Math.abs(dx) < W * 0.22 && Math.abs(dy) < H * 0.3
        : Math.abs(dx) + Math.abs(dy) < W * 0.3;
      const k = inside ? 0.55 : 0;
      row[1 + 3 * x] = Math.round(r * t + (255 - r * t) * k); row[2 + 3 * x] = Math.round(g * t + (255 - g * t) * k); row[3 + 3 * x] = Math.round(b * t + (255 - b * t) * k);
    }
    rows.push(row);
  }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const S = (p) => `'${String(p).replace(/'/g, "''")}'`;
const SHOPS = [
  ['Awa Couture', 'mode', 'prune', '#5B2A86', 'Robes wax et boubous sur mesure, livrés à Dakar.', [['Robe wax évasée', 18000, 'S,M,L,XL', 'Bleu indigo,Orange', 5], ['Boubou brodé', 35000, 'M,L,XL', 'Blanc,Bleu nuit', null], ['Foulard tissé', 4000, '', 'Jaune,Vert', 12]], [5, 5, 4, 5]],
  ['Dakar Street', 'mode', 'nuit', '#1F2A37', 'Tee-shirts et casquettes imprimés à Dakar.', [['Tee-shirt « Teranga »', 7500, 'S,M,L,XL,XXL', 'Noir,Blanc', 20], ['Casquette brodée', 6000, '', 'Noir,Beige', 8], ['Sweat à capuche', 15000, 'M,L,XL', 'Gris', 0]], [4, 3, 4]],
  ['Sneakers Médina', 'chaussures', 'indigo', '#2F3E9E', 'Baskets neuves, toutes pointures.', [['Baskets blanches', 25000, '39,40,41,42,43,44,45', '', 6], ['Baskets montantes', 32000, '40,41,42,43,44', 'Noir,Rouge', 3], ['Claquettes', 5000, '38,39,40,41,42,43,44', '', null]], [5, 4, 2, 4]],
  ['Cuirs de Ngaye', 'chaussures', 'terre', '#8A4B1F', 'Babouches et sandales en cuir, faites main.', [['Babouches en cuir', 12000, '38,39,40,41,42,43', 'Marron,Jaune', 10], ['Sandales tressées', 9000, '37,38,39,40,41', 'Marron', 4], ['Mocassins', 22000, '40,41,42,43,44', 'Noir,Marron', 2]], [5, 5, 5]],
  ['Karité Fatou', 'beaute', 'foret', '#1E4A34', 'Karité pur, savons et huiles naturelles.', [['Beurre de karité 250 g', 3500, '', '', 30], ['Savon noir', 1500, '', '', null], ['Huile de baobab', 5000, '', '', 7]], [5, 4, 5, 3]],
  ['Thiouraye Ndèye', 'beaute', 'bordeaux', '#7A1F3D', 'Encens et parfums maison.', [['Thiouraye 250 g', 5000, '', '', 15], ['Gongo', 4000, '', '', null], ['Coffret parfum', 12000, '', '', 5]], [4, 5, 3]],
  ['Saveurs de Mame', 'alimentation', 'bordeaux', '#7A1F3D', 'Thiéboudienne le vendredi, yassa et mafé sur commande.', [['Thiéboudienne (2 pers.)', 6000, '', '', null], ['Yassa poulet', 3500, '', '', null], ['Bissap 1 L', 1500, '', '', 20]], [5, 4, 5, 5]],
  ['Pâtisserie Yoff', 'alimentation', 'terre', '#8A4B1F', 'Gâteaux et viennoiseries du matin.', [['Gâteau anniversaire', 15000, '', 'Chocolat,Vanille', null], ['Croissants (x6)', 3000, '', '', 10], ['Thiakry 500 g', 2000, '', '', 8]], [3, 4, 4]],
  ['Déco Sandaga', 'maison', 'nuit', '#1F2A37', 'Paniers, coussins et nattes tressées.', [['Panier tressé', 8000, '', 'Naturel,Coloré', 9], ['Coussin wax', 6000, '', 'Bleu,Orange', 12], ['Natte en plastique', 7000, '', '', null]], [4, 5]],
  ['Tech Colobane', 'electronique', 'indigo', '#2F3E9E', 'Accessoires téléphone, garantie 3 mois.', [['Écouteurs sans fil', 12000, '', 'Noir,Blanc', 14], ['Chargeur rapide', 5000, '', '', 25], ['Batterie externe', 9000, '', '', 0]], [3, 2, 4, 3]],
  ['Bijoux Soumbédioune', 'accessoires', 'terre', '#8A4B1F', 'Bijoux en argent et perles, fabriqués à Dakar.', [['Bracelet en argent', 9000, '', '', 6], ['Collier de perles', 7000, '', 'Rouge,Bleu,Vert', 10], ['Boucles d’oreilles', 5000, '', '', null]], [5, 4, 5]],
  ['Petits Boubous', 'enfants', 'prune', '#5B2A86', 'Tenues pour enfants, du baptême à la Tabaski.', [['Boubou enfant', 12000, '2 ans,4 ans,6 ans,8 ans', 'Blanc,Bleu', 6], ['Robe fillette wax', 9000, '2 ans,4 ans,6 ans', 'Rose,Jaune', 4], ['Sandales enfant', 5000, '24,26,28,30', '', null]], [5, 5, 4]],
  ['Fleurs Almadies', 'autre', 'foret', '#1E4A34', 'Bouquets livrés le jour même.', [['Bouquet de roses', 15000, '', 'Rouge,Blanc', null], ['Bouquet de saison', 10000, '', '', null], ['Composition mariage', 45000, '', '', 2]], [5, 4]],
];
const accentHex = { foret: '#1E4A34', nuit: '#1F2A37', indigo: '#2F3E9E', prune: '#5B2A86', bordeaux: '#7A1F3D', terre: '#8A4B1F' };
let sql = `-- Généré par scripts/demo-seed.mjs. Boutiques FICTIVES de démonstration (demo = true). Effacement : scripts/demo-clear.sql.
do $$
declare s uuid; p uuid; o uuid; n int;
begin
  if exists (select 1 from fiila.shops where demo) then raise exception 'Des boutiques de démonstration existent déjà : lancer scripts/demo-clear.sql d’abord.'; end if;
`;
SHOPS.forEach(([name, cat, accent, color, about, items, ratings], i) => {
  const slug = 'demo-' + name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const cover = i % 3 === 0 ? `, cover = decode(${S(png(color, 1, 640, 360))}, 'base64'), cover_type = 'image/png'` : '';
  sql += `
  insert into fiila.shops (owner_hash, name, about, slug, public, theme, accent, demo, next_number)
  values (extensions.gen_random_bytes(32), ${S(name + ' (démo)')}, ${S(about)}, ${S(slug)}, true, ${S(['galerie', 'catalogue', 'magazine'][i % 3])}, ${S(accent)}, true, 2) returning id into s;
  ${cover ? `update fiila.shops set ${cover.slice(2)} where id = s;` : ''}
  insert into fiila.orders (shop_id, number, customer_name, items, total, status, share_token, delivered_at)
  values (s, 1, 'Cliente démo', '[]'::jsonb, 0, 'delivered', encode(extensions.gen_random_bytes(16), 'hex'), now()) returning id into o;`;
  items.forEach(([pn, price, sizes, colors, stock], j) => {
    const arr = (t) => t ? `array[${t.split(',').map(S).join(',')}]::text[]` : `'{}'::text[]`;
    const tint = j === 0 ? color : accentHex[['foret', 'nuit', 'indigo', 'prune', 'bordeaux', 'terre'][(i + j) % 6]];
    sql += `
  insert into fiila.products (shop_id, name, price, category, sizes, colors, stock, photo, photo_type, updated_at)
  values (s, ${S(pn)}, ${price}, ${S(cat)}, ${arr(sizes)}, ${arr(colors)}, ${stock === null ? 'null' : stock}, decode(${S(png(tint, j % 3))}, 'base64'), 'image/png', now() - interval '${j} minutes') returning id into p;`;
    if (j === 0) ratings.forEach((r, k) => {
      sql += `
  ${k === 0 ? '' : `insert into fiila.orders (shop_id, number, customer_name, items, total, status, share_token, delivered_at) select s, coalesce(max(number), 0) + 1, 'Cliente démo', '[]'::jsonb, 0, 'delivered', encode(extensions.gen_random_bytes(16), 'hex'), now() from fiila.orders where shop_id = s returning id into o;`}
  insert into fiila.reviews (product_id, order_id, rating) values (p, o, ${r});`;
    });
  });
});
sql += `
end $$;
select count(*) as boutiques_demo from fiila.shops where demo;
`;
writeFileSync('scripts/demo-seed.sql', sql);
writeFileSync('scripts/demo-clear.sql', `-- Efface toutes les boutiques de démonstration (articles, commandes, notes, clients suivent en cascade).
delete from fiila.shops where demo;
select count(*) as boutiques_demo_restantes from fiila.shops where demo;
`);
console.log('scripts/demo-seed.sql', Math.round(sql.length / 1024), 'Ko,', SHOPS.length, 'boutiques');
