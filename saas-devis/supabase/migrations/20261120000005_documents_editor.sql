-- =====================================================================
-- 05 · Éditeur de devis / factures
-- =====================================================================

-- Remplace atomiquement les lignes d'un devis ou d'une facture.
-- SECURITY INVOKER : RLS et verrous (devis signé, facture émise) s'appliquent.
create or replace function public.save_document_items(p_doc_type text, p_doc_id uuid, p_items jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_company uuid;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 300 then
    raise exception 'Lignes invalides.';
  end if;

  if p_doc_type = 'quote' then
    select company_id into v_company from public.quotes where id = p_doc_id;
    if v_company is null then raise exception 'Devis introuvable.'; end if;

    delete from public.quote_items where quote_id = p_doc_id;
    insert into public.quote_items (quote_id, company_id, product_id, position, kind, description,
                                    quantity, unit, unit_price, vat_rate, discount_percent)
    select p_doc_id, v_company, nullif(i ->> 'product_id', '')::uuid, ord::int,
           coalesce(i ->> 'kind', 'item'), left(coalesce(i ->> 'description', ''), 4000),
           coalesce((i ->> 'quantity')::numeric, 1), coalesce(nullif(i ->> 'unit', ''), 'unité'),
           coalesce((i ->> 'unit_price')::numeric, 0), coalesce((i ->> 'vat_rate')::numeric, 0),
           coalesce((i ->> 'discount_percent')::numeric, 0)
    from jsonb_array_elements(p_items) with ordinality as t(i, ord);

  elsif p_doc_type = 'invoice' then
    select company_id into v_company from public.invoices where id = p_doc_id;
    if v_company is null then raise exception 'Facture introuvable.'; end if;

    delete from public.invoice_items where invoice_id = p_doc_id;
    insert into public.invoice_items (invoice_id, company_id, product_id, position, kind, description,
                                      quantity, unit, unit_price, vat_rate, discount_percent)
    select p_doc_id, v_company, nullif(i ->> 'product_id', '')::uuid, ord::int,
           coalesce(i ->> 'kind', 'item'), left(coalesce(i ->> 'description', ''), 4000),
           coalesce((i ->> 'quantity')::numeric, 1), coalesce(nullif(i ->> 'unit', ''), 'unité'),
           coalesce((i ->> 'unit_price')::numeric, 0), coalesce((i ->> 'vat_rate')::numeric, 0),
           coalesce((i ->> 'discount_percent')::numeric, 0)
    from jsonb_array_elements(p_items) with ordinality as t(i, ord);
  else
    raise exception 'Type de document inconnu.';
  end if;
end $$;

revoke execute on function public.save_document_items from anon, public;
grant execute on function public.save_document_items to authenticated;


-- Duplique un devis (nouveau brouillon, nouveau numéro, dates du jour)
create or replace function public.duplicate_quote(p_quote_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  q public.quotes;
  v_id uuid;
begin
  select * into q from public.quotes where id = p_quote_id;
  if not found then raise exception 'Devis introuvable.'; end if;

  insert into public.quotes (company_id, client_id, title, intro, notes, discount_percent, deposit_percent)
  values (q.company_id, q.client_id, q.title, q.intro, q.notes, q.discount_percent, q.deposit_percent)
  returning id into v_id;

  insert into public.quote_items (quote_id, company_id, product_id, position, kind, description,
                                  quantity, unit, unit_price, vat_rate, discount_percent)
  select v_id, company_id, product_id, position, kind, description, quantity, unit, unit_price, vat_rate, discount_percent
  from public.quote_items where quote_id = q.id;

  return v_id;
end $$;

revoke execute on function public.duplicate_quote from anon, public;
grant execute on function public.duplicate_quote to authenticated;

-- Facture consultable par le client via son lien
create or replace function public.get_public_invoice(p_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'invoice', to_jsonb(i) - 'created_by' - 'reminder_count' - 'last_reminder_at',
    'items', coalesce((select jsonb_agg(to_jsonb(it) - 'company_id' order by it.position)
                       from public.invoice_items it where it.invoice_id = i.id), '[]'),
    'client', coalesce(i.client_snapshot, private.client_snapshot(i.client_id)),
    'company', (select to_jsonb(c) - 'widget_public_key' - 'created_by' - 'quote_reminders_enabled'
                       - 'quote_reminder_days' - 'invoice_reminders_enabled' - 'review_requests_enabled'
                from public.companies c where c.id = i.company_id),
    'quote_number', (select q.number from public.quotes q where q.id = i.quote_id)
  )
  from public.invoices i
  where i.public_token = p_token and i.status <> 'draft';
$$;
grant execute on function public.get_public_invoice to anon, authenticated;

-- Le devis passe « expiré » automatiquement (appelé par le cron quotidien des relances)
create or replace function public.expire_quotes()
returns integer language sql security definer set search_path = '' as $$
  with u as (
    update public.quotes set status = 'expired'
    where status = 'sent' and valid_until < current_date
    returning 1
  ) select count(*)::int from u;
$$;
revoke execute on function public.expire_quotes from anon, authenticated, public;

-- Les fonctions créées après la migration 01 héritent du droit EXECUTE pour PUBLIC :
-- on referme (le schéma private n'est de toute façon pas exposé par l'API).
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- Motif saisi quand le dirigeant marque lui-même un devis refusé
grant update (refusal_reason) on public.quotes to authenticated;

-- Utilitaires réservés aux Edge Functions (rôle service)
create or replace function public.is_subscription_active(p_company_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_active_subscription(p_company_id);
$$;

create or replace function public.increment_email_usage(p_company_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.usage_counters (company_id, period, emails_sent)
  values (p_company_id, date_trunc('month', now())::date, 1)
  on conflict (company_id, period) do update set emails_sent = public.usage_counters.emails_sent + 1;
$$;

revoke execute on function public.is_subscription_active, public.increment_email_usage from anon, authenticated, public;
