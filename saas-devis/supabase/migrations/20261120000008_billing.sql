-- =====================================================================
-- 08 · Abonnements : 4 offres, fonctionnalités par offre, Stripe
-- =====================================================================

alter table public.plans
  add column features text[] not null default '{}',
  add column description text,
  add column highlighted boolean not null default false;

-- Fonctionnalités : online_signature, auto_reminders, online_deposit, appointments, review_requests
update public.plans set price_cents = 7000, max_users = 1, ai_messages_per_month = 200, online_signature = false,
  features = '{}', description = 'L’essentiel pour un indépendant', sort_order = 1
  where id = 'starter';
update public.plans set price_cents = 9900, max_users = 3, ai_messages_per_month = 1000, online_signature = true,
  features = '{online_signature,auto_reminders}', description = 'Pour les petites équipes', highlighted = true, sort_order = 2
  where id = 'pro';
insert into public.plans (id, name, price_cents, max_users, ai_messages_per_month, online_signature, features, description, sort_order) values
  ('business', 'Business', 11900, 5, 2000, true, '{online_signature,auto_reminders,online_deposit}',
   'Encaissez vos acomptes en ligne', 3),
  ('premium', 'Premium', 14900, 10, 5000, true, '{online_signature,auto_reminders,online_deposit,appointments,review_requests}',
   'Tout inclus : agenda et avis Google', 4);

-- L'essai de 14 jours se fait sur l'offre la plus complète
alter table public.subscriptions alter column plan_id set default 'premium';
update public.subscriptions set plan_id = 'premium' where status = 'trialing';

-- La signature en ligne suit désormais la liste des fonctionnalités
create or replace function private.plan_has_feature(p_company_id uuid, p_feature text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subscriptions s join public.plans p on p.id = s.plan_id
    where s.company_id = p_company_id and private.has_active_subscription(p_company_id)
      and p_feature = any (p.features)
  );
$$;
grant execute on function private.plan_has_feature(uuid, text) to authenticated;

create or replace function public.company_has_feature(p_company_id uuid, p_feature text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (private.is_member(p_company_id) or auth.uid() is null) and private.plan_has_feature(p_company_id, p_feature);
$$;
grant execute on function public.company_has_feature to authenticated;

-- Usage courant : on ajoute les fonctionnalités et le prix
create or replace function public.current_usage(p_company_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not private.is_member(p_company_id) and not private.is_platform_admin() then null else
    jsonb_build_object(
      'plan', p.id, 'plan_name', p.name, 'price_cents', p.price_cents, 'status', s.status,
      'trial_ends_at', s.trial_ends_at, 'current_period_end', s.current_period_end,
      'cancel_at_period_end', s.cancel_at_period_end, 'has_stripe', s.stripe_customer_id is not null,
      'active', private.has_active_subscription(p_company_id),
      'ai_used', coalesce(u.ai_messages + u.ai_quote_generations, 0),
      'ai_limit', p.ai_messages_per_month,
      'users', (select count(*) from public.company_members where company_id = p_company_id),
      'max_users', p.max_users,
      'features', to_jsonb(p.features),
      'online_signature', 'online_signature' = any (p.features))
  end
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  left join public.usage_counters u on u.company_id = s.company_id
                                   and u.period = date_trunc('month', now())::date
  where s.company_id = p_company_id;
$$;

-- Page publique du devis / signature : fonctionnalité de l'offre
create or replace function private.online_signature_allowed(p_company_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.plan_has_feature(p_company_id, 'online_signature');
$$;

do $$
declare
  v_src text;
begin
  -- get_public_quote / sign_quote : remplace l'ancien test (offre ou essai) par la fonctionnalité
  select pg_get_functiondef('public.get_public_quote(uuid)'::regprocedure) into v_src;
  v_src := replace(v_src,
    $q$exists (
      select 1 from public.subscriptions s join public.plans p on p.id = s.plan_id
      where s.company_id = q.company_id and (p.online_signature or s.status = 'trialing'))$q$,
    'private.online_signature_allowed(q.company_id)');
  execute v_src;

  select pg_get_functiondef('public.sign_quote(uuid, text, text)'::regprocedure) into v_src;
  v_src := replace(v_src,
    $q$select exists (select 1 from public.subscriptions s join public.plans p on p.id = s.plan_id
                 where s.company_id = q.company_id and (p.online_signature or s.status = 'trialing'))
    into v_allowed;$q$,
    'select private.online_signature_allowed(q.company_id) into v_allowed;');
  execute v_src;
end $$;

-- Abonnement inactif (essai terminé, impayé) : consultation possible, plus de nouveaux documents
drop policy quotes_insert on public.quotes;
create policy quotes_insert on public.quotes for insert to authenticated
  with check (private.is_member(company_id) and private.has_active_subscription(company_id));
drop policy invoices_insert on public.invoices;
create policy invoices_insert on public.invoices for insert to authenticated
  with check (private.is_member(company_id) and private.has_active_subscription(company_id));

-- Webhooks Stripe déjà traités (idempotence)
create table public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security; -- aucune policy : service uniquement
revoke all on public.stripe_events from anon, authenticated;
