-- Durcissement signalé par l'analyse de sécurité Supabase.
-- 1. search_path figé sur les fonctions de trigger restantes
alter function private.set_updated_at() set search_path = '';
alter function private.timezone_for_postal(text) set search_path = '';
alter function private.companies_reminder_settings() set search_path = '';

-- 2. Fonctions réservées aux utilisateurs connectés (et aux Edge Functions via service_role) :
--    les visiteurs anonymes ne doivent pas pouvoir interroger l'offre d'une entreprise.
revoke execute on function public.company_has_feature(uuid, text) from public, anon;
revoke execute on function public.current_usage(uuid) from public, anon;
grant execute on function public.company_has_feature(uuid, text) to authenticated;
grant execute on function public.current_usage(uuid) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.company_has_feature(uuid, text) to service_role;
  end if;
end $$;
