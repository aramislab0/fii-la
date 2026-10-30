-- Paiement avant la livraison (fondateur, 30/10/2026 16:15 : « ajoute le paiement avant livraison et mets-le en option pour
-- toutes les boutiques : cash on delivery, et paiement par Wave ou OM ; chaque commerçant sera libre de choisir ses
-- méthodes. Un article sans prix ne peut pas être publié »).
--   1. Conditions de la boutique : 'livraison' (à la livraison), 'wave' et 'om' (avant la livraison, sur le numéro Wave ou
--      Orange Money de la boutique, obligatoire) ; numéros jamais montrés sur le site, seulement sur la facture à payer ;
--   2. commande du site : la cliente choisit parmi les modes de la boutique (`orders.pay_mode`) ; sa facture indique le
--      montant, le mode et le numéro ; la boutique confirme la réception (paiement enregistré comme aujourd'hui) ;
--   3. un article sans prix (0) peut être enregistré masqué, jamais publié ; le site ne sert pas d'article à 0 ;
--   4. réglage `pay_before` (0 = paiement avant la livraison coupé pour toutes les boutiques).
-- Aucun prestataire de paiement n'est branché : l'argent va directement de la cliente au numéro de la boutique.
-- Fonctions réécrites en entier (garde-fou HANDOFF #78).

alter table fiila.orders add column if not exists pay_mode text check (pay_mode is null or pay_mode in ('livraison', 'wave', 'om'));
insert into fiila.settings (key, value) values ('pay_before', '1') on conflict (key) do nothing;

CREATE OR REPLACE FUNCTION fiila.policies_in(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v jsonb := '{}'::jsonb; x text; v_pay text[] := '{}'; v_to text;
begin
  if p is null or jsonb_typeof(p) = 'null' then return '{}'::jsonb; end if;
  if jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  if nullif(p ->> 'delivery', '') is not null then
    if p ->> 'delivery' not in ('jour', '24h', '48h', '5j') then perform fiila.fail('invalid_payload'); end if;
    v := v || jsonb_build_object('delivery', p ->> 'delivery');
  end if;
  -- Paiement (30/10) : 'livraison' = à la livraison (cash on delivery) ; 'wave', 'om' = avant la livraison, sur le numéro
  -- Wave ou Orange Money de la boutique (wave_to, om_to : obligatoires pour la méthode choisie).
  if p ? 'pay' and jsonb_typeof(p -> 'pay') <> 'null' then
    if jsonb_typeof(p -> 'pay') <> 'array' then perform fiila.fail('invalid_payload'); end if;
    for x in select jsonb_array_elements_text(p -> 'pay') loop
      if x not in ('livraison', 'wave', 'om') then perform fiila.fail('invalid_payload'); end if;
      if not x = any (v_pay) then v_pay := v_pay || x; end if;
    end loop;
    if cardinality(v_pay) > 0 then v := v || jsonb_build_object('pay', to_jsonb(v_pay)); end if;
  end if;
  foreach x in array array['wave', 'om'] loop
    v_to := nullif(fiila.clean_phone(p ->> (x || '_to')), '');
    if v_to is not null and length(regexp_replace(v_to, '\D', '', 'g')) < 9 then perform fiila.fail('pay_number_required'); end if;
    if x = any (v_pay) and v_to is null then perform fiila.fail('pay_number_required'); end if;
    if x = any (v_pay) then v := v || jsonb_build_object(x || '_to', v_to); end if;
  end loop;
  if nullif(p ->> 'exchange', '') is not null then
    if p ->> 'exchange' not in ('non', '3j', '7j') then perform fiila.fail('invalid_payload'); end if;
    v := v || jsonb_build_object('exchange', p ->> 'exchange');
  end if;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION fiila.order_json(o fiila.orders, p_full boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v_paid bigint := fiila.order_paid(o.id); v_out jsonb; r fiila.places; q fiila.requests;
begin
  v_out := jsonb_strip_nulls(jsonb_build_object(
    'id', o.id, 'number', o.number, 'ref', fiila.order_ref(o.number),
    'customer_id', o.customer_id, 'customer_name', o.customer_name, 'customer_phone', o.customer_phone,
    'total', o.total, 'paid', v_paid, 'pay_mode', o.pay_mode,
    'pay_state', case when v_paid >= o.total then 'paid' when v_paid > 0 then 'partial' else 'unpaid' end,
    'address_state', fiila.order_address_state(o), 'delivery_state', fiila.order_delivery_state(o),
    'status', o.status, 'created_at', o.created_at, 'delivered_at', o.delivered_at));
  if not p_full then return v_out; end if;
  if o.request_id is not null then select * into q from fiila.requests where id = o.request_id; end if;
  if o.place_id is not null then select * into r from fiila.places where id = o.place_id and status = 'active'; end if;
  return v_out || jsonb_strip_nulls(jsonb_build_object(
    'items', o.items, 'note', o.note, 'share_token', o.share_token,
    'request_token', case when q.id is not null and q.fulfilled_at is null and q.expires_at > now() then q.share_token end,
    'watch_token', case when fiila.order_delivery_state(o) in ('courier_ready', 'on_the_way', 'arrived') then o.watch_token end,
    'place', case when r.id is not null then fiila.place_json(r, false) end,
    'payments', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', pm.id, 'amount', pm.amount,
        'method', pm.method, 'source', pm.source, 'status', pm.status, 'created_at', pm.created_at)) order by pm.created_at)
        from fiila.payments pm where pm.order_id = o.id), '[]'::jsonb)));
end $function$;

CREATE OR REPLACE FUNCTION public.fiila_vitrine_order(p_slug text, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops; c fiila.customers; o fiila.orders; pr fiila.products;
  it jsonb; v_pay text; v_size text; v_color text; v_items jsonb := '[]'::jsonb; v_qty int; v_total bigint := 0; v_num int; v_name text; v_phone text;
begin
  perform fiila.rate_check('vitrine_order', 40);
  perform fiila.housekeeping();
  select * into s from fiila.shops where slug = p_slug and public for update;
  if not found then perform fiila.fail('not_found'); end if;
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  if coalesce(jsonb_typeof(p -> 'items'), '') <> 'array' or jsonb_array_length(p -> 'items') = 0 then perform fiila.fail('items_required'); end if;
  if jsonb_array_length(p -> 'items') > 20 then perform fiila.fail('too_many'); end if;
  v_name := fiila.clean(p -> 'customer' ->> 'name', 60);
  if v_name is null then perform fiila.fail('customer_name_required'); end if;
  v_phone := fiila.clean_phone(p -> 'customer' ->> 'phone');
  if nullif(fiila.phone_key(v_phone), '') is null then perform fiila.fail('phone_required'); end if;
  -- Mode de paiement (30/10) : parmi ceux de la boutique ; obligatoire dès que la boutique en a choisi. Le paiement avant
  -- la livraison peut être coupé pour toutes les boutiques (réglage pay_before = 0).
  v_pay := nullif(p ->> 'pay', '');
  if v_pay is not null and not coalesce(s.policies -> 'pay' ? v_pay, false) then perform fiila.fail('invalid_pay'); end if;
  if v_pay in ('wave', 'om') and coalesce(fiila.setting_int('pay_before'), 1) = 0 then perform fiila.fail('invalid_pay'); end if;
  if v_pay is null and jsonb_array_length(coalesce(s.policies -> 'pay', '[]'::jsonb)) > 0 then perform fiila.fail('pay_required'); end if;
  for it in select * from jsonb_array_elements(p -> 'items') loop
    begin v_qty := (it ->> 'qty')::int; exception when others then perform fiila.fail('invalid_qty'); end;
    if v_qty is null or v_qty < 1 or v_qty > 99 then perform fiila.fail('invalid_qty'); end if;
    select * into pr from fiila.products where id = fiila.as_uuid(it ->> 'product_id') and shop_id = s.id and active for update;
    if not found then perform fiila.fail('product_not_found'); end if;
    -- Taille et couleur : obligatoires si l'article en propose, et seulement parmi celles proposées.
    v_size := nullif(fiila.clean(it ->> 'size', 8), ''); v_color := nullif(fiila.clean(it ->> 'color', 20), '');
    if cardinality(pr.sizes) > 0 and (v_size is null or not v_size = any (pr.sizes)) then perform fiila.fail('size_required'); end if;
    if cardinality(pr.colors) > 0 and (v_color is null or not v_color = any (pr.colors)) then perform fiila.fail('color_required'); end if;
    if v_size is not null and v_size = any (pr.sizes_out) then perform fiila.fail('size_sold_out'); end if;
    if cardinality(pr.sizes) = 0 then v_size := null; end if;
    if cardinality(pr.colors) = 0 then v_color := null; end if;
    -- Stock suivi : jamais plus que ce qui reste ; décompté à la commande.
    if pr.stock is not null then
      if pr.stock < v_qty then perform fiila.fail('out_of_stock'); end if;
      update fiila.products set stock = stock - v_qty where id = pr.id;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('product_id', pr.id,
      'label', pr.name || coalesce(' (' || nullif(concat_ws(' · ', v_size, v_color), '') || ')', ''), 'qty', v_qty, 'price', pr.price,
      'size', v_size, 'color', v_color)));
    v_total := v_total + v_qty * pr.price;
  end loop;
  -- Client de la boutique : retrouvé par son numéro (sans changer le nom enregistré par la boutique), sinon créé.
  -- Le numéro n'est pas vérifié : l'adresse reçue pour cette commande ne sera jamais copiée sur ce client (order_sync).
  select * into c from fiila.customers where shop_id = s.id and fiila.phone_key(phone) = fiila.phone_key(v_phone) order by created_at limit 1;
  if not found then
    if (select count(*) from fiila.customers where shop_id = s.id) >= 5000 then perform fiila.fail('too_many'); end if;
    insert into fiila.customers (shop_id, name, phone) values (s.id, v_name, v_phone) returning * into c;
  end if;
  update fiila.shops set next_number = next_number + 1 where id = s.id returning next_number - 1 into v_num;
  -- Jamais d'adresse reprise automatiquement : la personne donne la sienne par le lien de la facture.
  insert into fiila.orders (shop_id, number, customer_id, customer_name, customer_phone, items, total, note, share_token, place_id, source, pay_mode)
  values (s.id, v_num, c.id, v_name, v_phone, v_items, v_total, fiila.clean(p ->> 'note', 200), fiila.token(16), null, 'vitrine', v_pay)
  returning * into o;
  perform fiila.order_new_request(s, o);
  return jsonb_build_object('invoice', o.share_token, 'ref', fiila.order_ref(o.number), 'total', o.total, 'pay_mode', o.pay_mode,
    'shop', jsonb_strip_nulls(jsonb_build_object('name', s.name, 'phone', s.phone)));
end $function$;

CREATE OR REPLACE FUNCTION public.fiila_order_public(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o fiila.orders; s fiila.shops; v_full jsonb; v_items jsonb; v_cour jsonb; v_cid uuid; v_my smallint;
begin
  perform fiila.read_check();
  if not fiila.valid_token(p_token) then return jsonb_build_object('state', 'invalid'); end if;
  select * into o from fiila.orders where share_token = p_token;
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  select * into s from fiila.shops where id = o.shop_id;
  if o.status = 'cancelled' then
    return jsonb_build_object('state', 'cancelled', 'shop', jsonb_build_object('name', s.name), 'ref', fiila.order_ref(o.number));
  end if;
  v_full := fiila.order_json(o, true);
  select coalesce(jsonb_agg(case when r.rating is not null then it || jsonb_build_object('my_rating', r.rating) else it end order by ord), '[]'::jsonb)
    into v_items
    from jsonb_array_elements(fiila.items_with_photos(o.items)) with ordinality as x(it, ord)
    left join fiila.reviews r on r.order_id = o.id and r.product_id = fiila.as_uuid(it ->> 'product_id');
  select t.courier_id into v_cid from fiila.trackers t where t.order_id = o.id and t.courier_id is not null order by t.created_at desc limit 1;
  if v_cid is not null then
    select rating into v_my from fiila.courier_reviews where order_id = o.id;
    select jsonb_strip_nulls(jsonb_build_object('name', split_part(c.name, ' ', 1), 'my_rating', v_my,
        'can_rate', exists (select 1 from fiila.trackers t2 where t2.order_id = o.id and t2.courier_id = c.id and t2.done_at is not null)))
      into v_cour from fiila.couriers c where c.id = v_cid;
  end if;
  return jsonb_build_object('state', 'ok',
    'shop', jsonb_strip_nulls(jsonb_build_object('name', s.name, 'phone', s.phone, 'ninea', s.ninea)),
    'order', jsonb_strip_nulls(jsonb_build_object(
      'ref', v_full ->> 'ref', 'customer_name', o.customer_name, 'items', v_items, 'total', o.total,
      'paid', v_full -> 'paid', 'pay_state', v_full ->> 'pay_state', 'pay_mode', o.pay_mode,
      'pay_to', case when o.pay_mode in ('wave', 'om') then s.policies ->> (o.pay_mode || '_to') end,
      'address_state', v_full ->> 'address_state', 'delivery_state', v_full ->> 'delivery_state',
      'request_token', v_full ->> 'request_token', 'watch_token', v_full ->> 'watch_token',
      'can_review', o.status = 'delivered', 'courier', v_cour,
      'note', o.note, 'created_at', o.created_at, 'delivered_at', o.delivered_at)));
end $function$;

CREATE OR REPLACE FUNCTION public.fiila_vitrine(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops;
begin
  perform fiila.read_check();
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,40}$' then return jsonb_build_object('state', 'not_found'); end if;
  select * into s from fiila.shops where slug = p_slug;
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if not s.public then return jsonb_build_object('state', 'closed', 'shop', jsonb_build_object('name', s.name)); end if;
  insert into fiila.shop_views (shop_id, day, n) values (s.id, (now() at time zone 'utc')::date, 1)
    on conflict (shop_id, day) do update set n = fiila.shop_views.n + 1;
  return jsonb_build_object('state', 'ok',
    'shop', jsonb_strip_nulls(jsonb_build_object('name', s.name, 'about', s.about, 'phone', s.phone,
      'demo', case when s.demo then true end, 'platform', case when s.platform then true end,
      'theme', fiila.shown_theme(s), 'accent', s.accent, 'style', nullif(s.style, '{}'::jsonb),
      'rail', greatest(4, least(20, coalesce(fiila.setting_int('site_rail'), 10))),
      'anim_off', case when coalesce(fiila.setting_int('site_anim'), 1) = 0 then true end, 'policies', nullif(s.policies - 'wave_to' - 'om_to', '{}'::jsonb), 'pay_before_off', case when coalesce(fiila.setting_int('pay_before'), 1) = 0 then true end,
      'look', greatest(0, least(6, coalesce(fiila.setting_int('site_look'), 3))),
      'logo', case when s.logo is not null then 'data:' || s.logo_type || ';base64,' || replace(encode(s.logo, 'base64'), E'\n', '') end, 'socials', nullif(s.socials, '{}'::jsonb), 'has_cover', case when (s.cover is not null or s.cover_path is not null) then true end,
      'rating', (select round(avg(r.rating)::numeric, 1) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id),
      'reviews', (select nullif(count(*), 0) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id))),
    'products', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', pr.id, 'name', pr.name, 'price', pr.price, 'description', pr.description, 'has_photo', (pr.photo is not null or pr.photo_path is not null), 'img', fiila.card_img(pr.id),
        'is_new', case when pr.created_at > now() - interval '14 days' then true end, 'photos', fiila.photo_count(pr.id),
        'category', pr.category, 'rubric', pr.rubric, 'added', floor(extract(epoch from pr.created_at))::bigint, 'sizes', case when cardinality(pr.sizes) > 0 then to_jsonb(pr.sizes) end,
        'colors', case when cardinality(pr.colors) > 0 then to_jsonb(pr.colors) end, 'stock', pr.stock,
        'price_was', pr.price_was, 'sizes_out', case when cardinality(pr.sizes_out) > 0 then to_jsonb(pr.sizes_out) end,
        'gender', pr.gender, 'age_band', pr.age_band, 'condition', pr.condition,
        'rating', (select round(avg(rating)::numeric, 1) from fiila.reviews r where r.product_id = pr.id),
        'reviews', (select nullif(count(*), 0) from fiila.reviews r where r.product_id = pr.id))) order by pr.updated_at desc)
      from (select * from fiila.products where shop_id = s.id and active and price > 0 order by updated_at desc limit 500) pr), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.fiila_product_save(p_key text, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s fiila.shops := fiila.my_shop(p_key); pr fiila.products; v_id uuid; v_name text; v_price bigint; v_ph record;
  v_cat text; v_sizes text[]; v_colors text[]; v_stock int; v_was bigint; v_out text[];
begin
  perform fiila.rate_check('product_save', 600);
  if p is null or jsonb_typeof(p) <> 'object' then perform fiila.fail('invalid_payload'); end if;
  v_name := fiila.clean(p ->> 'name', 80);
  if v_name is null then perform fiila.fail('item_label_required'); end if;
  begin v_price := (p ->> 'price')::bigint; exception when others then perform fiila.fail('invalid_price'); end;
  if v_price is null or v_price < 0 or v_price > 100000000 then perform fiila.fail('invalid_price'); end if;
  v_cat := nullif(p ->> 'category', '');
  if v_cat is not null and v_cat not in ('mode', 'chaussures', 'beaute', 'alimentation', 'maison', 'electronique', 'accessoires', 'enfants', 'autre') then
    perform fiila.fail('invalid_category'); end if;
  v_sizes := fiila.tag_list(p -> 'sizes', 20, 8);
  v_colors := fiila.tag_list(p -> 'colors', 12, 20);
  if p ? 'stock' and jsonb_typeof(p -> 'stock') <> 'null' then
    begin v_stock := (p ->> 'stock')::int; exception when others then perform fiila.fail('invalid_stock'); end;
    if v_stock < 0 or v_stock > 100000 then perform fiila.fail('invalid_stock'); end if;
  end if;
  if p ? 'price_was' and jsonb_typeof(p -> 'price_was') <> 'null' then
    begin v_was := (p ->> 'price_was')::bigint; exception when others then perform fiila.fail('invalid_price_was'); end;
    if v_was = 0 then v_was := null;
    elsif v_was is null or v_was <= v_price or v_was > 100000000 then perform fiila.fail('invalid_price_was'); end if;
  end if;
  v_out := fiila.tag_list(p -> 'sizes_out', 20, 8);
  v_id := fiila.as_uuid(p ->> 'id');
  if v_id is not null then
    select * into pr from fiila.products where id = v_id and shop_id = s.id for update;
    if not found then perform fiila.fail('product_not_found'); end if;
    update fiila.products set name = v_name, price = v_price,
      description = case when p ? 'description' then fiila.clean(p ->> 'description', 300) else description end,
      price_was = case when p ? 'price_was' then v_was when price_was > v_price then price_was end,
      active = coalesce((p ->> 'active')::boolean, active), updated_at = now() where id = pr.id returning * into pr;
    if p ? 'category' or p ? 'sizes' or p ? 'colors' or p ? 'stock' or p ? 'rubric' then
      update fiila.products set
        category = case when p ? 'category' then v_cat else category end,
        rubric = case when p ? 'rubric' then fiila.clean(p ->> 'rubric', 30) else rubric end,
        sizes = case when p ? 'sizes' then v_sizes else sizes end,
        colors = case when p ? 'colors' then v_colors else colors end,
        stock = case when p ? 'stock' then v_stock else stock end
       where id = pr.id returning * into pr;
    end if;
  else
    if (select count(*) from fiila.products where shop_id = s.id) >= 500 then perform fiila.fail('too_many'); end if;
    insert into fiila.products (shop_id, name, price, description, category, rubric, sizes, colors, stock, active)
    values (s.id, v_name, v_price, fiila.clean(p ->> 'description', 300), v_cat, fiila.clean(p ->> 'rubric', 30), coalesce(v_sizes, '{}'), coalesce(v_colors, '{}'), v_stock,
      coalesce((p ->> 'active')::boolean, true)) returning * into pr;
  end if;
  if v_id is null and v_was is not null then update fiila.products set price_was = v_was where id = pr.id returning * into pr; end if;
  -- Tailles épuisées : seulement parmi les tailles de l'article (une taille retirée cesse d'être épuisée).
  if p ? 'sizes_out' or p ? 'sizes' then
    update fiila.products set sizes_out = coalesce(array(select x from unnest(case when p ? 'sizes_out' then coalesce(v_out, '{}') else sizes_out end) x
      where x = any (sizes)), '{}') where id = pr.id returning * into pr;
  end if;
  if p ? 'photo' then
    if coalesce(p ->> 'photo', '') = '' then
      update fiila.products set photo = null, photo_type = null, photo_path = null, thumb_path = null where id = pr.id;
    else
      select * into v_ph from fiila.photo_in(p ->> 'photo'); perform fiila.need_ratio(v_ph.data);
      if length(v_ph.data) > 300000 then perform fiila.fail('photo_too_large'); end if;
      update fiila.products set photo = v_ph.data, photo_type = v_ph.ctype where id = pr.id;
    end if;
  end if;
  if p ? 'photos' then
    perform fiila.product_photos_set(pr.id, p -> 'photos');
  end if;
  perform fiila.product_photos_promote(pr.id);
  select * into pr from fiila.products where id = pr.id;
  -- Un article sans prix ne peut pas être publié (30/10) : il peut être enregistré, masqué.
  if pr.active and pr.price <= 0 then perform fiila.fail('price_required'); end if;
  return fiila.product_json(pr, true);
end $function$;

CREATE OR REPLACE FUNCTION fiila.bo_setting_bounds(p_key text)
 RETURNS integer[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_key
    when 'vd_commission' then array[0, 50]
    when 'amb_reward_1' then array[0, 100000] when 'amb_reward_2' then array[0, 100000] when 'amb_reward_3' then array[0, 100000]
    when 'amb_monthly_cap' then array[1, 500]
    when 'sms_verify' then array[0, 1]
    when 'amb_manager_llm' then array[0, 1]
    when 'nudges' then array[0, 1]
    when 'amb_whatsapp' then array[0, 1]
    when 'onboarding_v2' then array[0, 1]
    when 'discover_after' then array[0, 1]
    when 'wa_card_media' then array[0, 1]
    when 'media_cdn' then array[0, 1]
    when 'sugg_home_shop' then array[0, 1] when 'sugg_shop_more_products' then array[0, 1] when 'sugg_shop_share_vitrine' then array[0, 1]
    when 'sugg_shop_courier' then array[0, 1] when 'sugg_shop_photos' then array[0, 1] when 'sugg_shop_team' then array[0, 1]
    when 'adaptive_home' then array[0, 1]
    when 'sugg_addr_photo' then array[0, 1] when 'sugg_addr_mark' then array[0, 1]
    when 'custom_domains' then array[0, 1] when 'shop_subdomains' then array[0, 1]
    when 'studio_ready' then array[0, 1] when 'studio_budget_usd' then array[0, 2000] when 'studio_daily' then array[1, 100]
    when 'studio_premium' then array[0, 1] when 'kyc_required' then array[0, 1] when 'site_look' then array[0, 6] when 'site_rail' then array[4, 20] when 'site_anim' then array[0, 1] when 'pay_before' then array[0, 1] when 'studio_premium_credits' then array[1, 10] when 'studio_fibo' then array[0, 1]
    when 'studio_welcome' then array[0, 1] when 'studio_welcome_credits' then array[1, 50] when 'studio_welcome_days' then array[7, 90] end
$function$;

CREATE OR REPLACE FUNCTION public.fiila_bo_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := fiila.need_staff('settings');
begin
  return coalesce((select jsonb_object_agg(k, fiila.setting_int(k))
    from unnest(array['vd_commission', 'amb_reward_1', 'amb_reward_2', 'amb_reward_3', 'amb_monthly_cap', 'sms_verify', 'amb_manager_llm', 'nudges', 'amb_whatsapp', 'onboarding_v2', 'discover_after', 'wa_card_media', 'media_cdn', 'sugg_home_shop', 'sugg_shop_more_products', 'sugg_shop_share_vitrine', 'sugg_shop_courier', 'sugg_shop_photos', 'sugg_shop_team', 'adaptive_home', 'sugg_addr_photo', 'sugg_addr_mark', 'custom_domains', 'shop_subdomains', 'studio_ready', 'studio_budget_usd', 'studio_daily', 'studio_premium', 'studio_premium_credits', 'studio_fibo', 'studio_welcome', 'studio_welcome_credits', 'studio_welcome_days', 'kyc_required', 'site_look', 'site_rail', 'site_anim', 'pay_before']) k), '{}'::jsonb);
end $function$;

-- Back-office : mode de paiement choisi par la cliente sur la fiche d'une commande.
CREATE OR REPLACE FUNCTION public.fiila_bo_order(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := fiila.need_staff('orders'); o fiila.orders; s fiila.shops;
begin
  select * into o from fiila.orders where id = p_id;
  if not found then perform fiila.fail('not_found'); end if;
  select * into s from fiila.shops where id = o.shop_id;
  -- Jamais le lien de la facture (il permettrait d'agir au nom du client) ; la consultation est journalisée.
  perform fiila.bo_log('view_order', 'order', o.id::text, jsonb_build_object('shop', s.name, 'number', o.number));
  return jsonb_strip_nulls(jsonb_build_object(
    'id', o.id, 'number', o.number, 'shop', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug),
    'customer', o.customer_name, 'phone', o.customer_phone, 'items', o.items, 'total', o.total, 'note', o.note,
    'status', o.status, 'created_at', o.created_at, 'delivered_at', o.delivered_at, 'cancelled_at', o.cancelled_at,
    'address', case when o.place_id is not null then 'received' when o.request_id is not null then 'pending' else 'none' end,
    'pay_mode', o.pay_mode,
    'paid', (select coalesce(sum(amount), 0) from fiila.payments where order_id = o.id and status = 'confirmed'),
    'payments', (select jsonb_agg(jsonb_build_object('amount', amount, 'method', method, 'at', created_at) order by created_at)
      from fiila.payments where order_id = o.id and status = 'confirmed')));
end $function$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  pub text[] := array['public.fiila_vitrine_order(text, jsonb)', 'public.fiila_order_public(text)', 'public.fiila_vitrine(text)', 'public.fiila_product_save(text, jsonb)'];
begin
  foreach fn in array pub || array['public.fiila_bo_settings()', 'public.fiila_bo_order(uuid)'] loop execute format('revoke execute on function %s from public', fn); end loop;
  foreach fn in array pub loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then execute format('grant execute on function %s to %I', fn, role_name); end if;
    end loop;
  end loop;
  foreach fn in array array['public.fiila_bo_settings()', 'public.fiila_bo_order(uuid)'] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', fn); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', fn); end if;
  end loop;
end $$;
