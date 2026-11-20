-- =====================================================================
-- 09 · Super-admin : vue enrichie, statistiques plateforme, actions
-- =====================================================================

drop function public.admin_companies_overview();
create function public.admin_companies_overview()
returns table (
  company_id uuid, name text, siret text, city text, postal_code text, created_at timestamptz,
  owner_email text, members integer, plan text, plan_price_cents integer, status public.subscription_status,
  trial_ends_at timestamptz, current_period_end timestamptz, cancel_at_period_end boolean, has_stripe boolean,
  ai_used_this_month integer, ai_limit integer, quotes_total bigint, quotes_this_month bigint,
  signed_revenue_ht numeric, conversations_this_month bigint, leads_total bigint,
  widget_active boolean, last_activity_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Accès réservé à l''administrateur de la plateforme.' using errcode = '42501';
  end if;

  return query
  select c.id, c.name, c.siret, c.city, c.postal_code, c.created_at,
         (select p.email from public.company_members m join public.profiles p on p.id = m.user_id
           where m.company_id = c.id and m.role = 'owner' order by m.created_at limit 1),
         (select count(*)::int from public.company_members m where m.company_id = c.id),
         s.plan_id, pl.price_cents, s.status, s.trial_ends_at, s.current_period_end, s.cancel_at_period_end,
         s.stripe_subscription_id is not null,
         coalesce((select u.ai_messages + u.ai_quote_generations from public.usage_counters u
                   where u.company_id = c.id and u.period = date_trunc('month', now())::date), 0),
         pl.ai_messages_per_month,
         (select count(*) from public.quotes q where q.company_id = c.id),
         (select count(*) from public.quotes q where q.company_id = c.id and q.created_at >= date_trunc('month', now())),
         (select coalesce(sum(q.total_ht), 0) from public.quotes q where q.company_id = c.id and q.status = 'accepted'),
         (select count(*) from public.conversations cv where cv.company_id = c.id and cv.created_at >= date_trunc('month', now())),
         (select count(*) from public.leads l where l.company_id = c.id),
         exists (select 1 from public.conversations cv where cv.company_id = c.id
                  and cv.page_url is not null and cv.page_url not like '%/assistant%'),
         greatest(
           (select max(q.updated_at) from public.quotes q where q.company_id = c.id),
           (select max(cv.last_message_at) from public.conversations cv where cv.company_id = c.id),
           c.updated_at)
  from public.companies c
  left join public.subscriptions s on s.company_id = c.id
  left join public.plans pl on pl.id = s.plan_id
  order by c.created_at desc;
end $$;
revoke execute on function public.admin_companies_overview from anon, public;
grant execute on function public.admin_companies_overview to authenticated;

create or replace function public.admin_platform_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Accès réservé à l''administrateur de la plateforme.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'companies', (select count(*) from public.companies),
    'signups_this_month', (select count(*) from public.companies where created_at >= date_trunc('month', now())),
    'trialing', (select count(*) from public.subscriptions where status = 'trialing' and trial_ends_at > now() and stripe_subscription_id is null),
    'trials_ending_7d', (select count(*) from public.subscriptions where status = 'trialing' and stripe_subscription_id is null
                          and trial_ends_at between now() and now() + interval '7 days'),
    'active', (select count(*) from public.subscriptions where status = 'active'
                 or (status = 'trialing' and stripe_subscription_id is not null)),
    'past_due', (select count(*) from public.subscriptions where status in ('past_due', 'unpaid')),
    'canceled', (select count(*) from public.subscriptions where status = 'canceled'
                   or (status = 'trialing' and trial_ends_at <= now() and stripe_subscription_id is null)),
    'mrr_cents', (select coalesce(sum(p.price_cents), 0) from public.subscriptions s
                  join public.plans p on p.id = s.plan_id where s.status in ('active', 'past_due')),
    'mrr_by_plan', (select coalesce(jsonb_object_agg(plan_id, cents), '{}') from (
                      select s.plan_id, sum(p.price_cents) as cents from public.subscriptions s
                      join public.plans p on p.id = s.plan_id where s.status in ('active', 'past_due') group by s.plan_id) t),
    'ai_messages_this_month', (select coalesce(sum(ai_messages + ai_quote_generations), 0)
                               from public.usage_counters where period = date_trunc('month', now())::date),
    'ai_tokens_this_month', (select jsonb_build_object(
                               'input', coalesce(sum(coalesce(input_tokens, 0)), 0), 'output', coalesce(sum(coalesce(output_tokens, 0)), 0))
                             from (select input_tokens, output_tokens from public.messages where created_at >= date_trunc('month', now())
                                   union all
                                   select input_tokens, output_tokens from public.ai_generations where created_at >= date_trunc('month', now())) t),
    'quotes_this_month', (select count(*) from public.quotes where created_at >= date_trunc('month', now())),
    'signups_by_month', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'count', n) order by m), '[]') from (
                           select gs as m, (select count(*) from public.companies where date_trunc('month', created_at) = gs) as n
                           from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') gs) t)
  );
end $$;

-- Geste commercial : prolonger l'essai d'une entreprise
create or replace function public.admin_extend_trial(p_company_id uuid, p_days integer)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_end timestamptz;
begin
  if not private.is_platform_admin() then
    raise exception 'Accès réservé à l''administrateur de la plateforme.' using errcode = '42501';
  end if;
  if p_days not between 1 and 90 then raise exception 'Durée invalide (1 à 90 jours).'; end if;
  update public.subscriptions
     set status = 'trialing', trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => p_days)
   where company_id = p_company_id and stripe_subscription_id is null
  returning trial_ends_at into v_end;
  if v_end is null then raise exception 'Entreprise introuvable ou déjà abonnée via Stripe.'; end if;
  return v_end;
end $$;
revoke execute on function public.admin_extend_trial from anon, public;
grant execute on function public.admin_extend_trial to authenticated;
