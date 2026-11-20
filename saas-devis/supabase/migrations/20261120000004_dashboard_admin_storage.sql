-- =====================================================================
-- 04 · Tableau de bord, super-admin, stockage
-- =====================================================================

-- ---------------------------------------------------------------------
-- Statistiques du tableau de bord (RLS de l'appelant appliquées)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_stats(p_company_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with month as (select date_trunc('month', now()) as start),
  q as (
    select * from public.quotes where company_id = p_company_id
  )
  select jsonb_build_object(
    'quotes_this_month', (select count(*) from q, month where q.created_at >= month.start),
    'quotes_sent_this_month', (select count(*) from q, month where q.sent_at >= month.start),
    'signed_revenue_ht_this_month', (select coalesce(sum(total_ht), 0) from q, month
                                      where q.status = 'accepted' and q.accepted_at >= month.start),
    'pending_quotes_amount_ht', (select coalesce(sum(total_ht), 0) from q where q.status = 'sent'),
    'acceptance_rate', (
      select case when count(*) filter (where status in ('accepted', 'refused', 'expired')) = 0 then null
             else round(100.0 * count(*) filter (where status = 'accepted')
                        / count(*) filter (where status in ('accepted', 'refused', 'expired')), 1) end
      from q where q.sent_at >= now() - interval '90 days'),
    'unpaid_invoices_amount', (select coalesce(sum(total_ttc - amount_paid), 0) from public.invoices
                               where company_id = p_company_id and status = 'issued'),
    'overdue_invoices_count', (select count(*) from public.invoices
                               where company_id = p_company_id and status = 'issued' and due_date < current_date),
    'new_leads_this_month', (select count(*) from public.leads, month
                             where company_id = p_company_id and created_at >= month.start),
    'open_conversations', (select count(*) from public.conversations
                           where company_id = p_company_id and status = 'open'),
    'unread_conversations', (select count(*) from public.conversations
                             where company_id = p_company_id and unread),
    'monthly_revenue', (
      select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'amount', amt) order by m), '[]')
      from (
        select gs as m, coalesce((select sum(total_ht) from q
                                  where q.status = 'accepted'
                                    and date_trunc('month', q.accepted_at) = gs), 0) as amt
        from generate_series(date_trunc('month', now()) - interval '5 months',
                             date_trunc('month', now()), interval '1 month') gs
      ) t)
  );
$$;
grant execute on function public.dashboard_stats to authenticated;

-- Usage du mois en cours + limites de l'offre
create or replace function public.current_usage(p_company_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not private.is_member(p_company_id) and not private.is_platform_admin() then null else
    jsonb_build_object(
      'plan', p.id, 'plan_name', p.name, 'status', s.status,
      'trial_ends_at', s.trial_ends_at, 'current_period_end', s.current_period_end,
      'active', private.has_active_subscription(p_company_id),
      'ai_used', coalesce(u.ai_messages + u.ai_quote_generations, 0),
      'ai_limit', p.ai_messages_per_month,
      'users', (select count(*) from public.company_members where company_id = p_company_id),
      'max_users', p.max_users,
      'online_signature', p.online_signature or s.status = 'trialing')
  end
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  left join public.usage_counters u on u.company_id = s.company_id
                                   and u.period = date_trunc('month', now())::date
  where s.company_id = p_company_id;
$$;
grant execute on function public.current_usage to authenticated;

-- ---------------------------------------------------------------------
-- Super-admin (Swann) : vue d'ensemble de toutes les entreprises
-- ---------------------------------------------------------------------
create or replace function public.admin_companies_overview()
returns table (
  company_id uuid, name text, siret text, city text, created_at timestamptz,
  owner_email text, members integer, plan text, status public.subscription_status,
  trial_ends_at timestamptz, current_period_end timestamptz,
  ai_used_this_month integer, quotes_total bigint, quotes_this_month bigint,
  signed_revenue_ht numeric, conversations_this_month bigint
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Accès réservé à l''administrateur de la plateforme.' using errcode = '42501';
  end if;

  return query
  select c.id, c.name, c.siret, c.city, c.created_at,
         (select p.email from public.company_members m join public.profiles p on p.id = m.user_id
           where m.company_id = c.id and m.role = 'owner' order by m.created_at limit 1),
         (select count(*)::int from public.company_members m where m.company_id = c.id),
         s.plan_id, s.status, s.trial_ends_at, s.current_period_end,
         coalesce((select u.ai_messages + u.ai_quote_generations from public.usage_counters u
                   where u.company_id = c.id and u.period = date_trunc('month', now())::date), 0),
         (select count(*) from public.quotes q where q.company_id = c.id),
         (select count(*) from public.quotes q where q.company_id = c.id
            and q.created_at >= date_trunc('month', now())),
         (select coalesce(sum(q.total_ht), 0) from public.quotes q
           where q.company_id = c.id and q.status = 'accepted'),
         (select count(*) from public.conversations cv where cv.company_id = c.id
            and cv.created_at >= date_trunc('month', now()))
  from public.companies c
  left join public.subscriptions s on s.company_id = c.id
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
    'trialing', (select count(*) from public.subscriptions where status = 'trialing' and trial_ends_at > now()),
    'active', (select count(*) from public.subscriptions where status = 'active'),
    'past_due', (select count(*) from public.subscriptions where status = 'past_due'),
    'mrr_cents', (select coalesce(sum(p.price_cents), 0) from public.subscriptions s
                  join public.plans p on p.id = s.plan_id where s.status = 'active'),
    'ai_messages_this_month', (select coalesce(sum(ai_messages + ai_quote_generations), 0)
                               from public.usage_counters where period = date_trunc('month', now())::date)
  );
end $$;
revoke execute on function public.admin_platform_stats from anon, public;
grant execute on function public.admin_platform_stats to authenticated;

-- ---------------------------------------------------------------------
-- Stockage : chemins de la forme <company_id>/<fichier>
--   logos     : public (affiché dans les PDF, le widget, la page de signature)
--   documents : privé (PDF des devis / factures)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('logos', 'logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  ('documents', 'documents', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy "logos_read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'logos');
create policy "logos_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'logos'
              and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,admin}'));
create policy "logos_update" on storage.objects for update to authenticated
  using (bucket_id = 'logos'
         and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,admin}'));
create policy "logos_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'logos'
         and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,admin}'));

create policy "documents_read" on storage.objects for select to authenticated
  using (bucket_id = 'documents'
         and private.is_member(((storage.foldername(name))[1])::uuid));
create policy "documents_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents'
              and private.is_member(((storage.foldername(name))[1])::uuid));
create policy "documents_update" on storage.objects for update to authenticated
  using (bucket_id = 'documents'
         and private.is_member(((storage.foldername(name))[1])::uuid));
create policy "documents_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'documents'
         and private.is_member(((storage.foldername(name))[1])::uuid));
