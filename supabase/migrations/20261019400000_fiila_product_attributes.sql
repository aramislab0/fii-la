-- Fii La : catégorie, tailles ou pointures, couleurs et stock des articles (étape 1 validée par le fondateur le 19/10/2026 05:17).
-- Prérequis des filtres de la vitrine (« ma taille », « ma pointure ») et, plus tard, de l'assistant d'achat.

alter table fiila.products
  add column category text check (category in ('mode', 'chaussures', 'beaute', 'alimentation', 'maison', 'electronique', 'accessoires', 'enfants', 'autre')),
  add column sizes text[] not null default '{}',
  add column colors text[] not null default '{}',
  add column stock integer check (stock is null or stock between 0 and 100000);

-- Liste courte de libellés propres (tailles, couleurs) : sans doublon, longueur et nombre bornés.
create or replace function fiila.tag_list(p jsonb, p_max int, p_len int) returns text[]
language plpgsql immutable set search_path = '' as $$
declare v text[] := '{}'; x text;
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) <> 'array' then perform fiila.fail('invalid_payload'); end if;
  for x in select jsonb_array_elements_text(p) loop
    x := fiila.clean(x, p_len);
    if x is not null and not x = any (v) then v := v || x; end if;
  end loop;
  if cardinality(v) > p_max then perform fiila.fail('too_many'); end if;
  return v;
end $$;

create or replace function fiila.product_json(p fiila.products, p_photo boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p.id, 'name', p.name, 'price', p.price, 'description', p.description, 'active', p.active,
    'category', p.category, 'sizes', case when cardinality(p.sizes) > 0 then to_jsonb(p.sizes) end,
    'colors', case when cardinality(p.colors) > 0 then to_jsonb(p.colors) end, 'stock', p.stock,
    'photo', case when p_photo and p.photo is not null
                  then 'data:' || p.photo_type || ';base64,' || replace(encode(p.photo, 'base64'), E'\n', '') end,
    'rating', (select round(avg(rating)::numeric, 1) from fiila.reviews r where r.product_id = p.id),
    'reviews', (select nullif(count(*), 0) from fiila.reviews r where r.product_id = p.id),
    'updated_at', p.updated_at))
$$;

create or replace function public.fiila_product_save(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops := fiila.my_shop(p_key); pr fiila.products; v_id uuid; v_name text; v_price bigint; v_ph record;
  v_cat text; v_sizes text[]; v_colors text[]; v_stock int;
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
  v_id := fiila.as_uuid(p ->> 'id');
  if v_id is not null then
    select * into pr from fiila.products where id = v_id and shop_id = s.id for update;
    if not found then perform fiila.fail('product_not_found'); end if;
    update fiila.products set name = v_name, price = v_price, description = fiila.clean(p ->> 'description', 300),
      active = coalesce((p ->> 'active')::boolean, active), updated_at = now() where id = pr.id returning * into pr;
    if p ? 'category' or p ? 'sizes' or p ? 'colors' or p ? 'stock' then
      update fiila.products set
        category = case when p ? 'category' then v_cat else category end,
        sizes = case when p ? 'sizes' then v_sizes else sizes end,
        colors = case when p ? 'colors' then v_colors else colors end,
        stock = case when p ? 'stock' then v_stock else stock end
       where id = pr.id returning * into pr;
    end if;
  else
    if (select count(*) from fiila.products where shop_id = s.id) >= 500 then perform fiila.fail('too_many'); end if;
    insert into fiila.products (shop_id, name, price, description, category, sizes, colors, stock)
    values (s.id, v_name, v_price, fiila.clean(p ->> 'description', 300), v_cat, coalesce(v_sizes, '{}'), coalesce(v_colors, '{}'), v_stock) returning * into pr;
  end if;
  if p ? 'photo' then
    if coalesce(p ->> 'photo', '') = '' then
      update fiila.products set photo = null, photo_type = null where id = pr.id;
    else
      select * into v_ph from fiila.photo_in(p ->> 'photo');
      if length(v_ph.data) > 300000 then perform fiila.fail('photo_too_large'); end if;
      update fiila.products set photo = v_ph.data, photo_type = v_ph.ctype where id = pr.id;
    end if;
  end if;
  select * into pr from fiila.products where id = pr.id;
  return fiila.product_json(pr, true);
end $$;

create or replace function public.fiila_vitrine(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops;
begin
  perform fiila.read_check();
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,40}$' then return jsonb_build_object('state', 'not_found'); end if;
  select * into s from fiila.shops where slug = p_slug;
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if not s.public then return jsonb_build_object('state', 'closed', 'shop', jsonb_build_object('name', s.name)); end if;
  return jsonb_build_object('state', 'ok',
    'shop', jsonb_strip_nulls(jsonb_build_object('name', s.name, 'about', s.about, 'phone', s.phone,
      'theme', s.theme, 'accent', s.accent, 'has_cover', case when s.cover is not null then true end,
      'rating', (select round(avg(r.rating)::numeric, 1) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id),
      'reviews', (select nullif(count(*), 0) from fiila.reviews r join fiila.products p on p.id = r.product_id where p.shop_id = s.id))),
    'products', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', pr.id, 'name', pr.name, 'price', pr.price, 'description', pr.description, 'has_photo', pr.photo is not null,
        'category', pr.category, 'sizes', case when cardinality(pr.sizes) > 0 then to_jsonb(pr.sizes) end,
        'colors', case when cardinality(pr.colors) > 0 then to_jsonb(pr.colors) end, 'stock', pr.stock,
        'rating', (select round(avg(rating)::numeric, 1) from fiila.reviews r where r.product_id = pr.id),
        'reviews', (select nullif(count(*), 0) from fiila.reviews r where r.product_id = pr.id))) order by pr.updated_at desc)
      from (select * from fiila.products where shop_id = s.id and active order by updated_at desc limit 200) pr), '[]'::jsonb));
end $$;

create or replace function public.fiila_vitrine_order(p_slug text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s fiila.shops; c fiila.customers; o fiila.orders; pr fiila.products;
  it jsonb; v_size text; v_color text; v_items jsonb := '[]'::jsonb; v_qty int; v_total bigint := 0; v_num int; v_name text; v_phone text;
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
  for it in select * from jsonb_array_elements(p -> 'items') loop
    begin v_qty := (it ->> 'qty')::int; exception when others then perform fiila.fail('invalid_qty'); end;
    if v_qty is null or v_qty < 1 or v_qty > 99 then perform fiila.fail('invalid_qty'); end if;
    select * into pr from fiila.products where id = fiila.as_uuid(it ->> 'product_id') and shop_id = s.id and active for update;
    if not found then perform fiila.fail('product_not_found'); end if;
    -- Taille et couleur : obligatoires si l'article en propose, et seulement parmi celles proposées.
    v_size := nullif(fiila.clean(it ->> 'size', 8), ''); v_color := nullif(fiila.clean(it ->> 'color', 20), '');
    if cardinality(pr.sizes) > 0 and (v_size is null or not v_size = any (pr.sizes)) then perform fiila.fail('size_required'); end if;
    if cardinality(pr.colors) > 0 and (v_color is null or not v_color = any (pr.colors)) then perform fiila.fail('color_required'); end if;
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
  insert into fiila.orders (shop_id, number, customer_id, customer_name, customer_phone, items, total, note, share_token, place_id, source)
  values (s.id, v_num, c.id, v_name, v_phone, v_items, v_total, fiila.clean(p ->> 'note', 200), fiila.token(16), null, 'vitrine')
  returning * into o;
  perform fiila.order_new_request(s, o);
  return jsonb_build_object('invoice', o.share_token, 'ref', fiila.order_ref(o.number), 'total', o.total,
    'shop', jsonb_strip_nulls(jsonb_build_object('name', s.name, 'phone', s.phone)));
end $$;

revoke all on all functions in schema fiila from public;
do $$
declare role_name text; fn text;
  fns text[] := array['public.fiila_product_save(text, jsonb)', 'public.fiila_vitrine(text)', 'public.fiila_vitrine_order(text, jsonb)'];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format('grant execute on function %s to %I', fn, role_name);
      end if;
    end loop;
  end loop;
end $$;
