-- =====================================================================
-- 02 · Catalogue, clients, devis, factures
-- Intégrité inter-tenant : les FK composites (id, company_id) empêchent
-- de rattacher un devis au client d'une autre entreprise.
-- =====================================================================

create type public.quote_status   as enum ('draft', 'sent', 'accepted', 'refused', 'expired');
create type public.invoice_status as enum ('draft', 'issued', 'paid', 'cancelled');
create type public.client_source  as enum ('manual', 'widget', 'import', 'mobile');

-- ---------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  description text,
  unit        text not null default 'unité',     -- unité, heure, jour, m², forfait…
  unit_price  numeric(12,2) not null default 0 check (unit_price >= 0),
  vat_rate    numeric(5,2) not null default 20 check (vat_rate between 0 and 100),
  category    text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, company_id)
);
create index products_company_idx on public.products (company_id, is_active, name);
create trigger products_updated_at before update on public.products
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------
create table public.clients (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  type          text not null default 'particulier' check (type in ('particulier', 'professionnel')),
  name          text not null check (length(trim(name)) > 0),
  company_name  text,
  siret         text,
  email         text,
  phone         text,
  address_line1 text,
  address_line2 text,
  postal_code   text,
  city          text,
  country       text default 'France',
  notes         text,
  source        public.client_source not null default 'manual',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, company_id)
);
create index clients_company_idx on public.clients (company_id, name);
create index clients_email_idx on public.clients (company_id, lower(email));
create trigger clients_updated_at before update on public.clients
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Numérotation : DEV-2026-001 / FAC-2026-001, séquence par entreprise et par an
-- ---------------------------------------------------------------------
create table public.document_sequences (
  company_id uuid not null references public.companies (id) on delete cascade,
  doc_type   text not null check (doc_type in ('quote', 'invoice')),
  year       integer not null,
  last_value integer not null default 0,
  primary key (company_id, doc_type, year)
);

create or replace function private.next_document_number(p_company_id uuid, p_doc_type text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_year int := extract(year from now())::int;
  v_next int;
begin
  insert into public.document_sequences as s (company_id, doc_type, year, last_value)
  values (p_company_id, p_doc_type, v_year, 1)
  on conflict (company_id, doc_type, year)
  do update set last_value = s.last_value + 1
  returning last_value into v_next;

  return (case p_doc_type when 'quote' then 'DEV' else 'FAC' end)
         || '-' || v_year || '-' || lpad(v_next::text, 3, '0');
end $$;

-- ---------------------------------------------------------------------
-- Devis
-- ---------------------------------------------------------------------
create table public.quotes (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  client_id          uuid,
  number             text,
  status             public.quote_status not null default 'draft',
  title              text,
  intro              text,                    -- texte d'introduction
  notes              text,                    -- conditions particulières
  issue_date         date not null default current_date,
  valid_until        date,
  discount_percent   numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  -- Totaux (calculés par trigger, ne pas écrire depuis le client)
  subtotal_ht        numeric(12,2) not null default 0,
  discount_amount    numeric(12,2) not null default 0,
  total_ht           numeric(12,2) not null default 0,
  total_vat          numeric(12,2) not null default 0,
  total_ttc          numeric(12,2) not null default 0,
  vat_breakdown      jsonb not null default '[]',
  -- Acompte
  deposit_percent    numeric(5,2) not null default 0 check (deposit_percent between 0 and 100),
  deposit_amount     numeric(12,2) not null default 0,
  deposit_paid_at    timestamptz,
  stripe_checkout_session_id text,
  -- Envoi / signature
  public_token       uuid not null unique default gen_random_uuid(),
  client_snapshot    jsonb,                   -- coordonnées figées à l'envoi
  sent_at            timestamptz,
  viewed_at          timestamptz,
  accepted_at        timestamptz,
  refused_at         timestamptz,
  refusal_reason     text,
  signed_by_name     text,
  signature_data     text,                    -- image PNG (data URL) du tracé
  signer_ip          text,
  -- Relances / prestation
  reminder_count     integer not null default 0,
  last_reminder_at   timestamptz,
  work_completed_at  timestamptz,             -- déclenche la demande d'avis Google
  pdf_path           text,
  ai_generated       boolean not null default false,
  lead_id            uuid,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, number),
  foreign key (client_id, company_id) references public.clients (id, company_id)
);
create index quotes_company_status_idx on public.quotes (company_id, status, issue_date desc);
create index quotes_client_idx on public.quotes (client_id);
create index quotes_reminder_idx on public.quotes (status, sent_at) where status = 'sent';
create trigger quotes_updated_at before update on public.quotes
  for each row execute function private.set_updated_at();

create table public.quote_items (
  id               uuid primary key default gen_random_uuid(),
  quote_id         uuid not null,
  company_id       uuid not null,
  product_id       uuid,
  position         integer not null default 0,
  kind             text not null default 'item' check (kind in ('item', 'section', 'note')),
  description      text not null default '',
  quantity         numeric(12,3) not null default 1 check (quantity >= 0),
  unit             text not null default 'unité',
  unit_price       numeric(12,2) not null default 0,
  vat_rate         numeric(5,2) not null default 20 check (vat_rate between 0 and 100),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  total_ht         numeric(12,2) generated always as (
                     case when kind = 'item'
                          then round(quantity * unit_price * (1 - discount_percent / 100), 2)
                          else 0 end) stored,
  created_at       timestamptz not null default now(),
  foreign key (quote_id, company_id) references public.quotes (id, company_id) on delete cascade,
  foreign key (product_id, company_id) references public.products (id, company_id)
    match simple on delete set null (product_id)
);
create index quote_items_quote_idx on public.quote_items (quote_id, position);

-- ---------------------------------------------------------------------
-- Factures
-- ---------------------------------------------------------------------
create table public.invoices (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  client_id          uuid,
  quote_id           uuid,
  number             text,                    -- attribué à l'émission (numérotation continue)
  status             public.invoice_status not null default 'draft',
  kind               text not null default 'standard' check (kind in ('standard', 'deposit', 'balance')),
  title              text,
  notes              text,
  issue_date         date,
  due_date           date,
  discount_percent   numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  subtotal_ht        numeric(12,2) not null default 0,
  discount_amount    numeric(12,2) not null default 0,
  total_ht           numeric(12,2) not null default 0,
  total_vat          numeric(12,2) not null default 0,
  total_ttc          numeric(12,2) not null default 0,
  vat_breakdown      jsonb not null default '[]',
  amount_paid        numeric(12,2) not null default 0,
  paid_at            timestamptz,
  public_token       uuid not null unique default gen_random_uuid(),
  client_snapshot    jsonb,
  sent_at            timestamptz,
  reminder_count     integer not null default 0,
  last_reminder_at   timestamptz,
  pdf_path           text,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, number),
  foreign key (client_id, company_id) references public.clients (id, company_id),
  foreign key (quote_id, company_id) references public.quotes (id, company_id)
);
create index invoices_company_status_idx on public.invoices (company_id, status, issue_date desc);
create index invoices_unpaid_idx on public.invoices (status, due_date) where status = 'issued';
create trigger invoices_updated_at before update on public.invoices
  for each row execute function private.set_updated_at();

create table public.invoice_items (
  id               uuid primary key default gen_random_uuid(),
  invoice_id       uuid not null,
  company_id       uuid not null,
  product_id       uuid,
  position         integer not null default 0,
  kind             text not null default 'item' check (kind in ('item', 'section', 'note')),
  description      text not null default '',
  quantity         numeric(12,3) not null default 1 check (quantity >= 0),
  unit             text not null default 'unité',
  unit_price       numeric(12,2) not null default 0,
  vat_rate         numeric(5,2) not null default 20 check (vat_rate between 0 and 100),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  total_ht         numeric(12,2) generated always as (
                     case when kind = 'item'
                          then round(quantity * unit_price * (1 - discount_percent / 100), 2)
                          else 0 end) stored,
  created_at       timestamptz not null default now(),
  foreign key (invoice_id, company_id) references public.invoices (id, company_id) on delete cascade,
  foreign key (product_id, company_id) references public.products (id, company_id)
    match simple on delete set null (product_id)
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id, position);

-- ---------------------------------------------------------------------
-- Calcul des totaux HT / TVA / TTC
-- TVA calculée par taux après remise globale ; 0 si franchise / DOM.
-- ---------------------------------------------------------------------
create or replace function private.compute_totals(
  p_company_id uuid, p_lines jsonb, p_discount numeric,
  out subtotal_ht numeric, out discount_amount numeric, out total_ht numeric,
  out total_vat numeric, out total_ttc numeric, out vat_breakdown jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_regime public.vat_regime;
  v_factor numeric := 1 - coalesce(p_discount, 0) / 100;
begin
  select c.vat_regime into v_regime from public.companies c where c.id = p_company_id;

  select coalesce(sum((l ->> 'total_ht')::numeric), 0) into subtotal_ht
  from jsonb_array_elements(p_lines) l;

  discount_amount := round(subtotal_ht * (1 - v_factor), 2);
  total_ht := subtotal_ht - discount_amount;

  if v_regime = 'assujetti' then
    select coalesce(jsonb_agg(jsonb_build_object('rate', rate, 'base', base, 'amount', amount) order by rate), '[]'),
           coalesce(sum(amount), 0)
      into vat_breakdown, total_vat
    from (
      select (l ->> 'vat_rate')::numeric as rate,
             round(sum((l ->> 'total_ht')::numeric) * v_factor, 2) as base,
             round(sum((l ->> 'total_ht')::numeric) * v_factor * (l ->> 'vat_rate')::numeric / 100, 2) as amount
      from jsonb_array_elements(p_lines) l
      group by 1
    ) t;
  else
    total_vat := 0;
    vat_breakdown := '[]';
  end if;

  total_ttc := total_ht + total_vat;
end $$;

create or replace function private.recalc_quote(p_quote_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  q public.quotes;
  t record;
begin
  select * into q from public.quotes where id = p_quote_id;
  if not found then return; end if;

  select * into t from private.compute_totals(
    q.company_id,
    coalesce((select jsonb_agg(jsonb_build_object('total_ht', i.total_ht, 'vat_rate', i.vat_rate))
              from public.quote_items i where i.quote_id = p_quote_id and i.kind = 'item'), '[]'),
    q.discount_percent);

  update public.quotes set
    subtotal_ht = t.subtotal_ht, discount_amount = t.discount_amount, total_ht = t.total_ht,
    total_vat = t.total_vat, total_ttc = t.total_ttc, vat_breakdown = t.vat_breakdown,
    deposit_amount = round(t.total_ttc * deposit_percent / 100, 2)
  where id = p_quote_id;
end $$;

create or replace function private.recalc_invoice(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  inv public.invoices;
  t record;
begin
  select * into inv from public.invoices where id = p_invoice_id;
  if not found then return; end if;

  select * into t from private.compute_totals(
    inv.company_id,
    coalesce((select jsonb_agg(jsonb_build_object('total_ht', i.total_ht, 'vat_rate', i.vat_rate))
              from public.invoice_items i where i.invoice_id = p_invoice_id and i.kind = 'item'), '[]'),
    inv.discount_percent);

  update public.invoices set
    subtotal_ht = t.subtotal_ht, discount_amount = t.discount_amount, total_ht = t.total_ht,
    total_vat = t.total_vat, total_ttc = t.total_ttc, vat_breakdown = t.vat_breakdown
  where id = p_invoice_id;
end $$;

create or replace function private.quote_items_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.recalc_quote(coalesce(new.quote_id, old.quote_id));
  if tg_op = 'UPDATE' and new.quote_id <> old.quote_id then
    perform private.recalc_quote(old.quote_id);
  end if;
  return null;
end $$;

create trigger quote_items_recalc after insert or update or delete on public.quote_items
  for each row execute function private.quote_items_changed();

create or replace function private.invoice_items_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.recalc_invoice(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;

create trigger invoice_items_recalc after insert or update or delete on public.invoice_items
  for each row execute function private.invoice_items_changed();

-- ---------------------------------------------------------------------
-- Devis : valeurs par défaut, numéro, cycle de vie
-- ---------------------------------------------------------------------
create or replace function private.client_snapshot(p_client_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(c) - 'notes' - 'company_id' - 'created_at' - 'updated_at'
  from public.clients c where c.id = p_client_id;
$$;

create or replace function private.quotes_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.companies;
begin
  select * into c from public.companies where id = new.company_id;

  if tg_op = 'INSERT' then
    new.number          := coalesce(new.number, private.next_document_number(new.company_id, 'quote'));
    new.valid_until     := coalesce(new.valid_until, new.issue_date + c.quote_validity_days);
    new.deposit_percent := coalesce(nullif(new.deposit_percent, 0), c.deposit_percent);
    new.created_by      := coalesce(new.created_by, auth.uid());
    -- Les totaux sont toujours recalculés : on ignore ce qu'envoie le client
    new.subtotal_ht := 0; new.discount_amount := 0; new.total_ht := 0;
    new.total_vat := 0; new.total_ttc := 0; new.deposit_amount := 0; new.vat_breakdown := '[]';
    return new;
  end if;

  -- UPDATE
  if new.company_id <> old.company_id or new.number <> old.number then
    raise exception 'Le numéro et l''entreprise d''un devis ne sont pas modifiables.';
  end if;

  if new.status = 'sent' and old.status = 'draft' then
    new.sent_at := coalesce(new.sent_at, now());
    new.client_snapshot := private.client_snapshot(new.client_id);
  elsif new.status = 'accepted' and old.status <> 'accepted' then
    new.accepted_at := coalesce(new.accepted_at, now());
  elsif new.status = 'refused' and old.status <> 'refused' then
    new.refused_at := coalesce(new.refused_at, now());
  end if;

  -- Un devis signé n'est plus modifiable sur le fond
  if old.status = 'accepted' and old.signature_data is not null
     and (new.discount_percent <> old.discount_percent or new.client_id is distinct from old.client_id) then
    raise exception 'Ce devis a été signé : créez un nouveau devis pour le modifier.';
  end if;

  if new.discount_percent <> old.discount_percent or new.deposit_percent <> old.deposit_percent then
    new.deposit_amount := round(new.total_ttc * new.deposit_percent / 100, 2);
  end if;
  return new;
end $$;

create trigger quotes_before_write before insert or update on public.quotes
  for each row execute function private.quotes_before_write();

create or replace function private.quotes_after_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.discount_percent <> old.discount_percent then
    perform private.recalc_quote(new.id);
  end if;
  return null;
end $$;

create trigger quotes_after_update after update of discount_percent on public.quotes
  for each row execute function private.quotes_after_update();

-- Lignes d'un devis signé : verrouillées
create or replace function private.lock_signed_quote_items()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.quotes q
             where q.id = coalesce(new.quote_id, old.quote_id)
               and q.status = 'accepted' and q.signature_data is not null) then
    raise exception 'Ce devis a été signé : ses lignes ne sont plus modifiables.';
  end if;
  return coalesce(new, old);
end $$;

create trigger quote_items_lock before insert or update or delete on public.quote_items
  for each row execute function private.lock_signed_quote_items();

-- ---------------------------------------------------------------------
-- Factures : numéro attribué à l'émission, document figé ensuite
-- ---------------------------------------------------------------------
create or replace function private.invoices_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.companies;
begin
  select * into c from public.companies where id = new.company_id;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.subtotal_ht := 0; new.discount_amount := 0; new.total_ht := 0;
    new.total_vat := 0; new.total_ttc := 0; new.vat_breakdown := '[]';
    if new.status <> 'draft' then
      raise exception 'Une facture est créée en brouillon puis émise.';
    end if;
    new.number := null;
    return new;
  end if;

  if new.company_id <> old.company_id then
    raise exception 'L''entreprise d''une facture n''est pas modifiable.';
  end if;

  if old.status = 'draft' and new.status in ('paid') then
    raise exception 'Émettez la facture avant de l''enregistrer comme payée.';
  end if;

  if old.status = 'draft' and new.status = 'issued' then
    if new.client_id is null then
      raise exception 'Une facture doit avoir un client pour être émise.';
    end if;
    new.number          := private.next_document_number(new.company_id, 'invoice');
    new.issue_date      := coalesce(new.issue_date, current_date);
    new.due_date        := coalesce(new.due_date, new.issue_date + c.invoice_due_days);
    new.client_snapshot := private.client_snapshot(new.client_id);
  elsif old.status <> 'draft' then
    -- Après émission : seuls le paiement, l'envoi, les relances, le PDF et l'annulation évoluent
    if new.number is distinct from old.number
       or new.client_id is distinct from old.client_id
       or new.discount_percent <> old.discount_percent
       or new.issue_date is distinct from old.issue_date
       or new.total_ttc <> old.total_ttc
       or (new.status = 'draft') then
      raise exception 'Une facture émise n''est plus modifiable (émettez un avoir).';
    end if;
  elsif new.number is distinct from old.number then
    raise exception 'Le numéro de facture est attribué automatiquement.';
  end if;

  if new.amount_paid >= new.total_ttc and new.total_ttc > 0 and new.status = 'issued' then
    new.status := 'paid';
  end if;
  if new.status = 'paid' and old.status <> 'paid' then
    new.paid_at := coalesce(new.paid_at, now());
    new.amount_paid := greatest(new.amount_paid, new.total_ttc);
  end if;
  return new;
end $$;

create trigger invoices_before_write before insert or update on public.invoices
  for each row execute function private.invoices_before_write();

create or replace function private.invoices_after_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.discount_percent <> old.discount_percent then
    perform private.recalc_invoice(new.id);
  end if;
  return null;
end $$;

create trigger invoices_after_update after update of discount_percent on public.invoices
  for each row execute function private.invoices_after_update();

create or replace function private.lock_issued_invoice_items()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.invoices i
             where i.id = coalesce(new.invoice_id, old.invoice_id) and i.status <> 'draft') then
    raise exception 'Une facture émise n''est plus modifiable.';
  end if;
  return coalesce(new, old);
end $$;

create trigger invoice_items_lock before insert or update or delete on public.invoice_items
  for each row execute function private.lock_issued_invoice_items();

-- ---------------------------------------------------------------------
-- Conversion devis accepté → facture (brouillon)
-- SECURITY INVOKER : les RLS de l'appelant s'appliquent.
-- ---------------------------------------------------------------------
create or replace function public.convert_quote_to_invoice(p_quote_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  q public.quotes;
  v_invoice_id uuid;
begin
  select * into q from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'Devis introuvable.';
  end if;
  if q.status <> 'accepted' then
    raise exception 'Seul un devis accepté peut être converti en facture.';
  end if;

  insert into public.invoices (company_id, client_id, quote_id, title, notes, discount_percent)
  values (q.company_id, q.client_id, q.id, q.title, q.notes, q.discount_percent)
  returning id into v_invoice_id;

  insert into public.invoice_items (invoice_id, company_id, product_id, position, kind,
    description, quantity, unit, unit_price, vat_rate, discount_percent)
  select v_invoice_id, q.company_id, product_id, position, kind,
         description, quantity, unit, unit_price, vat_rate, discount_percent
  from public.quote_items where quote_id = q.id order by position;

  -- Acompte déjà versé : déduit du montant restant dû
  if q.deposit_paid_at is not null then
    update public.invoices set amount_paid = q.deposit_amount where id = v_invoice_id;
  end if;

  return v_invoice_id;
end $$;

revoke execute on function public.convert_quote_to_invoice from anon, public;
grant execute on function public.convert_quote_to_invoice to authenticated;

-- ---------------------------------------------------------------------
-- Pages publiques (lien envoyé au client) : accès par jeton uniquement
-- ---------------------------------------------------------------------
create or replace function public.get_public_quote(p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  q public.quotes;
  v jsonb;
begin
  select * into q from public.quotes where public_token = p_token and status <> 'draft';
  if not found then return null; end if;

  if q.status = 'sent' and q.viewed_at is null then
    update public.quotes set viewed_at = now() where id = q.id;
  end if;

  select jsonb_build_object(
    'quote', to_jsonb(q) - 'signature_data' - 'signer_ip' - 'created_by' - 'stripe_checkout_session_id'
                         - 'reminder_count' - 'last_reminder_at' - 'lead_id' - 'ai_generated',
    'expired', q.status = 'sent' and q.valid_until < current_date,
    'items', coalesce((select jsonb_agg(to_jsonb(i) - 'company_id' order by i.position)
                       from public.quote_items i where i.quote_id = q.id), '[]'),
    'client', coalesce(q.client_snapshot, private.client_snapshot(q.client_id)),
    'company', (select to_jsonb(c) - 'widget_public_key' - 'created_by' - 'quote_reminders_enabled'
                       - 'quote_reminder_days' - 'invoice_reminders_enabled' - 'review_requests_enabled'
                from public.companies c where c.id = q.company_id),
    'online_signature', exists (
      select 1 from public.subscriptions s join public.plans p on p.id = s.plan_id
      where s.company_id = q.company_id and (p.online_signature or s.status = 'trialing'))
  ) into v;
  return v;
end $$;

create or replace function public.sign_quote(p_token uuid, p_signer_name text, p_signature text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  q public.quotes;
  v_allowed boolean;
begin
  select * into q from public.quotes where public_token = p_token for update;
  if not found then raise exception 'Devis introuvable.'; end if;
  if q.status <> 'sent' then raise exception 'Ce devis ne peut plus être signé.'; end if;
  if q.valid_until < current_date then raise exception 'Ce devis a expiré.'; end if;
  if length(trim(coalesce(p_signer_name, ''))) < 2 then raise exception 'Nom du signataire requis.'; end if;
  if p_signature is null or p_signature !~ '^data:image/png;base64,' or length(p_signature) > 500000 then
    raise exception 'Signature invalide.';
  end if;

  select exists (select 1 from public.subscriptions s join public.plans p on p.id = s.plan_id
                 where s.company_id = q.company_id and (p.online_signature or s.status = 'trialing'))
    into v_allowed;
  if not v_allowed then raise exception 'La signature en ligne n''est pas disponible pour cette entreprise.'; end if;

  update public.quotes set
    status = 'accepted',
    signed_by_name = trim(p_signer_name),
    signature_data = p_signature,
    signer_ip = split_part(coalesce(
      current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)
  where id = q.id;

  return jsonb_build_object('status', 'accepted', 'deposit_amount', q.deposit_amount,
                            'deposit_required', q.deposit_percent > 0 and q.deposit_paid_at is null);
end $$;

create or replace function public.refuse_quote(p_token uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.quotes set status = 'refused', refusal_reason = left(p_reason, 2000)
  where public_token = p_token and status = 'sent';
  if not found then raise exception 'Ce devis ne peut plus être refusé.'; end if;
end $$;

grant execute on function public.get_public_quote, public.sign_quote, public.refuse_quote to anon, authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.products           enable row level security;
alter table public.clients            enable row level security;
alter table public.document_sequences enable row level security;
alter table public.quotes             enable row level security;
alter table public.quote_items        enable row level security;
alter table public.invoices           enable row level security;
alter table public.invoice_items      enable row level security;

-- Données métier : accès complet pour tout membre de l'entreprise
do $$
declare t text;
begin
  foreach t in array array['products', 'clients', 'quotes', 'quote_items', 'invoice_items'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (private.is_member(company_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (private.is_member(company_id))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (private.is_member(company_id)) with check (private.is_member(company_id))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (private.is_member(company_id))', t);
  end loop;
end $$;

-- Factures : pas de suppression une fois émises
create policy invoices_select on public.invoices for select to authenticated
  using (private.is_member(company_id));
create policy invoices_insert on public.invoices for insert to authenticated
  with check (private.is_member(company_id));
create policy invoices_update on public.invoices for update to authenticated
  using (private.is_member(company_id)) with check (private.is_member(company_id));
create policy invoices_delete on public.invoices for delete to authenticated
  using (private.is_member(company_id) and status = 'draft');

-- Séquences : lecture seule (écriture via fonction)
create policy sequences_select on public.document_sequences for select to authenticated
  using (private.is_member(company_id));

-- Champs calculés / de signature : non modifiables par l'API
revoke update on public.quotes from authenticated;
grant update (client_id, status, title, intro, notes, issue_date, valid_until, discount_percent,
  deposit_percent, work_completed_at, pdf_path) on public.quotes to authenticated;

revoke update on public.invoices from authenticated;
grant update (client_id, status, title, notes, issue_date, due_date, discount_percent,
  amount_paid, paid_at, pdf_path, sent_at) on public.invoices to authenticated;

revoke insert, update, delete, truncate on public.document_sequences from anon, authenticated;
revoke all on public.products, public.clients, public.quotes, public.quote_items,
  public.invoices, public.invoice_items, public.document_sequences from anon;
