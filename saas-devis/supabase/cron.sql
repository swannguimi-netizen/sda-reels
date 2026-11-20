-- =====================================================================
-- Planification des relances automatiques (à exécuter UNE fois dans l'éditeur SQL
-- du projet Supabase, après avoir déployé la fonction send-reminders).
-- Remplacez <PROJET> et <CRON_SECRET> (même valeur que le secret de la fonction).
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Secrets stockés dans Vault (jamais en clair dans la définition de la tâche)
select vault.create_secret('https://<PROJET>.supabase.co/functions/v1/send-reminders', 'reminders_url');
select vault.create_secret('<CRON_SECRET>', 'reminders_cron_secret');

-- Toutes les heures à la minute 7 : chaque entreprise est relancée pendant ses heures ouvrées locales
select cron.schedule('relances-automatiques', '7 * * * *', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);

-- Vérifier : select * from cron.job_run_details order by start_time desc limit 10;
