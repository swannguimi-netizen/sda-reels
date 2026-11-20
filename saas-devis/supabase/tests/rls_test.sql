-- Tests d'isolation multi-tenant et de logique métier.
-- Chaque assertion lève une exception en cas d'échec (ON_ERROR_STOP).
\set QUIET on
set client_min_messages = warning;

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ÉCHEC : %', msg; end if;
  raise notice '  ✓ %', msg;
end $$;

-- Exécute une requête et vérifie qu'elle échoue
create function pg_temp.fails(q text, msg text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    raise notice '  ✓ % (refusé : %)', msg, sqlerrm;
    return;
  end;
  raise exception 'ÉCHEC : % — la requête aurait dû être refusée', msg;
end $$;

create function pg_temp.login(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', (select id::text from auth.users where email = p_email), false);
  execute 'set role authenticated';
end $$;

create function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
end $$;

set client_min_messages = notice;

-- ---------------------------------------------------------------------
\echo '1. Inscription et création d''entreprise'
insert into auth.users (email, raw_user_meta_data) values
  ('alice@exemple.fr', '{"full_name":"Alice Martin"}'),
  ('bob@exemple.gf',   '{"full_name":"Bob Ho-A-Chuck"}'),
  ('swann@admin.fr',   '{}');
select pg_temp.ok((select count(*) = 3 from public.profiles), 'un profil est créé pour chaque inscrit');
update public.profiles set is_platform_admin = true where email = 'swann@admin.fr';

select pg_temp.login('alice@exemple.fr');
select pg_temp.ok((select name = 'Plomberie Martin' from public.create_company('Plomberie Martin', 'assujetti', '123 456 789 00012')),
  'Alice crée son entreprise');
select pg_temp.ok((select role = 'owner' from public.company_members), 'Alice est propriétaire');
select pg_temp.ok((select status = 'trialing' and plan_id = 'premium' and trial_ends_at > now() + interval '13 days'
                   from public.subscriptions), 'essai Premium de 14 jours démarré');
select pg_temp.ok((select current_company_id is not null from public.profiles where email = 'alice@exemple.fr'),
  'entreprise courante définie');
select pg_temp.ok((select count(*) = 10 from public.availability_rules), 'créneaux par défaut créés');
select pg_temp.fails($$update public.profiles set is_platform_admin = true where email = 'alice@exemple.fr'$$,
  'Alice ne peut pas se promouvoir admin');
select pg_temp.fails($$insert into public.companies (name) values ('Pirate')$$,
  'création directe d''entreprise interdite (passer par create_company)');
select pg_temp.fails($$update public.companies set widget_public_key = gen_random_uuid()$$,
  'clé publique du widget non modifiable');
select pg_temp.fails($$update public.subscriptions set plan_id = 'pro', status = 'active'$$,
  'abonnement non modifiable depuis l''app');
select pg_temp.logout();

select pg_temp.login('bob@exemple.gf');
do $$ begin perform public.create_company('Bob Électricité', 'non_applicable_dom'); end $$;
select pg_temp.logout();

-- ---------------------------------------------------------------------
\echo '2. Catalogue, client, devis et calcul des totaux'
select pg_temp.login('alice@exemple.fr');
insert into public.products (company_id, name, unit, unit_price, vat_rate)
select id, 'Remplacement chauffe-eau 200 L', 'forfait', 1200, 10 from public.companies;
insert into public.products (company_id, name, unit, unit_price, vat_rate)
select id, 'Main d''œuvre', 'heure', 55, 20 from public.companies;
insert into public.clients (company_id, name, email, city)
select id, 'Mme Dupont', 'dupont@client.fr', 'Cayenne' from public.companies;

insert into public.quotes (company_id, client_id, title, discount_percent, total_ttc)
select c.id, cl.id, 'Remplacement chauffe-eau', 10, 999999 from public.companies c, public.clients cl;
select pg_temp.ok((select number = 'DEV-' || extract(year from now()) || '-001' from public.quotes),
  'numérotation automatique DEV-AAAA-001');
select pg_temp.ok((select total_ttc = 0 and deposit_percent = 30 and valid_until = issue_date + 30 from public.quotes),
  'totaux forcés à 0, acompte et validité par défaut');

insert into public.quote_items (quote_id, company_id, product_id, position, description, quantity, unit, unit_price, vat_rate)
select q.id, q.company_id, p.id, row_number() over (), p.name,
       case p.unit when 'heure' then 3 else 1 end, p.unit, p.unit_price, p.vat_rate
from public.quotes q, public.products p;
-- Sous-total : 1200 + 165 = 1365 ; remise 10 % = 136.50 ; HT = 1228.50
-- TVA 10 % sur 1080 = 108 ; TVA 20 % sur 148.50 = 29.70 ; TTC = 1366.20 ; acompte 30 % = 409.86
select pg_temp.ok((select subtotal_ht = 1365 and discount_amount = 136.50 and total_ht = 1228.50
                     and total_vat = 137.70 and total_ttc = 1366.20 and deposit_amount = 409.86
                   from public.quotes), 'HT / remise / TVA multi-taux / TTC / acompte corrects');
select pg_temp.ok((select jsonb_array_length(vat_breakdown) = 2 from public.quotes), 'ventilation TVA par taux');

update public.quotes set discount_percent = 0;
select pg_temp.ok((select total_ttc = 1365 + 120 + 33 from public.quotes), 'recalcul quand la remise globale change');

insert into public.quotes (company_id, title) select id, 'Second devis' from public.companies;
select pg_temp.ok((select count(*) = 1 from public.quotes where number like '%-002'), 'numéro suivant DEV-AAAA-002');
select pg_temp.logout();

-- ---------------------------------------------------------------------
\echo '3. Isolation entre entreprises'
select pg_temp.login('bob@exemple.gf');
select pg_temp.ok((select count(*) = 1 from public.companies), 'Bob ne voit que son entreprise');
select pg_temp.ok((select count(*) = 0 from public.quotes), 'Bob ne voit pas les devis d''Alice');
select pg_temp.ok((select count(*) = 0 from public.clients), 'Bob ne voit pas les clients d''Alice');
select pg_temp.ok((select count(*) = 0 from public.products), 'Bob ne voit pas le catalogue d''Alice');
select pg_temp.ok((select count(*) = 1 from public.profiles), 'Bob ne voit pas le profil d''Alice');

select pg_temp.logout();

do $$ begin perform set_config('test.alice_company', (select id::text from public.companies where name = 'Plomberie Martin'), false); end $$;
do $$ begin perform set_config('test.alice_client',  (select id::text from public.clients where name = 'Mme Dupont'), false); end $$;
do $$ begin perform set_config('test.alice_quote',   (select id::text from public.quotes where number like '%-001'), false); end $$;

select pg_temp.login('bob@exemple.gf');
select pg_temp.fails(format($q$insert into public.clients (company_id, name) values (%L, 'intrus')$q$,
  current_setting('test.alice_company')), 'Bob ne peut pas créer de client chez Alice');
select pg_temp.fails(format($q$insert into public.quotes (company_id, client_id)
  select id, %L from public.companies$q$, current_setting('test.alice_client')),
  'Bob ne peut pas rattacher un client d''Alice à son devis');
select pg_temp.fails(format($q$insert into public.quote_items (quote_id, company_id, description)
  select %L, id, 'x' from public.companies$q$, current_setting('test.alice_quote')),
  'Bob ne peut pas ajouter de ligne au devis d''Alice');
update public.quotes set title = 'piraté' where id = current_setting('test.alice_quote')::uuid;
select pg_temp.ok(true, 'mise à jour du devis d''Alice sans effet (0 ligne visible)');
select pg_temp.fails($$select public.convert_quote_to_invoice(current_setting('test.alice_quote')::uuid)$$,
  'Bob ne peut pas convertir le devis d''Alice');
select pg_temp.fails($$select * from public.admin_companies_overview()$$, 'Bob n''accède pas à l''espace admin');

-- DOM : TVA non applicable
insert into public.quotes (company_id, title) select id, 'Tableau électrique' from public.companies;
insert into public.quote_items (quote_id, company_id, description, quantity, unit_price, vat_rate)
select id, company_id, 'Mise aux normes', 2, 450, 20 from public.quotes;
select pg_temp.ok((select total_ht = 900 and total_vat = 0 and total_ttc = 900 from public.quotes),
  'Guyane (art. 294-1 CGI) : TVA à 0');
select pg_temp.ok((select number like 'DEV-%-001' from public.quotes), 'numérotation indépendante par entreprise');
select pg_temp.logout();
select pg_temp.ok((select title <> 'piraté' from public.quotes where id = current_setting('test.alice_quote')::uuid),
  'le devis d''Alice est intact');

-- ---------------------------------------------------------------------
\echo '4. Envoi, consultation et signature publique'
set role anon;
select pg_temp.fails($$select * from public.quotes$$, 'anonyme : aucune lecture directe des devis');
select pg_temp.ok((select public.get_public_quote((select gen_random_uuid())) is null), 'jeton inconnu → rien');
reset role;
do $$ begin perform set_config('test.token', (select public_token::text from public.quotes where id = current_setting('test.alice_quote')::uuid), false); end $$;
set role anon;
select pg_temp.ok((select public.get_public_quote(current_setting('test.token')::uuid) is null),
  'un brouillon n''est pas consultable publiquement');
reset role;

select pg_temp.login('alice@exemple.fr');
update public.quotes set status = 'sent' where id = current_setting('test.alice_quote')::uuid;
select pg_temp.ok((select sent_at is not null and client_snapshot ->> 'name' = 'Mme Dupont' from public.quotes
                   where id = current_setting('test.alice_quote')::uuid), 'envoi : date et coordonnées figées');
select pg_temp.logout();

set role anon;
select pg_temp.ok((select (public.get_public_quote(current_setting('test.token')::uuid) -> 'company' ->> 'name') = 'Plomberie Martin'
                     and public.get_public_quote(current_setting('test.token')::uuid) -> 'company' -> 'widget_public_key' is null),
  'page publique : entreprise visible, clé widget masquée');
select pg_temp.fails($$select public.sign_quote(current_setting('test.token')::uuid, 'Mme Dupont', 'pas une image')$$,
  'signature invalide refusée');
select pg_temp.ok((select public.sign_quote(current_setting('test.token')::uuid, 'Mme Dupont',
                     'data:image/png;base64,iVBORw0KGgo=') ->> 'status' = 'accepted'), 'le client signe le devis');
select pg_temp.fails($$select public.sign_quote(current_setting('test.token')::uuid, 'Mme Dupont', 'data:image/png;base64,AA')$$,
  'double signature refusée');
reset role;
select pg_temp.ok((select viewed_at is not null and accepted_at is not null from public.quotes
                   where id = current_setting('test.alice_quote')::uuid), 'consultation et acceptation horodatées');

select pg_temp.login('alice@exemple.fr');
select pg_temp.fails($$update public.quote_items set unit_price = 1 where quote_id = current_setting('test.alice_quote')::uuid$$,
  'lignes d''un devis signé verrouillées');
select pg_temp.fails($$update public.quotes set total_ttc = 1 where id = current_setting('test.alice_quote')::uuid$$,
  'totaux non modifiables directement');

-- ---------------------------------------------------------------------
\echo '5. Conversion en facture'
do $$ begin perform set_config('test.invoice', public.convert_quote_to_invoice(current_setting('test.alice_quote')::uuid)::text, false); end $$;
select pg_temp.ok((select status = 'draft' and number is null and total_ttc = 1518 from public.invoices),
  'facture brouillon créée avec les mêmes montants');
select pg_temp.fails($$update public.invoices set status = 'paid'$$, 'un brouillon ne peut pas être payé');
update public.invoices set status = 'issued';
select pg_temp.ok((select number = 'FAC-' || extract(year from now()) || '-001' and due_date = issue_date + 30
                   from public.invoices), 'émission : numéro FAC-AAAA-001 et échéance');
select pg_temp.fails($$update public.invoice_items set quantity = 99$$, 'facture émise : lignes figées');
select pg_temp.fails($$update public.invoices set discount_percent = 50$$, 'facture émise : montants figés');
delete from public.invoices;
select pg_temp.ok((select count(*) = 1 from public.invoices), 'facture émise non supprimable');
update public.invoices set amount_paid = 1518;
select pg_temp.ok((select status = 'paid' and paid_at is not null from public.invoices), 'paiement complet → statut payée');
select pg_temp.logout();

-- ---------------------------------------------------------------------
\echo '6. Assistant : conversations, reprise en main, quotas'
-- Le widget passe par une Edge Function (service role, sans auth.uid())
insert into public.conversations (company_id, visitor_id, contact_name)
values (current_setting('test.alice_company')::uuid, 'visiteur-1', 'Jean');
insert into public.messages (conversation_id, company_id, role, content)
select id, company_id, 'visitor', 'Bonjour, vous intervenez à Kourou ?' from public.conversations;
insert into public.messages (conversation_id, company_id, role, content)
select id, company_id, 'assistant', 'Oui, nous intervenons à Kourou.' from public.conversations;

select pg_temp.login('bob@exemple.gf');
select pg_temp.ok((select count(*) = 0 from public.conversations), 'Bob ne voit pas les conversations d''Alice');
select pg_temp.ok((select count(*) = 0 from public.messages), 'Bob ne voit pas les messages d''Alice');
select pg_temp.logout();

select pg_temp.login('alice@exemple.fr');
select pg_temp.ok((select count(*) = 2 and bool_and(true) from public.messages), 'Alice voit l''historique');
select pg_temp.fails($$insert into public.messages (conversation_id, company_id, role, content)
  select id, company_id, 'assistant', 'faux message IA' from public.conversations$$,
  'Alice ne peut pas usurper un message de l''IA');
insert into public.messages (conversation_id, company_id, role, content)
select id, company_id, 'agent', 'Je vous rappelle dans l''heure.' from public.conversations;
select pg_temp.ok((select mode = 'human' and not unread from public.conversations),
  'réponse manuelle → reprise en main, conversation lue');
select pg_temp.ok((select author_id is not null from public.messages where role = 'agent'), 'auteur de la réponse enregistré');
select pg_temp.fails($$select public.consume_ai_message(current_setting('test.alice_company')::uuid)$$,
  'quota IA non consommable depuis le navigateur');
select pg_temp.logout();

-- Quota (service role) : essai Premium = 5 000 messages
select pg_temp.ok(public.consume_ai_message(current_setting('test.alice_company')::uuid), 'message IA décompté');
update public.usage_counters set ai_messages = 5000;
select pg_temp.ok(not public.consume_ai_message(current_setting('test.alice_company')::uuid), 'quota atteint → refus');
update public.subscriptions set trial_ends_at = now() - interval '1 day', plan_id = 'starter'
  where company_id = current_setting('test.alice_company')::uuid;
update public.usage_counters set ai_messages = 0;
select pg_temp.ok(not public.consume_ai_message(current_setting('test.alice_company')::uuid), 'essai expiré → IA coupée');
update public.subscriptions set status = 'active' where company_id = current_setting('test.alice_company')::uuid;

-- ---------------------------------------------------------------------
\echo '7. Limite d''utilisateurs (Starter = 1)'
insert into auth.users (email) values ('collegue@exemple.fr');
select pg_temp.login('alice@exemple.fr');
select pg_temp.fails(format($q$insert into public.company_members (company_id, user_id)
  values (%L, (select id from public.profiles where false))$q$, current_setting('test.alice_company')),
  'pas d''ajout direct de membre');
select pg_temp.logout();
select pg_temp.fails(format($q$insert into public.company_members (company_id, user_id)
  select %L, id from auth.users where email = 'collegue@exemple.fr'$q$, current_setting('test.alice_company')),
  'offre Starter : 2e utilisateur refusé');
select pg_temp.fails(format($q$delete from public.company_members where company_id = %L$q$, current_setting('test.alice_company')),
  'le dernier propriétaire ne peut pas partir');

-- ---------------------------------------------------------------------
\echo '8. Tableau de bord, usage et super-admin'
select pg_temp.login('alice@exemple.fr');
select pg_temp.ok((select (s ->> 'signed_revenue_ht_this_month')::numeric = 1365
                     and (s ->> 'acceptance_rate')::numeric = 100
                     and jsonb_array_length(s -> 'monthly_revenue') = 6
                   from public.dashboard_stats(current_setting('test.alice_company')::uuid) s),
  'statistiques : CA signé, taux d''acceptation, historique 6 mois');
select pg_temp.ok((select u ->> 'plan' = 'starter' and (u ->> 'ai_limit')::int = 200
                   from public.current_usage(current_setting('test.alice_company')::uuid) u), 'usage et limites de l''offre');
select pg_temp.logout();
select pg_temp.login('bob@exemple.gf');
select pg_temp.ok((select public.current_usage(current_setting('test.alice_company')::uuid) is null),
  'Bob ne voit pas l''usage d''Alice');
select pg_temp.ok((select (s ->> 'quotes_this_month')::int = 0 from public.dashboard_stats(current_setting('test.alice_company')::uuid) s),
  'statistiques d''Alice vides pour Bob');
select pg_temp.logout();
select pg_temp.login('swann@admin.fr');
select pg_temp.ok((select count(*) = 2 from public.admin_companies_overview()), 'admin : toutes les entreprises listées');
select pg_temp.ok((select (s ->> 'mrr_cents')::int = 7000 from public.admin_platform_stats() s), 'admin : MRR');
select pg_temp.logout();

-- ---------------------------------------------------------------------
\echo '9. Stockage'
select pg_temp.login('alice@exemple.fr');
insert into storage.objects (bucket_id, name) values ('documents', current_setting('test.alice_company') || '/DEV-001.pdf');
select pg_temp.logout();
select pg_temp.login('bob@exemple.gf');
select pg_temp.ok((select count(*) = 0 from storage.objects), 'Bob ne voit pas les PDF d''Alice');
select pg_temp.fails(format($q$insert into storage.objects (bucket_id, name) values ('logos', %L)$q$,
  current_setting('test.alice_company') || '/logo.png'), 'Bob ne peut pas remplacer le logo d''Alice');
select pg_temp.logout();

-- ---------------------------------------------------------------------
\echo '10. Demande d''avis après prestation'
update public.companies set review_requests_enabled = true, google_review_url = 'https://g.page/r/xxx/review'
  where id = current_setting('test.alice_company')::uuid;
select pg_temp.login('alice@exemple.fr');
update public.quotes set work_completed_at = now() where id = current_setting('test.alice_quote')::uuid;
select pg_temp.ok((select count(*) = 1 and bool_and(email = 'dupont@client.fr') from public.review_requests),
  'prestation terminée → demande d''avis planifiée');
select pg_temp.logout();

-- ---------------------------------------------------------------------
\echo '11. Rôles : un membre gère catalogue et clients, pas le profil'
update public.subscriptions set plan_id = 'pro' where company_id = current_setting('test.alice_company')::uuid;
insert into public.company_members (company_id, user_id, role)
select current_setting('test.alice_company')::uuid, id, 'member' from auth.users where email = 'collegue@exemple.fr';
select pg_temp.login('collegue@exemple.fr');
update public.companies set name = 'Renommée' where id = current_setting('test.alice_company')::uuid;
select pg_temp.ok((select name = 'Plomberie Martin' from public.companies), 'un membre ne modifie pas le profil');
insert into public.products (company_id, name, unit_price) values (current_setting('test.alice_company')::uuid, 'Déplacement', 35);
insert into public.clients (company_id, name) values (current_setting('test.alice_company')::uuid, 'M. Henry');
select pg_temp.ok((select count(*) = 3 from public.products), 'un membre ajoute au catalogue');
select pg_temp.ok((select count(*) = 2 from public.clients), 'un membre ajoute des clients');
select pg_temp.fails(format($q$insert into storage.objects (bucket_id, name) values ('logos', %L)$q$,
  current_setting('test.alice_company') || '/logo.png'), 'un membre ne change pas le logo');
update public.company_members set role = 'owner' where user_id = (select auth.uid());
select pg_temp.logout();
select pg_temp.ok((select role = 'member' from public.company_members m join auth.users u on u.id = m.user_id
                   where u.email = 'collegue@exemple.fr'), 'un membre ne peut pas s''auto-promouvoir');
select pg_temp.fails($$delete from public.clients where name = 'Mme Dupont'$$, 'client avec devis non supprimable');
select pg_temp.login('alice@exemple.fr');
update public.companies set siret = '12345678900012', brand_color = '#059669', logo_path = current_setting('test.alice_company') || '/logo.png';
select pg_temp.ok((select brand_color = '#059669' from public.companies), 'la propriétaire modifie le profil');
select pg_temp.fails($$update public.companies set brand_color = 'rouge'$$, 'couleur invalide refusée');
select pg_temp.fails($$update public.companies set siret = '123'$$, 'SIRET mal formé refusé');
select pg_temp.logout();

-- ---------------------------------------------------------------------
\echo '12. Éditeur : enregistrement des lignes, duplication, facture publique'
select pg_temp.login('alice@exemple.fr');
do $$ begin perform set_config('test.q2', (select id::text from public.quotes where number like '%-002'), false); end $$;
do $$ begin perform public.save_document_items('quote', current_setting('test.q2')::uuid, '[
  {"kind":"section","description":"Salle de bain"},
  {"description":"Pose carrelage","quantity":12.5,"unit":"m²","unit_price":42,"vat_rate":10},
  {"description":"Fournitures","quantity":1,"unit_price":300,"vat_rate":20,"discount_percent":10},
  {"kind":"note","description":"Carrelage fourni par le client"}
]'::jsonb); end $$;
select pg_temp.ok((select total_ht = 795 and total_vat = 106.50 and total_ttc = 901.50
                   from public.quotes where id = current_setting('test.q2')::uuid),
  'lignes, sections et notes enregistrées ; totaux recalculés (525 + 270 HT)');
do $$ begin perform public.save_document_items('quote', current_setting('test.q2')::uuid,
  '[{"description":"Forfait","quantity":1,"unit_price":100,"vat_rate":20}]'::jsonb); end $$;
select pg_temp.ok((select count(*) = 1 from public.quote_items where quote_id = current_setting('test.q2')::uuid)
                  and (select total_ttc = 120 from public.quotes where id = current_setting('test.q2')::uuid),
  'remplacement atomique des lignes');
select pg_temp.fails($$select public.save_document_items('quote', current_setting('test.alice_quote')::uuid, '[]')$$,
  'lignes d''un devis signé non remplaçables');
select pg_temp.fails($$select public.save_document_items('invoice', (select id from public.invoices limit 1), '[]')$$,
  'lignes d''une facture émise non remplaçables');
do $$ begin perform set_config('test.q3', public.duplicate_quote(current_setting('test.alice_quote')::uuid)::text, false); end $$;
select pg_temp.ok((select status = 'draft' and number like '%-003' and total_ttc = 1518 and signature_data is null
                   from public.quotes where id = current_setting('test.q3')::uuid), 'duplication d''un devis signé → nouveau brouillon');
select pg_temp.logout();
select pg_temp.login('bob@exemple.gf');
select pg_temp.fails($$select public.save_document_items('quote', current_setting('test.q2')::uuid, '[]')$$,
  'Bob ne modifie pas les lignes d''Alice');
select pg_temp.fails($$select public.duplicate_quote(current_setting('test.q2')::uuid)$$, 'Bob ne duplique pas les devis d''Alice');
select pg_temp.logout();
do $$ begin perform set_config('test.inv_token', (select public_token::text from public.invoices limit 1), false); end $$;
set role anon;
select pg_temp.ok((select (public.get_public_invoice(current_setting('test.inv_token')::uuid) -> 'invoice' ->> 'number') like 'FAC-%'),
  'facture consultable par son lien');
select pg_temp.fails($$select public.expire_quotes()$$, 'expiration réservée au serveur');
reset role;
select pg_temp.ok(public.is_subscription_active(current_setting('test.alice_company')::uuid), 'abonnement actif (service)');
select public.increment_email_usage(current_setting('test.alice_company')::uuid) is null as x \gset
select pg_temp.ok((select emails_sent = 1 from public.usage_counters where company_id = current_setting('test.alice_company')::uuid
                   and period = date_trunc('month', now())::date), 'compteur d''emails');
select pg_temp.login('alice@exemple.fr');
select pg_temp.fails($$select public.increment_email_usage(current_setting('test.alice_company')::uuid)$$, 'compteur d''emails non appelable depuis l''app');
update public.quotes set status = 'refused', refusal_reason = 'Trop cher' where id = current_setting('test.q2')::uuid;
select pg_temp.ok((select refusal_reason = 'Trop cher' and refused_at is not null from public.quotes where id = current_setting('test.q2')::uuid),
  'refus manuel avec motif');
select pg_temp.logout();

-- ---------------------------------------------------------------------
\echo '13. IA : quota des générations de devis et journal'
update public.usage_counters set ai_messages = 0, ai_quote_generations = 0 where company_id = current_setting('test.alice_company')::uuid;
select pg_temp.ok(public.consume_ai_message(current_setting('test.alice_company')::uuid, 'quote'), 'génération de devis décomptée');
select pg_temp.ok((select ai_quote_generations = 1 and ai_messages = 0 from public.usage_counters
                   where company_id = current_setting('test.alice_company')::uuid and period = date_trunc('month', now())::date),
  'compteur séparé messages / devis');
insert into public.ai_generations (company_id, kind, prompt, model) values (current_setting('test.alice_company')::uuid, 'quote', 'Chauffe-eau 200 L', 'claude-opus-5-5');
select pg_temp.login('alice@exemple.fr');
select pg_temp.ok((select count(*) = 1 from public.ai_generations), 'Alice voit son journal IA');
select pg_temp.fails($$insert into public.ai_generations (company_id, kind, prompt) values (current_setting('test.alice_company')::uuid, 'quote', 'x')$$,
  'journal IA non modifiable depuis l''app');
update public.quotes set ai_generated = true where id = current_setting('test.q3')::uuid;
select pg_temp.ok((select ai_generated from public.quotes where id = current_setting('test.q3')::uuid), 'devis marqué « généré par IA »');
select pg_temp.logout();
select pg_temp.login('bob@exemple.gf');
select pg_temp.ok((select count(*) = 0 from public.ai_generations), 'Bob ne voit pas le journal IA d''Alice');
select pg_temp.logout();

-- ---------------------------------------------------------------------
\echo '14. Prospects : conversion en client, statut piloté par les devis'
do $$ begin perform set_config('test.conv', (select id::text from public.conversations limit 1), false); end $$;
insert into public.leads (company_id, conversation_id, name, email, phone, need, is_quote_request, source)
values (current_setting('test.alice_company')::uuid, current_setting('test.conv')::uuid, 'Jean Lebon', 'Jean@Lebon.fr', '0694 00 11 22',
        'Pose d''un climatiseur', true, 'widget');
select pg_temp.fails($$insert into public.leads (company_id, conversation_id, name) values (current_setting('test.alice_company')::uuid, current_setting('test.conv')::uuid, 'doublon')$$,
  'un seul prospect par conversation');
select pg_temp.login('alice@exemple.fr');
do $$ begin perform set_config('test.lead', (select id::text from public.leads where name = 'Jean Lebon'), false); end $$;
do $$ begin perform set_config('test.lead_client', public.convert_lead_to_client(current_setting('test.lead')::uuid)::text, false); end $$;
select pg_temp.ok((select source = 'widget' and email = 'jean@lebon.fr' and notes like 'Pose%' from public.clients
                   where id = current_setting('test.lead_client')::uuid), 'prospect converti en client (source assistant)');
select pg_temp.ok(public.convert_lead_to_client(current_setting('test.lead')::uuid) = current_setting('test.lead_client')::uuid,
  'conversion idempotente');
insert into public.quotes (company_id, client_id, lead_id, title)
values (current_setting('test.alice_company')::uuid, current_setting('test.lead_client')::uuid, current_setting('test.lead')::uuid, 'Climatisation');
select pg_temp.ok((select status = 'quoted' from public.leads where id = current_setting('test.lead')::uuid), 'devis créé → prospect « devis envoyé »');
update public.quotes set status = 'accepted' where lead_id = current_setting('test.lead')::uuid;
select pg_temp.ok((select status = 'won' from public.leads where id = current_setting('test.lead')::uuid), 'devis accepté → prospect gagné');
select pg_temp.logout();
select pg_temp.login('bob@exemple.gf');
select pg_temp.fails($$select public.convert_lead_to_client(current_setting('test.lead')::uuid)$$, 'Bob ne convertit pas les prospects d''Alice');
select pg_temp.logout();

-- ---------------------------------------------------------------------
\echo '15. Offres et abonnements'
select pg_temp.ok((select string_agg(id || ':' || price_cents, ',' order by sort_order) = 'starter:7000,pro:9900,business:11900,premium:14900'
                   from public.plans), '4 offres de 70 à 149 €');
insert into auth.users (email) values ('nouveau@exemple.fr');
select pg_temp.login('nouveau@exemple.fr');
do $$ begin perform set_config('test.new_company', (select id::text from public.create_company('Nouvelle SARL')), false); end $$;
select pg_temp.ok((select plan_id = 'premium' and status = 'trialing' from public.subscriptions), 'essai de 14 jours sur Premium');
select pg_temp.ok(public.company_has_feature(current_setting('test.new_company')::uuid, 'appointments'), 'essai : toutes les fonctionnalités');
select pg_temp.ok((select (u ->> 'features')::jsonb ? 'review_requests' and (u ->> 'price_cents')::int = 14900
                   from public.current_usage(current_setting('test.new_company')::uuid) u), 'usage : offre, prix et fonctionnalités');
select pg_temp.logout();
-- Fin d'essai : plus de création de devis, lecture conservée
update public.subscriptions set trial_ends_at = now() - interval '1 hour' where company_id = current_setting('test.new_company')::uuid;
select pg_temp.login('nouveau@exemple.fr');
select pg_temp.fails($$insert into public.quotes (company_id) values (current_setting('test.new_company')::uuid)$$,
  'essai terminé : création de devis bloquée');
select pg_temp.ok(not public.company_has_feature(current_setting('test.new_company')::uuid, 'online_signature'), 'essai terminé : fonctionnalités coupées');
select pg_temp.logout();
-- Abonnement Starter : pas de signature en ligne
update public.subscriptions set status = 'active', plan_id = 'starter' where company_id = current_setting('test.new_company')::uuid;
select pg_temp.login('nouveau@exemple.fr');
insert into public.quotes (company_id, title) values (current_setting('test.new_company')::uuid, 'Starter');
select pg_temp.ok((select count(*) = 1 from public.quotes), 'abonnement actif : création de devis');
update public.quotes set status = 'sent';
do $$ begin perform set_config('test.starter_token', (select public_token::text from public.quotes limit 1), false); end $$;
select pg_temp.logout();
set role anon;
select pg_temp.ok((select (public.get_public_quote(current_setting('test.starter_token')::uuid) ->> 'online_signature')::boolean = false),
  'Starter : la page publique n''offre pas la signature');
select pg_temp.fails($$select public.sign_quote(current_setting('test.starter_token')::uuid, 'Client', 'data:image/png;base64,AA')$$,
  'Starter : signature en ligne refusée');
reset role;
update public.subscriptions set plan_id = 'pro' where company_id = current_setting('test.new_company')::uuid;
set role anon;
select pg_temp.ok((select (public.get_public_quote(current_setting('test.starter_token')::uuid) ->> 'online_signature')::boolean),
  'Pro : signature en ligne disponible');
reset role;
select pg_temp.login('nouveau@exemple.fr');
select pg_temp.fails($$select * from public.stripe_events$$, 'événements Stripe invisibles depuis l''app');
select pg_temp.logout();

-- ---------------------------------------------------------------------
\echo '16. Super-admin'
select pg_temp.login('swann@admin.fr');
select pg_temp.ok((select count(*) = 3 and bool_and(owner_email is not null) from public.admin_companies_overview()), 'vue d''ensemble : 3 entreprises et leurs propriétaires');
select pg_temp.ok((select plan = 'pro' and plan_price_cents = 9900 and ai_limit = 1000 and leads_total = 1 and last_activity_at is not null
                   from public.admin_companies_overview() where name = 'Plomberie Martin'), 'détail : offre, quota, prospects, activité');
select pg_temp.ok((select (s ->> 'companies')::int = 3 and jsonb_array_length(s -> 'signups_by_month') = 6 and s ? 'mrr_by_plan'
                   from public.admin_platform_stats() s), 'statistiques plateforme');
do $$ begin perform public.admin_extend_trial((select id from public.companies where name = 'Bob Électricité'), 7); end $$;
select pg_temp.ok((select trial_ends_at > now() + interval '20 days' from public.subscriptions s join public.companies c on c.id = s.company_id
                   where c.name = 'Bob Électricité'), 'essai prolongé de 7 jours');
select pg_temp.fails($$select public.admin_extend_trial((select id from public.companies where name = 'Bob Électricité'), 365)$$, 'durée de prolongation bornée');
select pg_temp.logout();
select pg_temp.login('alice@exemple.fr');
select pg_temp.fails($$select public.admin_extend_trial(current_setting('test.alice_company')::uuid, 30)$$, 'un client ne prolonge pas son propre essai');
select pg_temp.fails($$select public.admin_platform_stats()$$, 'statistiques plateforme réservées');
select pg_temp.logout();

-- ---------------------------------------------------------------------
\echo '17. Relances automatiques'
-- Entreprise de test : abonnement Pro actif, client avec email
insert into auth.users (email) values ('relance@exemple.fr');
select pg_temp.login('relance@exemple.fr');
do $$ begin perform set_config('test.rc', (select id::text from public.create_company('Relance SAS')), false); end $$;
update public.companies set postal_code = '97300' where id = current_setting('test.rc')::uuid;
select pg_temp.ok((select timezone = 'America/Cayenne' from public.companies where id = current_setting('test.rc')::uuid), 'fuseau déduit du code postal (Guyane)');
update public.companies set quote_reminder_days = '{7,3,3,0}' where id = current_setting('test.rc')::uuid;
select pg_temp.ok((select quote_reminder_days = '{3,7}' from public.companies where id = current_setting('test.rc')::uuid), 'délais triés, dédoublonnés, bornés');
select pg_temp.fails($$update public.companies set timezone = 'Mars/Olympus' where id = current_setting('test.rc')::uuid$$, 'fuseau inconnu refusé');
insert into public.clients (company_id, name, email) values (current_setting('test.rc')::uuid, 'Client Relancé', 'client@relance.fr');
insert into public.quotes (company_id, client_id, title) select current_setting('test.rc')::uuid, id, 'Q' from public.clients where name = 'Client Relancé';
insert into public.quote_items (quote_id, company_id, description, unit_price) select id, company_id, 'x', 100 from public.quotes where title = 'Q';
update public.quotes set status = 'sent' where title = 'Q';
insert into public.invoices (company_id, client_id) select current_setting('test.rc')::uuid, id from public.clients where name = 'Client Relancé';
insert into public.invoice_items (invoice_id, company_id, description, unit_price) select id, company_id, 'x', 500 from public.invoices where company_id = current_setting('test.rc')::uuid;
update public.invoices set status = 'issued' where company_id = current_setting('test.rc')::uuid;
select pg_temp.logout();
update public.subscriptions set status = 'active', plan_id = 'pro' where company_id = current_setting('test.rc')::uuid;

create function pg_temp.due(t text) returns setof integer language sql as $$
  select rank from public.due_reminders(true) where company_id = current_setting('test.rc')::uuid and doc_type = t $$;

select pg_temp.ok((select count(*) = 0 from pg_temp.due('quote')), 'devis envoyé aujourd''hui : pas encore de relance');
update public.quotes set sent_at = now() - interval '3 days 1 hour' where title = 'Q';
select pg_temp.ok((select array_agg(r) = '{1}' from pg_temp.due('quote') r), 'J+3 : 1re relance due');
do $$ begin perform public.record_reminder('quote', (select id from public.quotes where title = 'Q')); end $$;
select pg_temp.ok((select count(*) = 0 from pg_temp.due('quote')), 'relance enregistrée : plus due');
update public.quotes set sent_at = now() - interval '7 days 1 hour' where title = 'Q';
select pg_temp.ok((select array_agg(r) = '{2}' from pg_temp.due('quote') r), 'J+7 : 2e relance due');
do $$ begin perform public.record_reminder('quote', (select id from public.quotes where title = 'Q')); end $$;
update public.quotes set sent_at = now() - interval '20 days' where title = 'Q';
select pg_temp.ok((select count(*) = 0 from pg_temp.due('quote')), 'au plus 2 relances par devis');

update public.invoices set due_date = current_date - 1 where company_id = current_setting('test.rc')::uuid;
select pg_temp.ok((select array_agg(r) = '{1}' from pg_temp.due('invoice') r), 'facture échue depuis 1 jour : relance 1');
select pg_temp.login('relance@exemple.fr');
update public.invoices set reminders_paused = true where company_id = current_setting('test.rc')::uuid;
select pg_temp.logout();
select pg_temp.ok((select count(*) = 0 from pg_temp.due('invoice')), 'relances en pause sur cette facture');
update public.invoices set reminders_paused = false where company_id = current_setting('test.rc')::uuid;
update public.invoices set amount_paid = 600 where company_id = current_setting('test.rc')::uuid;
select pg_temp.ok((select count(*) = 0 from pg_temp.due('invoice')), 'facture payée : plus de relance');

-- Offre sans relances automatiques
update public.quotes set reminder_count = 0, sent_at = now() - interval '4 days' where title = 'Q';
update public.subscriptions set plan_id = 'starter' where company_id = current_setting('test.rc')::uuid;
select pg_temp.ok((select count(*) = 0 from pg_temp.due('quote')), 'Starter : pas de relance automatique');
update public.subscriptions set plan_id = 'pro' where company_id = current_setting('test.rc')::uuid;
select pg_temp.ok((select count(*) = 1 from pg_temp.due('quote')), 'Pro : relance automatique');
select pg_temp.ok((select count(*) = 0 from public.due_reminders(false) d, public.companies c
                   where c.id = d.company_id and c.id = current_setting('test.rc')::uuid
                     and not (extract(isodow from now() at time zone c.timezone) < 7 and extract(hour from now() at time zone c.timezone) between 9 and 17))
  , 'hors heures ouvrées locales : rien n''est envoyé');
select pg_temp.login('relance@exemple.fr');
select pg_temp.fails($$select * from public.due_reminders(true)$$, 'liste des relances réservée au serveur');
select pg_temp.fails($$select public.record_reminder('quote', gen_random_uuid())$$, 'enregistrement réservé au serveur');
select pg_temp.logout();
