-- =====================================================================
-- 03 · Assistant IA, prospects, rendez-vous, avis, relances, mobile
-- Le widget public n'accède jamais directement aux tables : il passe par
-- une Edge Function (rôle service) qui valide la clé publique du widget.
-- =====================================================================

create type public.conversation_channel as enum ('widget', 'whatsapp', 'instagram', 'email');
create type public.conversation_mode    as enum ('ai', 'human');
create type public.message_role         as enum ('visitor', 'assistant', 'agent', 'system');
create type public.lead_status          as enum ('new', 'contacted', 'quoted', 'won', 'lost');
create type public.appointment_status   as enum ('pending', 'confirmed', 'cancelled', 'done');
create type public.knowledge_category   as enum ('horaires', 'services', 'tarifs', 'faq', 'zone', 'autre');

-- ---------------------------------------------------------------------
-- Base de connaissances et réglages de l'assistant
-- ---------------------------------------------------------------------
create table public.knowledge_entries (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  category    public.knowledge_category not null default 'faq',
  title       text not null,
  content     text not null,
  position    integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index knowledge_company_idx on public.knowledge_entries (company_id, category, position);
create trigger knowledge_updated_at before update on public.knowledge_entries
  for each row execute function private.set_updated_at();

create table public.assistant_settings (
  company_id         uuid primary key references public.companies (id) on delete cascade,
  is_enabled         boolean not null default true,
  assistant_name     text not null default 'Assistant',
  welcome_message    text not null default 'Bonjour ! Comment puis-je vous aider ?',
  tone               text not null default 'professionnel et chaleureux',
  instructions       text,                       -- consignes supplémentaires du dirigeant
  primary_color      text check (primary_color is null or primary_color ~ '^#[0-9a-fA-F]{6}$'),
  position           text not null default 'right' check (position in ('left', 'right')),
  collect_contact    boolean not null default true,
  can_create_quote_requests boolean not null default true,
  can_book_appointments     boolean not null default false,
  allowed_domains    text[] not null default '{}', -- vide = tous les domaines
  notify_email       text,
  updated_at         timestamptz not null default now()
);
create trigger assistant_settings_updated_at before update on public.assistant_settings
  for each row execute function private.set_updated_at();

-- Crée les réglages par défaut avec chaque entreprise
create or replace function private.companies_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.assistant_settings (company_id, notify_email) values (new.id, new.email);
  insert into public.availability_rules (company_id, weekday, start_time, end_time)
  select new.id, d, time '08:00', time '12:00' from generate_series(1, 5) d
  union all
  select new.id, d, time '14:00', time '18:00' from generate_series(1, 5) d;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- Prospects
-- ---------------------------------------------------------------------
create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid,
  client_id       uuid,
  name            text,
  email           text,
  phone           text,
  need            text,                         -- besoin exprimé / demande de devis
  status          public.lead_status not null default 'new',
  source          public.conversation_channel not null default 'widget',
  is_quote_request boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id)
);
create index leads_company_idx on public.leads (company_id, status, created_at desc);
create trigger leads_updated_at before update on public.leads
  for each row execute function private.set_updated_at();

alter table public.quotes
  add constraint quotes_lead_fk foreign key (lead_id, company_id)
  references public.leads (id, company_id) match simple on delete set null (lead_id);

-- ---------------------------------------------------------------------
-- Conversations et messages
-- ---------------------------------------------------------------------
create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  channel          public.conversation_channel not null default 'widget',
  visitor_id       text not null,                -- identifiant anonyme côté navigateur
  external_id      text,                          -- id WhatsApp / Instagram (plus tard)
  contact_name     text,
  contact_email    text,
  contact_phone    text,
  lead_id          uuid,
  mode             public.conversation_mode not null default 'ai',
  status           text not null default 'open' check (status in ('open', 'closed')),
  unread           boolean not null default true,
  page_url         text,
  last_message_at  timestamptz not null default now(),
  last_message_preview text,
  created_at       timestamptz not null default now(),
  unique (id, company_id),
  foreign key (lead_id, company_id) references public.leads (id, company_id)
    match simple on delete set null (lead_id)
);
create index conversations_company_idx on public.conversations (company_id, last_message_at desc);
create index conversations_visitor_idx on public.conversations (company_id, visitor_id);

alter table public.leads
  add constraint leads_conversation_fk foreign key (conversation_id, company_id)
  references public.conversations (id, company_id) match simple on delete set null (conversation_id);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  company_id      uuid not null,
  role            public.message_role not null,
  content         text not null check (length(content) <= 8000),
  author_id       uuid references auth.users (id) on delete set null,
  input_tokens    integer,
  output_tokens   integer,
  created_at      timestamptz not null default now(),
  foreign key (conversation_id, company_id) references public.conversations (id, company_id) on delete cascade
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

create or replace function private.messages_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations set
    last_message_at = new.created_at,
    last_message_preview = left(new.content, 160),
    unread = case when new.role = 'agent' then false else true end,
    status = 'open'
  where id = new.conversation_id;
  return null;
end $$;

create trigger messages_after_insert after insert on public.messages
  for each row execute function private.messages_after_insert();

-- Réponse manuelle : l'auteur est forcé à l'utilisateur courant
create or replace function private.messages_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then          -- appel depuis l'app (pas le service role)
    if new.role <> 'agent' then
      raise exception 'Seules les réponses manuelles peuvent être ajoutées depuis l''application.';
    end if;
    new.author_id := auth.uid();
    -- Reprise en main : l'IA ne répond plus sur cette conversation
    update public.conversations set mode = 'human' where id = new.conversation_id;
  end if;
  return new;
end $$;

create trigger messages_before_insert before insert on public.messages
  for each row execute function private.messages_before_insert();

-- ---------------------------------------------------------------------
-- Rendez-vous et agenda
-- ---------------------------------------------------------------------
create table public.availability_rules (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),   -- 0 = dimanche
  start_time  time not null,
  end_time    time not null check (end_time > start_time),
  slot_minutes integer not null default 60 check (slot_minutes between 15 and 480)
);
create index availability_company_idx on public.availability_rules (company_id, weekday);

create trigger companies_after_insert after insert on public.companies
  for each row execute function private.companies_after_insert();

create table public.appointments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  client_id       uuid,
  lead_id         uuid,
  conversation_id uuid,
  title           text not null,
  description     text,
  location        text,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null check (ends_at > starts_at),
  status          public.appointment_status not null default 'confirmed',
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  google_event_id text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (client_id, company_id) references public.clients (id, company_id),
  foreign key (lead_id, company_id) references public.leads (id, company_id)
    match simple on delete set null (lead_id),
  foreign key (conversation_id, company_id) references public.conversations (id, company_id)
    match simple on delete set null (conversation_id)
);
create index appointments_company_idx on public.appointments (company_id, starts_at);
create trigger appointments_updated_at before update on public.appointments
  for each row execute function private.set_updated_at();

-- Connexion Google Agenda : métadonnées visibles, jetons OAuth cachés
create table public.calendar_integrations (
  company_id     uuid primary key references public.companies (id) on delete cascade,
  provider       text not null default 'google',
  account_email  text,
  calendar_id    text not null default 'primary',
  connected_by   uuid references auth.users (id) on delete set null,
  connected_at   timestamptz not null default now()
);

create table private.oauth_tokens (
  company_id    uuid not null references public.companies (id) on delete cascade,
  provider      text not null,
  refresh_token text not null,
  access_token  text,
  expires_at    timestamptz,
  primary key (company_id, provider)
);
revoke all on private.oauth_tokens from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- Demandes d'avis Google
-- ---------------------------------------------------------------------
create table public.review_requests (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  client_id    uuid,
  quote_id     uuid,
  invoice_id   uuid,
  email        text not null,
  status       text not null default 'scheduled' check (status in ('scheduled', 'sent', 'clicked', 'cancelled')),
  scheduled_at timestamptz not null default now() + interval '1 day',
  sent_at      timestamptz,
  clicked_at   timestamptz,
  token        uuid not null unique default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  foreign key (client_id, company_id) references public.clients (id, company_id),
  foreign key (quote_id, company_id) references public.quotes (id, company_id)
);
create index review_requests_due_idx on public.review_requests (status, scheduled_at) where status = 'scheduled';

-- Prestation marquée terminée → planifie une demande d'avis
create or replace function private.schedule_review_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
begin
  if new.work_completed_at is not null and old.work_completed_at is null
     and exists (select 1 from public.companies c where c.id = new.company_id
                 and c.review_requests_enabled and c.google_review_url is not null) then
    select coalesce(new.client_snapshot ->> 'email', cl.email) into v_email
    from public.clients cl where cl.id = new.client_id;
    if v_email is not null and not exists (select 1 from public.review_requests where quote_id = new.id) then
      insert into public.review_requests (company_id, client_id, quote_id, email)
      values (new.company_id, new.client_id, new.id, v_email);
    end if;
  end if;
  return null;
end $$;

create trigger quotes_review_request after update of work_completed_at on public.quotes
  for each row execute function private.schedule_review_request();

-- ---------------------------------------------------------------------
-- Journal des emails envoyés (relances, envois, avis) – idempotence du cron
-- ---------------------------------------------------------------------
create table public.email_logs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  kind          text not null,   -- quote_sent, quote_reminder_3, quote_reminder_7, invoice_sent, invoice_reminder, review_request…
  quote_id      uuid references public.quotes (id) on delete set null,
  invoice_id    uuid references public.invoices (id) on delete set null,
  to_email      text not null,
  subject       text,
  provider_id   text,            -- id Resend
  status        text not null default 'sent',
  error         text,
  created_at    timestamptz not null default now()
);
create index email_logs_company_idx on public.email_logs (company_id, created_at desc);
create unique index email_logs_reminder_once on public.email_logs (quote_id, kind)
  where kind like 'quote_reminder_%';

-- ---------------------------------------------------------------------
-- Application mobile : jetons de notification push (Expo)
-- ---------------------------------------------------------------------
create table public.push_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  platform   text check (platform in ('ios', 'android')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.knowledge_entries     enable row level security;
alter table public.assistant_settings    enable row level security;
alter table public.leads                 enable row level security;
alter table public.conversations         enable row level security;
alter table public.messages              enable row level security;
alter table public.availability_rules    enable row level security;
alter table public.appointments          enable row level security;
alter table public.calendar_integrations enable row level security;
alter table public.review_requests       enable row level security;
alter table public.email_logs            enable row level security;
alter table public.push_tokens           enable row level security;

do $$
declare t text;
begin
  foreach t in array array['knowledge_entries', 'leads', 'availability_rules', 'appointments', 'review_requests'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (private.is_member(company_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (private.is_member(company_id))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (private.is_member(company_id)) with check (private.is_member(company_id))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (private.is_member(company_id))', t);
  end loop;
end $$;

-- Réglages assistant : lecture membres, modification owner/admin
create policy assistant_settings_select on public.assistant_settings for select to authenticated
  using (private.is_member(company_id));
create policy assistant_settings_update on public.assistant_settings for update to authenticated
  using (private.has_role(company_id, '{owner,admin}'))
  with check (private.has_role(company_id, '{owner,admin}'));

-- Conversations : créées par le widget (service role) ; les membres lisent, reprennent la main, archivent
create policy conversations_select on public.conversations for select to authenticated
  using (private.is_member(company_id));
create policy conversations_update on public.conversations for update to authenticated
  using (private.is_member(company_id)) with check (private.is_member(company_id));
create policy conversations_delete on public.conversations for delete to authenticated
  using (private.has_role(company_id, '{owner,admin}'));
revoke update on public.conversations from authenticated;
grant update (mode, status, unread, contact_name, contact_email, contact_phone, lead_id)
  on public.conversations to authenticated;

-- Messages : lecture + réponse manuelle (role = 'agent' imposé par trigger)
create policy messages_select on public.messages for select to authenticated
  using (private.is_member(company_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (private.is_member(company_id) and role = 'agent');

-- Agenda
create policy calendar_select on public.calendar_integrations for select to authenticated
  using (private.is_member(company_id));
create policy calendar_delete on public.calendar_integrations for delete to authenticated
  using (private.has_role(company_id, '{owner,admin}'));

-- Journal emails : lecture seule
create policy email_logs_select on public.email_logs for select to authenticated
  using (private.is_member(company_id));

-- Push : chacun gère ses jetons
create policy push_tokens_own on public.push_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Temps réel : boîte de réception et notifications
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.conversations, public.quotes;
  end if;
end $$;

revoke insert, update, delete, truncate on public.email_logs from authenticated;
revoke insert, update on public.calendar_integrations from authenticated;
revoke all on public.knowledge_entries, public.assistant_settings, public.leads, public.conversations,
  public.messages, public.availability_rules, public.appointments, public.calendar_integrations,
  public.review_requests, public.email_logs, public.push_tokens from anon;
