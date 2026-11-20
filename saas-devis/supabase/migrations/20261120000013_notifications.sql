-- =====================================================================
-- 13 · Notifications (application mobile) : boîte d'envoi alimentée par
-- des triggers, distribuée par l'Edge Function push-dispatch (Expo Push).
-- =====================================================================

create table public.notification_events (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  kind          text not null,       -- quote_accepted, quote_refused, deposit_paid, quote_request, human_needed, visitor_message, appointment_booked
  title         text not null,
  body          text not null,
  url           text,                -- écran à ouvrir dans l'application (ex. /devis/<id>)
  dedupe_key    text,                -- évite les doublons (ex. un seul « à traiter » par conversation et par heure)
  created_at    timestamptz not null default now(),
  dispatched_at timestamptz,
  unique (company_id, dedupe_key)
);
create index notification_events_pending on public.notification_events (created_at) where dispatched_at is null;
create index notification_events_company on public.notification_events (company_id, created_at desc);

alter table public.notification_events enable row level security;
create policy notification_events_select on public.notification_events for select to authenticated
  using (private.is_member(company_id));
revoke insert, update, delete, truncate on public.notification_events from authenticated;
revoke all on public.notification_events from anon;

create or replace function private.notify(p_company uuid, p_kind text, p_title text, p_body text, p_url text, p_dedupe text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.notification_events (company_id, kind, title, body, url, dedupe_key)
  values (p_company, p_kind, left(p_title, 120), left(p_body, 240), p_url, p_dedupe)
  on conflict (company_id, dedupe_key) do nothing;
$$;

-- Devis signé / refusé, acompte payé
create or replace function private.notify_quote()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_client text := coalesce(new.signed_by_name, new.client_snapshot ->> 'name', 'Votre client');
  v_amount text := replace(to_char(new.total_ttc, 'FM999G999G990D00'), ',', ' ') || ' €';
begin
  if new.status = 'accepted' and old.status <> 'accepted' then
    perform private.notify(new.company_id, 'quote_accepted', 'Devis signé ✍️', v_client || ' a accepté le devis ' || new.number || ' (' || v_amount || ').',
      '/devis/' || new.id, 'quote_accepted:' || new.id);
  elsif new.status = 'refused' and old.status <> 'refused' then
    perform private.notify(new.company_id, 'quote_refused', 'Devis refusé', v_client || ' a décliné le devis ' || new.number
      || coalesce(' : « ' || left(new.refusal_reason, 80) || ' »', '.'), '/devis/' || new.id, 'quote_refused:' || new.id);
  end if;
  if new.deposit_paid_at is not null and old.deposit_paid_at is null then
    perform private.notify(new.company_id, 'deposit_paid', 'Acompte reçu 💶',
      'Acompte de ' || replace(to_char(new.deposit_amount, 'FM999G999G990D00'), ',', ' ') || ' € réglé sur le devis ' || new.number || '.',
      '/devis/' || new.id, 'deposit_paid:' || new.id);
  end if;
  return null;
end $$;
create trigger quotes_notify after update of status, deposit_paid_at on public.quotes
  for each row execute function private.notify_quote();

-- Demande de devis reçue par l'assistant
create or replace function private.notify_lead()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_quote_request and (tg_op = 'INSERT' or not old.is_quote_request) then
    perform private.notify(new.company_id, 'quote_request', 'Nouvelle demande de devis',
      coalesce(new.name, 'Un visiteur') || ' : ' || coalesce(new.need, 'voir la conversation'),
      case when new.conversation_id is not null then '/messages/' || new.conversation_id end, 'quote_request:' || new.id);
  end if;
  return null;
end $$;
create trigger leads_notify after insert or update of is_quote_request on public.leads
  for each row execute function private.notify_lead();

-- Conversation qui attend un humain, message du visiteur pendant la reprise en main
create or replace function private.notify_conversation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Passage en mode humain demandé par l'assistant (pas par une réponse de l'équipe)
  if new.mode = 'human' and old.mode = 'ai' and auth.uid() is null then
    perform private.notify(new.company_id, 'human_needed', 'Un visiteur vous attend',
      coalesce(new.contact_name, 'Un visiteur') || ' souhaite échanger avec vous.', '/messages/' || new.id,
      'human_needed:' || new.id || ':' || to_char(now(), 'YYYYMMDDHH24'));
  end if;
  return null;
end $$;
create trigger conversations_notify after update of mode on public.conversations
  for each row execute function private.notify_conversation();

create or replace function private.notify_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.conversations;
begin
  if new.role <> 'visitor' then return null; end if;
  select * into c from public.conversations where id = new.conversation_id;
  if c.mode = 'human' then
    -- Au plus une notification par conversation toutes les 10 minutes
    perform private.notify(new.company_id, 'visitor_message', coalesce(c.contact_name, 'Visiteur'), left(new.content, 200),
      '/messages/' || c.id, 'visitor_message:' || c.id || ':' || (extract(epoch from now())::bigint / 600));
  end if;
  return null;
end $$;
create trigger messages_notify after insert on public.messages
  for each row execute function private.notify_message();

-- Rendez-vous pris par l'assistant
create or replace function private.notify_appointment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_tz text;
begin
  if new.source = 'assistant' then
    select timezone into v_tz from public.companies where id = new.company_id;
    perform private.notify(new.company_id, 'appointment_booked', 'Nouveau rendez-vous 📅',
      coalesce(new.contact_name, 'Un visiteur') || ' – ' || new.title || ', le '
        || to_char(new.starts_at at time zone v_tz, 'DD/MM à HH24:MI') || '.',
      '/rendez-vous', 'appointment:' || new.id);
  end if;
  return null;
end $$;
create trigger appointments_notify after insert on public.appointments
  for each row execute function private.notify_appointment();

-- Distribution (Edge Function, rôle service) : événements en attente + jetons des membres
create or replace function public.pending_notifications(p_limit integer default 100)
returns table (id uuid, company_id uuid, title text, body text, url text, tokens text[])
language sql stable security definer set search_path = '' as $$
  select e.id, e.company_id, e.title, e.body, e.url,
         coalesce((select array_agg(t.token) from public.push_tokens t
                   join public.company_members m on m.user_id = t.user_id and m.company_id = e.company_id), '{}')
  from public.notification_events e
  where e.dispatched_at is null and e.created_at > now() - interval '1 day'
  order by e.created_at
  limit p_limit;
$$;
revoke execute on function public.pending_notifications from anon, authenticated, public;
