-- Domaine de Fii : getfii.app (acheté par le fondateur le 26/10/2026 chez Porkbun), pour l'application ET les sites des
-- boutiques (<lien>.getfii.app). Remplace fii.app / fii.shop (domaines premium, non achetés). Voir docs/PLAN-DOMAINES-FII.md v3.
-- Change : (1) getfii.app refusé comme domaine propre de boutique ; (2) résolution <lien>.getfii.app, avec les sous-domaines
-- réservés à Fii (www, sites, api, …) jamais servis comme boutique. fii.shop n'est plus résolu (non détenu).

create or replace function fiila.domain_norm(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare h text := lower(trim(coalesce(p, '')));
begin
  h := regexp_replace(h, '^[a-z]+://', '');
  h := split_part(split_part(split_part(h, '/', 1), '?', 1), '#', 1);
  h := regexp_replace(h, ':[0-9]+$', '');
  h := regexp_replace(h, '\.$', '');
  if h = '' or char_length(h) > 253 or h !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' then return null; end if;
  if h ~ '^[0-9.]+$' then return null; end if;                                         -- adresse IP
  if h ~ '(^|\.)(getfii\.app|fii\.app|fii\.com|fii\.shop|fiila\.app|fii-la\.com|github\.io|supabase\.co|workers\.dev|localhost|local|test|example|invalid)$' then return null; end if;
  if h !~ '\.[a-z]{2,63}$' then return null; end if;                                    -- extension alphabétique
  return h;
end $$;

create or replace function public.fiila_domain_resolve(p_host text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare h text := fiila.domain_norm(p_host); r record; v_sub text;
begin
  -- <lien>.getfii.app : toute boutique en ligne et non suspendue (le lien de la boutique, en minuscules).
  v_sub := substring(lower(trim(coalesce(p_host, ''))) from '^([a-z0-9]([a-z0-9-]{1,38}[a-z0-9]))\.getfii\.app\.?$');
  if v_sub is not null then
    if v_sub in ('www', 'sites', 'site', 'app', 'api', 'admin', 'bo', 'mail', 'email', 'smtp', 'mx', 'cdn', 'static', 'assets', 'img',
                 'aide', 'help', 'support', 'docs', 'blog', 'status', 'staging', 'preview', 'dev', 'test', 'demo', 'pay', 'paiement')
      or coalesce(fiila.setting_int('shop_subdomains'), 1) <> 1 then
      return jsonb_build_object('state', 'unknown');
    end if;
    select s.slug, s.name into r from fiila.shops s where s.slug = v_sub and s.public and s.suspended_at is null;
    if not found then return jsonb_build_object('state', 'unknown'); end if;
    return jsonb_build_object('state', 'ok', 'slug', r.slug, 'name', r.name, 'host', v_sub || '.getfii.app');
  end if;
  if h is null or coalesce(fiila.setting_int('custom_domains'), 1) <> 1 then return jsonb_build_object('state', 'unknown'); end if;
  select s.slug, s.name into r from fiila.shop_domains d join fiila.shops s on s.id = d.shop_id
   where d.hostname = h and d.status = 'active' and s.plan = 'premium' and s.public and s.suspended_at is null and s.slug is not null;
  if not found then return jsonb_build_object('state', 'unknown'); end if;
  return jsonb_build_object('state', 'ok', 'slug', r.slug, 'name', r.name, 'host', h);
end $$;
