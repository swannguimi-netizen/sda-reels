-- =====================================================================
-- 11 · Acompte payé en ligne (Stripe Connect, compte de l'entreprise)
-- L'argent est versé directement sur le compte Stripe de l'entreprise
-- (compte Standard, paiement direct) ; la plateforme ne l'encaisse jamais.
-- =====================================================================

alter table public.companies
  add column stripe_account_id text unique,
  add column stripe_charges_enabled boolean not null default false,
  add column stripe_details_submitted boolean not null default false,
  add column deposit_online_enabled boolean not null default true;

grant update (deposit_online_enabled) on public.companies to authenticated;

-- Acompte payable en ligne : offre, compte Stripe actif, option activée
create or replace function private.online_deposit_available(p_company_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.plan_has_feature(p_company_id, 'online_deposit')
     and exists (select 1 from public.companies c where c.id = p_company_id
                 and c.stripe_charges_enabled and c.deposit_online_enabled and c.stripe_account_id is not null);
$$;
grant execute on function private.online_deposit_available(uuid) to authenticated;

-- La page publique du devis indique si l'acompte peut être payé en ligne
do $$
declare v_src text;
begin
  select pg_get_functiondef('public.get_public_quote(uuid)'::regprocedure) into v_src;
  v_src := replace(v_src,
    $q$'online_signature', private.online_signature_allowed(q.company_id)$q$,
    $q$'online_signature', private.online_signature_allowed(q.company_id),
    'online_deposit', private.online_deposit_available(q.company_id)$q$);
  execute v_src;

  -- Facture finale : déduit les factures d'acompte réellement émises
  select pg_get_functiondef('public.convert_quote_to_invoice(uuid)'::regprocedure) into v_src;
  v_src := replace(v_src,
    $q$if q.deposit_paid_at is not null then
    update public.invoices set amount_paid = q.deposit_amount where id = v_invoice_id;$q$,
    $q$if q.deposit_paid_at is not null then
    update public.invoices set
      amount_paid = coalesce((select sum(d.total_ttc) from public.invoices d
                              where d.quote_id = q.id and d.kind = 'deposit' and d.status in ('issued', 'paid')), q.deposit_amount),
      notes = concat_ws(E'\n', notes, (select 'Acompte(s) déjà facturé(s) : ' || string_agg(d.number, ', ' order by d.number)
                                         from public.invoices d where d.quote_id = q.id and d.kind = 'deposit' and d.number is not null))
    where id = v_invoice_id;$q$);
  execute v_src;
end $$;

-- ---------------------------------------------------------------------
-- Facture d'acompte (obligatoire à l'encaissement d'un acompte)
-- Montants au prorata de chaque taux de TVA du devis. Appelée par le webhook Stripe.
-- ---------------------------------------------------------------------
create or replace function public.create_deposit_invoice(p_quote_id uuid, p_amount_paid numeric, p_reference text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  q public.quotes;
  v_invoice uuid;
  v_ratio numeric;
  v_regime public.vat_regime;
begin
  select * into q from public.quotes where id = p_quote_id for update;
  if not found then raise exception 'Devis introuvable.'; end if;
  if q.deposit_paid_at is not null then
    -- Déjà traité (webhook rejoué) : on renvoie la facture existante
    return (select id from public.invoices where quote_id = q.id and kind = 'deposit' order by created_at limit 1);
  end if;
  v_ratio := q.deposit_percent / 100;
  select vat_regime into v_regime from public.companies where id = q.company_id;

  insert into public.invoices (company_id, client_id, quote_id, kind, title, notes)
  values (q.company_id, q.client_id, q.id, 'deposit',
          'Acompte de ' || trim(to_char(q.deposit_percent, 'FM990.##')) || ' % – ' || coalesce(q.title, 'devis ' || q.number),
          'Acompte versé en ligne le ' || to_char(now(), 'DD/MM/YYYY') || ' (réf. ' || p_reference || '), à valoir sur le devis ' || q.number || '.')
  returning id into v_invoice;

  if v_regime = 'assujetti' and jsonb_array_length(q.vat_breakdown) > 0 then
    insert into public.invoice_items (invoice_id, company_id, position, description, quantity, unit, unit_price, vat_rate)
    select v_invoice, q.company_id, row_number() over (order by (v ->> 'rate')::numeric),
           'Acompte sur devis ' || q.number || ' – part soumise à TVA ' || trim(to_char((v ->> 'rate')::numeric, 'FM990.##')) || ' %',
           1, 'forfait', round((v ->> 'base')::numeric * v_ratio, 2), (v ->> 'rate')::numeric
    from jsonb_array_elements(q.vat_breakdown) v;
  else
    insert into public.invoice_items (invoice_id, company_id, position, description, quantity, unit, unit_price, vat_rate)
    values (v_invoice, q.company_id, 1, 'Acompte sur devis ' || q.number, 1, 'forfait', round(q.total_ht * v_ratio, 2), 0);
  end if;

  update public.invoices set status = 'issued', due_date = current_date where id = v_invoice;
  update public.invoices set amount_paid = greatest(p_amount_paid, total_ttc) where id = v_invoice;  -- → payée
  update public.quotes set deposit_paid_at = now(), stripe_checkout_session_id = p_reference where id = q.id;
  return v_invoice;
end $$;
revoke execute on function public.create_deposit_invoice from anon, authenticated, public;

-- Accès serveur (Edge Function deposit-checkout) à la disponibilité de l'acompte en ligne
create or replace function public.online_deposit_available_public(p_company_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.online_deposit_available(p_company_id);
$$;
revoke execute on function public.online_deposit_available_public from anon, authenticated, public;
