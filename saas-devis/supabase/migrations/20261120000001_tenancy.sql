-- =====================================================================
-- 01 · Socle multi-tenant : profils, entreprises, membres, abonnements
-- Chaque ligne métier porte un company_id ; l'isolation est assurée par
-- RLS via les fonctions du schéma `private` (non exposé par l'API).
-- =====================================================================

create extension if not exists pgcrypto;

create schema if not exists private;
grant usage on schema private to authenticated, anon;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type public.member_role as enum ('owner', 'admin', 'member');

-- assujetti           : TVA facturée normalement
-- franchise           : « TVA non applicable, art. 293 B du CGI » (micro-entreprise)
-- non_applicable_dom  : Guyane / Mayotte, « TVA non applicable, art. 294-1 du CGI »
create type public.vat_regime as enum ('assujetti', 'franchise', 'non_applicable_dom');

create type public.subscription_status as enum
  ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid');

-- ---------------------------------------------------------------------
-- Utilitaire updated_at
-- ---------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Profils (1-1 avec auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text not null,
  full_name          text,
  avatar_url         text,
  current_company_id uuid,
  is_platform_admin  boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Entreprises (tenants)
-- ---------------------------------------------------------------------
create table public.companies (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (length(trim(name)) > 0),
  legal_form           text,                      -- SARL, SAS, EI, micro-entreprise…
  siret                text check (siret is null or siret ~ '^[0-9]{14}$'),
  vat_number           text,                      -- n° TVA intracommunautaire
  rcs_rm               text,                      -- immatriculation RCS / RM
  share_capital        text,
  address_line1        text,
  address_line2        text,
  postal_code          text,
  city                 text,
  country              text not null default 'France',
  email                text,
  phone                text,
  website              text,
  logo_path            text,                      -- storage: logos/<company_id>/…
  brand_color          text not null default '#4f46e5'
                         check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  vat_regime           public.vat_regime not null default 'assujetti',
  default_vat_rate     numeric(5,2) not null default 20
                         check (default_vat_rate between 0 and 100),
  legal_mentions       text,                      -- mentions libres en pied de devis
  payment_terms        text default 'Paiement à 30 jours à réception de facture.',
  late_penalty_text    text default 'Pénalités de retard : 3 fois le taux d''intérêt légal. Indemnité forfaitaire pour frais de recouvrement : 40 €.',
  iban                 text,
  quote_validity_days  integer not null default 30 check (quote_validity_days > 0),
  invoice_due_days     integer not null default 30 check (invoice_due_days >= 0),
  deposit_percent      numeric(5,2) not null default 30 check (deposit_percent between 0 and 100),
  -- Relances
  quote_reminders_enabled   boolean not null default true,
  quote_reminder_days       integer[] not null default '{3,7}',
  invoice_reminders_enabled boolean not null default true,
  -- Avis Google
  google_review_url    text,
  review_requests_enabled boolean not null default false,
  -- Widget : clé publique utilisée par le script intégré au site
  widget_public_key    uuid not null unique default gen_random_uuid(),
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger companies_updated_at before update on public.companies
  for each row execute function private.set_updated_at();

alter table public.profiles
  add constraint profiles_current_company_fk
  foreign key (current_company_id) references public.companies (id) on delete set null;

create table public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index company_members_user_idx on public.company_members (user_id);

create table public.company_invitations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  email       text not null,
  role        public.member_role not null default 'member' check (role <> 'owner'),
  token       uuid not null unique default gen_random_uuid(),
  invited_by  uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  expires_at  timestamptz not null default now() + interval '7 days',
  created_at  timestamptz not null default now(),
  unique (company_id, email)
);

-- ---------------------------------------------------------------------
-- Offres et abonnements
-- ---------------------------------------------------------------------
create table public.plans (
  id                     text primary key,           -- 'starter' | 'pro'
  name                   text not null,
  price_cents            integer not null,
  max_users              integer not null,
  ai_messages_per_month  integer not null,
  online_signature       boolean not null default false,
  stripe_price_id        text,
  sort_order             integer not null default 0
);

insert into public.plans (id, name, price_cents, max_users, ai_messages_per_month, online_signature, sort_order) values
  ('starter', 'Starter', 2900, 1, 200,  false, 1),
  ('pro',     'Pro',     4900, 3, 1000, true,  2);

create table public.subscriptions (
  company_id             uuid primary key references public.companies (id) on delete cascade,
  plan_id                text not null references public.plans (id) default 'pro',
  status                 public.subscription_status not null default 'trialing',
  trial_ends_at          timestamptz default now() + interval '14 days',
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function private.set_updated_at();

create table public.usage_counters (
  company_id            uuid not null references public.companies (id) on delete cascade,
  period                date not null,              -- 1er jour du mois
  ai_messages           integer not null default 0,
  ai_quote_generations  integer not null default 0,
  emails_sent           integer not null default 0,
  primary key (company_id, period)
);

-- ---------------------------------------------------------------------
-- Fonctions d'autorisation (SECURITY DEFINER pour éviter la récursion RLS)
-- ---------------------------------------------------------------------
create or replace function private.is_member(cid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = cid and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_role(cid uuid, roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = cid and m.user_id = (select auth.uid()) and m.role = any (roles)
  );
$$;

create or replace function private.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.is_platform_admin from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

-- Abonnement utilisable : essai en cours ou abonnement actif
create or replace function private.has_active_subscription(cid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subscriptions s
    where s.company_id = cid
      and (
        (s.status = 'trialing' and coalesce(s.trial_ends_at, now()) > now())
        or s.status = 'active'
        or (s.status = 'past_due' and coalesce(s.current_period_end, now()) + interval '7 days' > now())
      )
  );
$$;

grant execute on all functions in schema private to authenticated;
revoke execute on all functions in schema private from anon, public;

-- ---------------------------------------------------------------------
-- Création du profil à l'inscription
-- ---------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''));

  -- Rattache automatiquement les invitations en attente
  insert into public.company_members (company_id, user_id, role)
  select i.company_id, new.id, i.role
  from public.company_invitations i
  where lower(i.email) = lower(new.email) and i.accepted_at is null and i.expires_at > now()
  on conflict do nothing;

  update public.company_invitations
     set accepted_at = now()
   where lower(email) = lower(new.email) and accepted_at is null and expires_at > now();

  update public.profiles p
     set current_company_id = (select company_id from public.company_members
                                where user_id = new.id order by created_at limit 1)
   where p.id = new.id;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------
-- Onboarding : créer une entreprise (le créateur devient propriétaire,
-- essai Pro de 14 jours)
-- ---------------------------------------------------------------------
create or replace function public.create_company(
  p_name text,
  p_vat_regime public.vat_regime default 'assujetti',
  p_siret text default null
) returns public.companies
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_company public.companies;
begin
  if v_uid is null then
    raise exception 'Authentification requise' using errcode = '42501';
  end if;

  insert into public.companies (name, vat_regime, siret, created_by,
                                default_vat_rate, email)
  values (trim(p_name), p_vat_regime, nullif(regexp_replace(coalesce(p_siret, ''), '\s', '', 'g'), ''), v_uid,
          case when p_vat_regime = 'assujetti' then 20 else 0 end,
          (select email from public.profiles where id = v_uid))
  returning * into v_company;

  insert into public.company_members (company_id, user_id, role)
  values (v_company.id, v_uid, 'owner');

  insert into public.subscriptions (company_id) values (v_company.id);

  update public.profiles set current_company_id = v_company.id where id = v_uid;

  return v_company;
end $$;

revoke execute on function public.create_company from anon, public;
grant execute on function public.create_company to authenticated;

-- ---------------------------------------------------------------------
-- Limite d'utilisateurs selon l'offre
-- ---------------------------------------------------------------------
create or replace function private.enforce_member_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_max int;
  v_count int;
begin
  select p.max_users into v_max
  from public.subscriptions s join public.plans p on p.id = s.plan_id
  where s.company_id = new.company_id;

  -- Pas encore d'abonnement (création de l'entreprise) : on laisse passer
  if v_max is null then return new; end if;

  select count(*) into v_count from public.company_members where company_id = new.company_id;
  if v_count >= v_max then
    raise exception 'Votre offre est limitée à % utilisateur(s).', v_max using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger company_members_limit before insert on public.company_members
  for each row execute function private.enforce_member_limit();

-- Un propriétaire ne peut pas être supprimé / rétrogradé s'il est le dernier
create or replace function private.protect_last_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and not exists (select 1 from public.company_members
                      where company_id = old.company_id and role = 'owner' and user_id <> old.user_id)
     and exists (select 1 from public.companies where id = old.company_id) then
    raise exception 'L''entreprise doit conserver au moins un propriétaire.';
  end if;
  return coalesce(new, old);
end $$;

create trigger company_members_last_owner before update or delete on public.company_members
  for each row execute function private.protect_last_owner();

-- ---------------------------------------------------------------------
-- Usage IA (appelé uniquement par les Edge Functions, rôle service)
-- Retourne false si le quota mensuel est atteint.
-- ---------------------------------------------------------------------
create or replace function public.consume_ai_message(p_company_id uuid, p_kind text default 'message')
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_period date := date_trunc('month', now())::date;
  v_limit int;
  v_used int;
begin
  if not private.has_active_subscription(p_company_id) then
    return false;
  end if;

  select p.ai_messages_per_month into v_limit
  from public.subscriptions s join public.plans p on p.id = s.plan_id
  where s.company_id = p_company_id;

  insert into public.usage_counters (company_id, period) values (p_company_id, v_period)
  on conflict do nothing;

  select ai_messages + ai_quote_generations into v_used
  from public.usage_counters where company_id = p_company_id and period = v_period
  for update;

  if v_used >= coalesce(v_limit, 0) then
    return false;
  end if;

  update public.usage_counters
     set ai_messages          = ai_messages + (p_kind = 'message')::int,
         ai_quote_generations = ai_quote_generations + (p_kind = 'quote')::int
   where company_id = p_company_id and period = v_period;
  return true;
end $$;

revoke execute on function public.consume_ai_message from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.companies           enable row level security;
alter table public.company_members     enable row level security;
alter table public.company_invitations enable row level security;
alter table public.plans               enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.usage_counters      enable row level security;

-- Profils : chacun voit le sien + ceux des collègues ; ne modifie que le sien
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_platform_admin()
    or exists (
      select 1 from public.company_members me
      join public.company_members other on other.company_id = me.company_id
      where me.user_id = (select auth.uid()) and other.user_id = profiles.id
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and (current_company_id is null or private.is_member(current_company_id))
  );
-- Impossible de s'auto-promouvoir admin plateforme : privilèges par colonne
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url, current_company_id) on public.profiles to authenticated;

-- Entreprises
create policy companies_select on public.companies for select to authenticated
  using (private.is_member(id) or private.is_platform_admin());
create policy companies_update on public.companies for update to authenticated
  using (private.has_role(id, '{owner,admin}'))
  with check (private.has_role(id, '{owner,admin}'));
create policy companies_delete on public.companies for delete to authenticated
  using (private.has_role(id, '{owner}'));
-- (pas de policy INSERT : création via create_company())
-- widget_public_key / created_by non modifiables par les utilisateurs
revoke update on public.companies from authenticated;
grant update (name, legal_form, siret, vat_number, rcs_rm, share_capital,
  address_line1, address_line2, postal_code, city, country, email, phone, website,
  logo_path, brand_color, vat_regime, default_vat_rate, legal_mentions, payment_terms,
  late_penalty_text, iban, quote_validity_days, invoice_due_days, deposit_percent,
  quote_reminders_enabled, quote_reminder_days, invoice_reminders_enabled,
  google_review_url, review_requests_enabled) on public.companies to authenticated;

-- Membres
create policy members_select on public.company_members for select to authenticated
  using (private.is_member(company_id) or private.is_platform_admin());
create policy members_update on public.company_members for update to authenticated
  using (private.has_role(company_id, '{owner,admin}'))
  with check (private.has_role(company_id, '{owner,admin}')
              and (role <> 'owner' or private.has_role(company_id, '{owner}')));
create policy members_delete on public.company_members for delete to authenticated
  using (private.has_role(company_id, '{owner,admin}') or user_id = (select auth.uid()));

-- Invitations
create policy invitations_all on public.company_invitations for all to authenticated
  using (private.has_role(company_id, '{owner,admin}'))
  with check (private.has_role(company_id, '{owner,admin}'));

-- Offres : lisibles par tous (page tarifs)
create policy plans_select on public.plans for select to anon, authenticated using (true);

-- Abonnements et usage : lecture seule pour les membres (écriture = webhook Stripe)
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (private.is_member(company_id) or private.is_platform_admin());
create policy usage_select on public.usage_counters for select to authenticated
  using (private.is_member(company_id) or private.is_platform_admin());

-- Tables écrites uniquement côté serveur (webhook Stripe, Edge Functions)
revoke insert, update, delete, truncate on public.plans, public.subscriptions, public.usage_counters
  from anon, authenticated;
revoke all on public.companies, public.company_members, public.company_invitations, public.profiles from anon;
revoke insert on public.companies, public.company_members, public.profiles from authenticated;
