-- =====================================================================
-- 07 · Assistant IA : demandes de devis, suivi des prospects
-- =====================================================================

alter table public.leads
  add column details text,
  add column urgency text check (urgency in ('normale', 'rapide', 'urgente')),
  add column page_url text;

-- Un seul prospect par conversation
create unique index leads_conversation_once on public.leads (conversation_id) where conversation_id is not null;

-- Cycle de vie du prospect, piloté par les devis
create or replace function private.quote_lead_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is null then return null; end if;
  if tg_op = 'INSERT' or new.lead_id is distinct from old.lead_id then
    update public.leads set status = 'quoted', client_id = coalesce(client_id, new.client_id)
     where id = new.lead_id and status in ('new', 'contacted');
  end if;
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status <> 'accepted') then
    update public.leads set status = 'won' where id = new.lead_id;
  elsif new.status = 'refused' and (tg_op = 'INSERT' or old.status <> 'refused') then
    update public.leads set status = 'lost' where id = new.lead_id and status <> 'won';
  end if;
  return null;
end $$;

create trigger quotes_lead_status after insert or update of status, lead_id on public.quotes
  for each row execute function private.quote_lead_status();

-- Convertit un prospect en client (ou retrouve le client par email) et renvoie son id
create or replace function public.convert_lead_to_client(p_lead_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  l public.leads;
  v_client uuid;
begin
  select * into l from public.leads where id = p_lead_id;
  if not found then raise exception 'Prospect introuvable.'; end if;
  if l.client_id is not null then return l.client_id; end if;

  if l.email is not null then
    select id into v_client from public.clients
     where company_id = l.company_id and lower(email) = lower(l.email) limit 1;
  end if;
  if v_client is null then
    insert into public.clients (company_id, name, email, phone, source, notes)
    values (l.company_id, coalesce(nullif(trim(l.name), ''), l.email, l.phone, 'Prospect'), lower(l.email), l.phone, 'widget',
            nullif(concat_ws(E'\n', l.need, l.details), ''))
    returning id into v_client;
  end if;

  update public.leads set client_id = v_client, status = case when status = 'new' then 'contacted' else status end
   where id = l.id;
  return v_client;
end $$;
revoke execute on function public.convert_lead_to_client from anon, public;
grant execute on function public.convert_lead_to_client to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.leads;
  end if;
end $$;
