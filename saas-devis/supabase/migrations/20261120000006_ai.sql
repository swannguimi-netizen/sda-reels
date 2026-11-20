-- =====================================================================
-- 06 · IA : journal des générations (audit, suivi de l'usage, admin)
-- =====================================================================

create table public.ai_generations (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  user_id        uuid references auth.users (id) on delete set null,
  kind           text not null check (kind in ('quote', 'message')),
  prompt         text not null,
  result         jsonb,
  model          text,
  input_tokens   integer,
  output_tokens  integer,
  error          text,
  created_at     timestamptz not null default now()
);
create index ai_generations_company_idx on public.ai_generations (company_id, created_at desc);

alter table public.ai_generations enable row level security;
create policy ai_generations_select on public.ai_generations for select to authenticated
  using (private.is_member(company_id) or private.is_platform_admin());
revoke insert, update, delete, truncate on public.ai_generations from authenticated;
revoke all on public.ai_generations from anon;

-- Le devis garde la trace de son origine IA
grant update (ai_generated, lead_id) on public.quotes to authenticated;

-- consume_ai_message() est appelée par l'Edge Function (rôle service) uniquement
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.consume_ai_message(uuid, text) to service_role;
  end if;
end $$;
