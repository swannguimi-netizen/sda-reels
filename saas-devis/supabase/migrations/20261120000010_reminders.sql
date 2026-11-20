-- =====================================================================
-- 10 · Relances automatiques (devis sans réponse, factures impayées)
-- =====================================================================

alter table public.companies
  add column invoice_reminder_days integer[] not null default '{1,7,15}',
  add column timezone text not null default 'Europe/Paris',
  add column quote_reminder_template text,
  add column invoice_reminder_template text;

alter table public.quotes   add column reminders_paused boolean not null default false;
alter table public.invoices add column reminders_paused boolean not null default false;

grant update (invoice_reminder_days, timezone, quote_reminder_template, invoice_reminder_template)
  on public.companies to authenticated;
grant update (reminders_paused) on public.quotes, public.invoices to authenticated;

-- Fuseau horaire déduit du code postal (outre-mer), sauf choix explicite
create or replace function private.timezone_for_postal(p_code text)
returns text language sql immutable as $$
  select case
    when p_code like '973%' then 'America/Cayenne'
    when p_code like '971%' or p_code like '977%' or p_code like '978%' then 'America/Guadeloupe'
    when p_code like '972%' then 'America/Martinique'
    when p_code like '974%' then 'Indian/Reunion'
    when p_code like '976%' then 'Indian/Mayotte'
    when p_code like '975%' then 'America/Miquelon'
    when p_code like '988%' then 'Pacific/Noumea'
    when p_code like '987%' then 'Pacific/Tahiti'
    else 'Europe/Paris' end;
$$;

create or replace function private.companies_reminder_settings()
returns trigger language plpgsql as $$
begin
  -- Délais triés, sans doublons, bornés (1 à 90 jours)
  new.quote_reminder_days := (select coalesce(array_agg(distinct d order by d), '{}') from unnest(new.quote_reminder_days) d where d between 1 and 90);
  new.invoice_reminder_days := (select coalesce(array_agg(distinct d order by d), '{}') from unnest(new.invoice_reminder_days) d where d between 1 and 90);
  if cardinality(new.quote_reminder_days) > 3 or cardinality(new.invoice_reminder_days) > 4 then
    raise exception 'Trop de relances : 3 au plus pour les devis, 4 pour les factures.';
  end if;
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Fuseau horaire inconnu : %', new.timezone;
  end if;
  if new.postal_code is distinct from (case when tg_op = 'UPDATE' then old.postal_code end)
     and (tg_op = 'INSERT' or new.timezone = old.timezone) then
    new.timezone := private.timezone_for_postal(coalesce(new.postal_code, ''));
  end if;
  return new;
end $$;

create trigger companies_reminder_settings before insert or update on public.companies
  for each row execute function private.companies_reminder_settings();

-- Une relance de facture d'un rang donné n'est envoyée qu'une fois
create unique index email_logs_invoice_reminder_once on public.email_logs (invoice_id, kind)
  where kind like 'invoice_reminder_%';

-- ---------------------------------------------------------------------
-- Relances dues maintenant (appelée par l'Edge Function planifiée, rôle service)
-- Envoi uniquement du lundi au samedi, de 9 h à 18 h, heure locale de l'entreprise.
-- ---------------------------------------------------------------------
create or replace function public.due_reminders(p_ignore_hours boolean default false, p_limit integer default 200)
returns table (
  doc_type text, doc_id uuid, company_id uuid, rank integer, to_email text, client_name text,
  number text, total_ttc numeric, amount_due numeric, sent_at timestamptz, valid_until date, due_date date,
  public_token uuid, pdf_path text, viewed_at timestamptz
) language sql stable security definer set search_path = '' as $$
  with eligible_companies as (
    select c.* from public.companies c
    where private.plan_has_feature(c.id, 'auto_reminders')
      and (p_ignore_hours or (
        extract(isodow from now() at time zone c.timezone) < 7
        and extract(hour from now() at time zone c.timezone) between 9 and 17))
  )
  (select 'quote', q.id, q.company_id, q.reminder_count + 1,
          coalesce(q.client_snapshot ->> 'email', cl.email), coalesce(q.client_snapshot ->> 'name', cl.name),
          q.number, q.total_ttc, q.total_ttc, q.sent_at, q.valid_until, null::date, q.public_token, q.pdf_path, q.viewed_at
   from public.quotes q
   join eligible_companies c on c.id = q.company_id and c.quote_reminders_enabled
   left join public.clients cl on cl.id = q.client_id
   where q.status = 'sent' and not q.reminders_paused
     and (q.valid_until is null or q.valid_until >= current_date)
     and q.reminder_count < cardinality(c.quote_reminder_days)
     and q.sent_at + make_interval(days => c.quote_reminder_days[q.reminder_count + 1]) <= now()
     and coalesce(q.client_snapshot ->> 'email', cl.email) is not null)
  union all
  (select 'invoice', i.id, i.company_id, i.reminder_count + 1,
          coalesce(i.client_snapshot ->> 'email', cl.email), coalesce(i.client_snapshot ->> 'name', cl.name),
          i.number, i.total_ttc, i.total_ttc - i.amount_paid, i.sent_at, null::date, i.due_date, i.public_token, i.pdf_path, null::timestamptz
   from public.invoices i
   join eligible_companies c on c.id = i.company_id and c.invoice_reminders_enabled
   left join public.clients cl on cl.id = i.client_id
   where i.status = 'issued' and not i.reminders_paused and i.total_ttc > i.amount_paid
     and i.reminder_count < cardinality(c.invoice_reminder_days)
     and i.due_date + c.invoice_reminder_days[i.reminder_count + 1] <= current_date
     and coalesce(i.client_snapshot ->> 'email', cl.email) is not null)
  limit p_limit;
$$;
revoke execute on function public.due_reminders from anon, authenticated, public;

-- Enregistre l'envoi d'une relance (automatique ou manuelle)
create or replace function public.record_reminder(p_doc_type text, p_doc_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_doc_type = 'quote' then
    update public.quotes set reminder_count = reminder_count + 1, last_reminder_at = now() where id = p_doc_id;
  else
    update public.invoices set reminder_count = reminder_count + 1, last_reminder_at = now() where id = p_doc_id;
  end if;
end $$;
revoke execute on function public.record_reminder from anon, authenticated, public;
