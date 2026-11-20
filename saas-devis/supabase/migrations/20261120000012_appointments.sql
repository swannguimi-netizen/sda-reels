-- =====================================================================
-- 12 · Prise de rendez-vous (assistant IA + Google Agenda)
-- =====================================================================
create extension if not exists btree_gist;

alter table public.companies
  add column appointment_min_notice_hours integer not null default 4 check (appointment_min_notice_hours between 0 and 168),
  add column appointment_horizon_days integer not null default 21 check (appointment_horizon_days between 1 and 90);
grant update (appointment_min_notice_hours, appointment_horizon_days) on public.companies to authenticated;

alter table public.appointments
  add column source text not null default 'manual' check (source in ('manual', 'assistant')),
  add column google_sync_error text;

-- Jamais deux rendez-vous actifs qui se chevauchent pour une même entreprise
alter table public.appointments add constraint appointments_no_overlap
  exclude using gist (company_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status in ('pending', 'confirmed'));

-- Disponibilités : pas de plages qui se chevauchent un même jour
alter table public.availability_rules add constraint availability_no_overlap
  exclude using gist (company_id with =, weekday with =, int4range(
    (extract(epoch from start_time) / 60)::int, (extract(epoch from end_time) / 60)::int) with &&);

-- Google : métadonnées lisibles par les membres, écrites par le serveur uniquement
revoke insert, update on public.calendar_integrations from authenticated;

-- Jetons OAuth : accès serveur uniquement (Edge Functions)
create or replace function public.google_token_get(p_company_id uuid)
returns table (refresh_token text, access_token text, expires_at timestamptz)
language sql security definer set search_path = '' as $$
  select refresh_token, access_token, expires_at from private.oauth_tokens
  where company_id = p_company_id and provider = 'google';
$$;

create or replace function public.google_token_set(p_company_id uuid, p_refresh_token text, p_access_token text, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_refresh_token is null then
    -- Rafraîchissement : Google ne renvoie pas de nouveau refresh token, on garde l'existant
    update private.oauth_tokens set access_token = p_access_token, expires_at = p_expires_at
     where company_id = p_company_id and provider = 'google';
  else
    insert into private.oauth_tokens (company_id, provider, refresh_token, access_token, expires_at)
    values (p_company_id, 'google', p_refresh_token, p_access_token, p_expires_at)
    on conflict (company_id, provider) do update set
      refresh_token = excluded.refresh_token, access_token = excluded.access_token, expires_at = excluded.expires_at;
  end if;
end $$;

create or replace function public.google_token_delete(p_company_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from private.oauth_tokens where company_id = p_company_id and provider = 'google';
  delete from public.calendar_integrations where company_id = p_company_id;
$$;

revoke execute on function public.google_token_get, public.google_token_set, public.google_token_delete from anon, authenticated, public;

-- Rendez-vous de l'assistant : statut du prospect
create or replace function private.appointment_lead_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is not null and new.status in ('pending', 'confirmed') then
    update public.leads set status = 'contacted' where id = new.lead_id and status = 'new';
  end if;
  return null;
end $$;
create trigger appointments_lead_status after insert on public.appointments
  for each row execute function private.appointment_lead_status();
