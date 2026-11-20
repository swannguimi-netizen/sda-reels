-- =====================================================================
-- 14 · Demandes d'avis Google après prestation (offre Premium)
-- Conforme aux règles Google : AUCUN filtrage des avis — tous les clients
-- reçoivent le même lien Google ; une remarque privée reste possible en plus.
-- =====================================================================

alter table public.companies
  add column review_delay_days integer not null default 1 check (review_delay_days between 0 and 30),
  add column review_message text,
  add column review_followup_enabled boolean not null default true;
grant update (review_delay_days, review_message, review_followup_enabled) on public.companies to authenticated;

alter table public.review_requests
  add column first_name text,
  add column followup_sent_at timestamptz,
  add column private_feedback text,
  add column feedback_at timestamptz,
  add column source text not null default 'auto' check (source in ('auto', 'manual'));

-- Programme une demande (au plus une par client tous les 6 mois)
create or replace function private.schedule_review(p_company uuid, p_client uuid, p_quote uuid, p_invoice uuid, p_email text, p_name text, p_source text default 'auto')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.companies;
  v_id uuid;
begin
  select * into c from public.companies where id = p_company;
  if p_email is null or c.google_review_url is null then return null; end if;
  if p_source = 'auto' and not c.review_requests_enabled then return null; end if;
  if exists (select 1 from public.review_requests r
             where r.company_id = p_company and r.status <> 'cancelled'
               and (lower(r.email) = lower(p_email) or (p_client is not null and r.client_id = p_client))
               and r.created_at > now() - interval '6 months') then
    return null;
  end if;
  insert into public.review_requests (company_id, client_id, quote_id, invoice_id, email, first_name, source, scheduled_at)
  values (p_company, p_client, p_quote, p_invoice, lower(p_email), split_part(trim(coalesce(p_name, '')), ' ', 1), p_source,
          case when p_source = 'manual' then now() else now() + make_interval(days => c.review_delay_days) end)
  returning id into v_id;
  return v_id;
end $$;

-- Déclencheurs : prestation terminée (devis) ou facture payée
create or replace function private.schedule_review_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.work_completed_at is not null and old.work_completed_at is null then
    perform private.schedule_review(new.company_id, new.client_id, new.id, null,
      coalesce(new.client_snapshot ->> 'email', (select email from public.clients where id = new.client_id)),
      coalesce(new.client_snapshot ->> 'name', (select name from public.clients where id = new.client_id)));
  end if;
  return null;
end $$;

create or replace function private.schedule_review_on_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'paid' and old.status <> 'paid' and new.kind <> 'deposit' then
    perform private.schedule_review(new.company_id, new.client_id, new.quote_id, new.id,
      coalesce(new.client_snapshot ->> 'email', (select email from public.clients where id = new.client_id)),
      coalesce(new.client_snapshot ->> 'name', (select name from public.clients where id = new.client_id)));
  end if;
  return null;
end $$;
-- Pas de « update of status » : le passage à « payée » est fait par le trigger BEFORE quand
-- amount_paid atteint le total, sans que la requête ne modifie status elle-même.
create trigger invoices_review_request after update on public.invoices
  for each row when (new.status = 'paid' and old.status is distinct from 'paid')
  execute function private.schedule_review_on_payment();

-- Demande manuelle depuis l'application (bouton « Demander un avis »)
create or replace function public.request_review(p_client_id uuid, p_quote_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  cl public.clients;
  v_id uuid;
begin
  select * into cl from public.clients where id = p_client_id;
  if not found or not private.is_member(cl.company_id) then raise exception 'Client introuvable.'; end if;
  if not private.plan_has_feature(cl.company_id, 'review_requests') then
    raise exception 'Les demandes d''avis sont incluses dans l''offre Premium.';
  end if;
  if cl.email is null then raise exception 'Ce client n''a pas d''adresse email.'; end if;
  if (select google_review_url from public.companies where id = cl.company_id) is null then
    raise exception 'Renseignez d''abord le lien de votre fiche Google.';
  end if;
  v_id := private.schedule_review(cl.company_id, cl.id, p_quote_id, null, cl.email, cl.name, 'manual');
  if v_id is null then raise exception 'Une demande d''avis a déjà été adressée à ce client ces 6 derniers mois.'; end if;
  return v_id;
end $$;
revoke execute on function public.request_review from anon, public;
grant execute on function public.request_review to authenticated;

-- ---------------------------------------------------------------------
-- Envois dus (Edge Function planifiée, rôle service) : 1re demande et relance J+5
-- ---------------------------------------------------------------------
create or replace function public.due_review_requests(p_ignore_hours boolean default false)
returns table (id uuid, company_id uuid, email text, first_name text, token uuid, is_followup boolean)
language sql stable security definer set search_path = '' as $$
  select r.id, r.company_id, r.email, nullif(r.first_name, ''), r.token, r.status = 'sent'
  from public.review_requests r
  join public.companies c on c.id = r.company_id
  where c.google_review_url is not null
    and private.plan_has_feature(c.id, 'review_requests')
    and (p_ignore_hours or (extract(isodow from now() at time zone c.timezone) < 7
                            and extract(hour from now() at time zone c.timezone) between 9 and 17))
    and (
      (r.status = 'scheduled' and r.scheduled_at <= now())
      or (r.status = 'sent' and c.review_followup_enabled and r.followup_sent_at is null
          and r.clicked_at is null and r.feedback_at is null and r.sent_at < now() - interval '5 days')
    )
  limit 200;
$$;
revoke execute on function public.due_review_requests from anon, authenticated, public;

create or replace function public.mark_review_sent(p_id uuid, p_followup boolean)
returns void language sql security definer set search_path = '' as $$
  update public.review_requests set
    status = case when status = 'scheduled' then 'sent' else status end,
    sent_at = case when p_followup then sent_at else now() end,
    followup_sent_at = case when p_followup then now() else followup_sent_at end
  where id = p_id;
$$;
revoke execute on function public.mark_review_sent from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- Page publique /avis/<jeton>
-- ---------------------------------------------------------------------
create or replace function public.get_review_page(p_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'first_name', nullif(r.first_name, ''), 'company_name', c.name, 'logo_path', c.logo_path, 'brand_color', c.brand_color,
    'google_review_url', c.google_review_url, 'feedback_sent', r.feedback_at is not null)
  from public.review_requests r join public.companies c on c.id = r.company_id
  where r.token = p_token and r.status <> 'cancelled';
$$;

create or replace function public.record_review_click(p_token uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_url text;
begin
  update public.review_requests r set status = 'clicked', clicked_at = coalesce(r.clicked_at, now())
   where r.token = p_token and r.status <> 'cancelled'
  returning (select google_review_url from public.companies where id = r.company_id) into v_url;
  return v_url;
end $$;

create or replace function public.submit_review_feedback(p_token uuid, p_feedback text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.review_requests;
begin
  if length(trim(coalesce(p_feedback, ''))) < 3 then raise exception 'Message trop court.'; end if;
  update public.review_requests set private_feedback = left(trim(p_feedback), 2000), feedback_at = now()
   where token = p_token and status <> 'cancelled' and feedback_at is null
  returning * into r;
  if r.id is null then raise exception 'Merci, votre message a déjà été transmis.'; end if;
  perform private.notify(r.company_id, 'review_feedback', 'Remarque d''un client',
    coalesce(nullif(r.first_name, ''), 'Un client') || ' : « ' || left(r.private_feedback, 160) || ' »', null, 'feedback:' || r.id);
end $$;

grant execute on function public.get_review_page, public.record_review_click, public.submit_review_feedback to anon, authenticated;

-- Statistiques de la page « Avis Google »
create or replace function public.review_stats(p_company_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'sent', count(*) filter (where status in ('sent', 'clicked')),
    'clicked', count(*) filter (where status = 'clicked'),
    'scheduled', count(*) filter (where status = 'scheduled'),
    'feedback', count(*) filter (where feedback_at is not null))
  from public.review_requests where company_id = p_company_id;
$$;
grant execute on function public.review_stats to authenticated;
