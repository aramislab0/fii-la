-- Fii La — mesure agrégée du parcours de découverte.
-- Un compteur par jour, par événement et par variante. Aucune autre donnée :
-- pas d'identifiant, pas de jeton, pas d'adresse, pas de coordonnées, pas d'adresse IP.
-- (La limite d'abus réutilise fiila.rate_check : empreinte salée de l'IP, effacée après 24 h.)

create table fiila.metrics (
  day     date   not null,
  event   text   not null,
  variant text   not null,
  n       bigint not null default 0,
  primary key (day, event, variant)
);
revoke all on fiila.metrics from public;

create or replace function public.fiila_track(p_event text, p_variant text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (
       (p_event = 'discovery_shown' and p_variant in ('address', 'meeting'))
    or (p_event = 'discovery_cta'   and p_variant in ('address', 'meeting'))
    or (p_event = 'fiche_created'   and p_variant in ('address_direct', 'address_discovery', 'address_request', 'meeting_direct', 'meeting_discovery'))
    or (p_event = 'share_initiated' and p_variant in ('native', 'whatsapp'))
    or (p_event = 'link_copied'     and p_variant in ('address', 'meeting'))
  ) then
    perform fiila.fail('invalid_event');
  end if;
  perform fiila.rate_check('track', 300);
  insert into fiila.metrics (day, event, variant, n)
  values ((now() at time zone 'utc')::date, p_event, p_variant, 1)
  on conflict (day, event, variant) do update set n = fiila.metrics.n + 1;
end $$;

revoke execute on function public.fiila_track(text, text) from public;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant execute on function public.fiila_track(text, text) to %I', role_name);
    end if;
  end loop;
end $$;

-- Lecture réservée à l'administrateur (éditeur SQL Supabase), jamais exposée par l'API :
--   select day, event, variant, n from fiila.metrics order by day desc, event, variant;
