-- Fii La — mesure : distinguer création, partage et réutilisation.
-- Toujours des compteurs agrégés par jour (jour, événement, variante, nombre), sans identifiant.
-- Ajouts : rendez-vous similaire, création de demande, type de fiche partagée, réouverture d'une fiche possédée.
-- Les anciennes variantes de partage (« native », « whatsapp ») restent acceptées pour les clients déjà chargés.

create or replace function public.fiila_track(p_event text, p_variant text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (
       (p_event = 'discovery_shown' and p_variant in ('address', 'meeting'))
    or (p_event = 'discovery_cta'   and p_variant in ('address', 'meeting'))
    or (p_event = 'fiche_created'   and p_variant in ('address_direct', 'address_discovery', 'address_request',
                                                      'meeting_direct', 'meeting_discovery', 'meeting_similar'))
    or (p_event = 'request_created' and p_variant = 'request')
    or (p_event = 'share_initiated' and p_variant in ('native', 'whatsapp',
                                                      'native_address', 'native_meeting', 'native_request',
                                                      'whatsapp_address', 'whatsapp_meeting', 'whatsapp_request'))
    or (p_event = 'link_copied'     and p_variant in ('address', 'meeting', 'request'))
    or (p_event = 'owned_reopened'  and p_variant in ('address', 'meeting', 'request'))
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
