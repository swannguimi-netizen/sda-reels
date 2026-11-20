# SaaS Devis & Assistant IA

SaaS multi-tenant pour TPE/PME, artisans et freelances : devis et factures conformes, génération de devis par IA, assistant IA de réponse aux clients (widget), abonnements Stripe.

**Stack** : React 19 + Vite + Tailwind 4 · Supabase (Auth, Postgres + RLS, Storage, Edge Functions) · API Claude · Stripe · Resend · Netlify.

## Avancement

| # | Étape | État |
|---|-------|------|
| 1 | Base de données, RLS et authentification | ✅ |
| 2 | Profil entreprise, catalogue et clients | ✅ |
| 3 | Devis + PDF (envoi, signature, facture) | ✅ (envoi email : à brancher sur Resend) |
| 4 | Génération IA des devis | ✅ (clé API Claude à brancher) |
| 5 | Assistant IA et widget | ✅ (clé API Claude à brancher) |
| 6 | Stripe et abonnements | ✅ (clés Stripe à brancher) |
| 7 | Tableau de bord et admin | ✅ |
| 8 | Relances automatiques | ✅ (planification pg_cron à activer) |
| 9 | Acompte payé en ligne (Stripe Connect) | ✅ (Connect à activer dans Stripe) |
| + | Rendez-vous, avis Google, mobile Expo | ⏳ (tables prêtes) |

## Démarrage

```bash
cp .env.example .env          # renseigner l'URL et la clé anon du projet Supabase
npm install
npm run dev
```

Appliquer les migrations sur le projet Supabase :

```bash
supabase link --project-ref <ref>
supabase db push
```

Edge Functions et secrets (envoi des emails via Resend) :

```bash
supabase secrets set RESEND_API_KEY=re_xxx EMAIL_FROM=devis@votre-domaine.fr APP_URL=https://votre-app.netlify.app
supabase functions deploy send-document

# IA (génération de devis)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx   # CLAUDE_MODEL facultatif (défaut : claude-opus-5-5)
supabase functions deploy generate-quote
supabase functions deploy widget-chat --no-verify-jwt   # API publique du widget

# Stripe : produits, prix (lookup_key) et portail client, puis fonctions
STRIPE_SECRET_KEY=sk_test_xxx deno run -A supabase/functions/_scripts/stripe-setup.ts
supabase secrets set STRIPE_SECRET_KEY=sk_test_xxx STRIPE_WEBHOOK_SECRET=whsec_xxx   # STRIPE_AUTOMATIC_TAX=true si Stripe Tax est activé
supabase functions deploy billing
supabase functions deploy stripe-webhook --no-verify-jwt   # Stripe → Webhooks : checkout.session.completed, customer.subscription.*
```

`EMAIL_FROM` doit appartenir à un domaine vérifié dans Resend. Sans cette configuration, l'application
reste utilisable : « Copier le lien » marque le devis comme envoyé et copie le lien de signature
(à transmettre par SMS, WhatsApp…).

Acompte en ligne (Stripe Connect) : activer Connect dans le tableau de bord Stripe, puis

```bash
supabase functions deploy connect
supabase functions deploy deposit-checkout --no-verify-jwt
# Stripe → Webhooks → endpoint « Événements des comptes connectés » vers stripe-webhook :
#   checkout.session.completed, checkout.session.async_payment_succeeded, account.updated
supabase secrets set STRIPE_CONNECT_WEBHOOK_SECRET=whsec_xxx
```

Relances automatiques : déployer la fonction puis planifier l'appel horaire.

```bash
supabase secrets set CRON_SECRET=$(openssl rand -hex 24)
supabase functions deploy send-reminders --no-verify-jwt
# puis exécuter supabase/cron.sql dans l'éditeur SQL (URL du projet + même CRON_SECRET)
```

Dans Supabase → Authentication → URL Configuration, ajouter l'URL du site et les redirections
`/bienvenue` et `/nouveau-mot-de-passe`.

Super-admin : après inscription, exécuter dans l'éditeur SQL
`update profiles set is_platform_admin = true where email = 'votre@email';`

## Base de données (`supabase/migrations`)

| Fichier | Contenu |
|---------|---------|
| `…01_tenancy.sql` | profils, entreprises, membres, invitations, offres, abonnements, usage IA, fonctions d'autorisation, `create_company()` |
| `…02_quotes_invoices.sql` | catalogue, clients, devis, factures, numérotation `DEV-2026-001` / `FAC-2026-001`, calcul HT/TVA/TTC, signature publique, conversion en facture |
| `…03_assistant_crm.sql` | base de connaissances, réglages assistant, conversations, messages, prospects, disponibilités, rendez-vous, Google Agenda, demandes d'avis, journal des emails, jetons push |
| `…05_documents_editor.sql` | enregistrement atomique des lignes, duplication, facture publique, expiration, utilitaires des Edge Functions |
| `…06_ai.sql` | journal des générations IA |
| `…07_assistant.sql` | demandes de devis de l'assistant, conversion prospect → client, statut du prospect piloté par les devis |
| `…08_billing.sql` | 4 offres, fonctionnalités par offre, blocage si abonnement inactif, événements Stripe |
| `…09_admin.sql` | vue super-admin enrichie, statistiques plateforme, prolongation d'essai |
| `…10_reminders.sql` | réglages et calcul des relances dues, fuseau horaire, pause par document |
| `…11_online_deposit.sql` | compte Stripe Connect de l'entreprise, facture d'acompte, déduction sur la facture finale |
| `…04_dashboard_admin_storage.sql` | `dashboard_stats()`, `current_usage()`, vues super-admin, buckets `logos` / `documents` |

### Principes de sécurité

- **RLS sur toutes les tables** : un utilisateur n'accède qu'aux lignes des entreprises dont il est membre (`private.is_member()`).
- **FK composites `(id, company_id)`** : impossible de lier un devis au client ou au produit d'une autre entreprise, même en forgeant les identifiants.
- **Privilèges par colonne** : les totaux, la signature, `is_platform_admin`, la clé du widget et les abonnements ne sont pas modifiables via l'API.
- **Calculs côté base** : totaux, TVA par taux, acompte et numérotation sont calculés par triggers ; le client ne peut pas les falsifier.
- **Conformité** : facture numérotée à l'émission (séquence continue), figée ensuite ; devis signé verrouillé.
- **TVA** : régimes `assujetti`, `franchise` (art. 293 B du CGI) et `non_applicable_dom` pour la Guyane et Mayotte (art. 294-1 du CGI).
- **Accès public** (page de signature) uniquement par jeton, via des fonctions `SECURITY DEFINER` qui ne renvoient que les champs nécessaires.
- **Widget et quotas IA** : passent par des Edge Functions (rôle service) ; `consume_ai_message()` n'est pas appelable depuis le navigateur.

## Devis et factures

- **Éditeur** : lignes du catalogue ou libres, sections, notes, remise par ligne et globale, acompte, totaux en direct (même algorithme que la base, qui fait foi après enregistrement).
- **PDF** généré dans le navigateur (`@react-pdf/renderer`, chargé à la demande) aux couleurs de l'entreprise, avec mentions légales, ventilation de TVA, zone « Bon pour accord » et signature. Copie stockée dans `documents/<entreprise>/<type>/<numéro>.pdf`.
- **Envoi** : Edge Function `send-document` (Resend) avec PDF joint et bouton vers la page publique ; ou lien copié.
- **Page publique** `/d/<jeton>` : consultation, PDF, signature tracée au doigt, refus motivé. `/f/<jeton>` pour les factures.
- **Factures** : conversion d'un devis accepté (acompte déjà versé déduit), numéro attribué à l'émission, encaissements partiels.

## Génération de devis par IA

- Edge Function `generate-quote` : le dirigeant décrit le besoin en une phrase ; Claude (`claude-opus-5-5`, effort `medium`) reçoit le catalogue, le régime de TVA et la localisation de l'entreprise, et répond en **JSON structuré** (`output_config.format`) : objet, introduction, lignes, hypothèses, questions à poser au client.
- **Le catalogue fait foi** : prix, unité et TVA des produits reconnus sont repris du catalogue ; les identifiants inventés deviennent des « prix estimés » ; nombres bornés, TVA conforme au régime (`proposal.ts`, testé avec `deno test`).
- **Quota** : chaque génération est décomptée (`consume_ai_message`, 200/mois en Starter, 1 000 en Pro) avant l'appel ; journal dans `ai_generations`.
- **Refus du modèle** : repli serveur `fallbacks: "default"` ; en cas d'échec, message clair et saisie manuelle possible.
- Rien n'est enregistré sans validation : la proposition s'affiche ligne par ligne (catalogue / estimation), on décoche ce qu'on ne veut pas, puis on insère dans l'éditeur.

## Assistant IA et widget

- **Base de connaissances** par thèmes (horaires, services, tarifs, zone, FAQ) avec jauge de couverture et bouton **« Pré-remplir depuis mon entreprise »** (horaires depuis les disponibilités, services et tarifs TTC depuis le catalogue, FAQ type), sans IA donc instantané et gratuit.
- **Widget** `public/widget.js` : JavaScript autonome sans dépendance, isolé du site hôte (Shadow DOM), aux couleurs de l'entreprise, questions suggérées, liens/emails/téléphones cliquables, plein écran sur mobile, réponses de l'équipe reçues en direct, robuste aux sites en ISO-8859-1. Une ligne à coller (aide pour WordPress, Wix, Shopify, Squarespace).
- **Page de discussion** `/chat/<clé>` + **QR code** téléchargeable : pour les artisans sans site (bio Instagram, carte de visite, camion).
- **Edge Function `widget-chat`** (publique, clé du widget) : Claude avec trois outils stricts — `save_contact`, `create_quote_request`, `request_human` ; prompt système construit depuis la base de connaissances et mis en cache ; quota mensuel (au-delà, message d'attente et passage à l'équipe) ; anti-abus (15 messages / 10 min par visiteur) ; domaines autorisés ; notification email à l'entreprise.
- **Boîte de réception** en temps réel : filtres (non lues, à traiter, demandes de devis, archivées), reprise en main / retour à l'assistant, réponse manuelle, fiche contact modifiable, compteur de non-lus dans le menu.
- **Du message au devis** : « Créer le devis » convertit le prospect en client et ouvre un devis dont le panneau IA est pré-rempli avec le besoin exprimé dans la conversation ; le statut du prospect suit ensuite le devis (devis envoyé → gagné / perdu).

## Abonnements

| Offre | Prix TTC/mois | Utilisateurs | Messages IA | Fonctionnalités ajoutées |
|---|---|---|---|---|
| Starter | 70 € | 1 | 200 | devis, factures, IA, assistant, boîte de réception |
| Pro | 99 € | 3 | 1 000 | signature électronique, relances automatiques |
| Business | 119 € | 5 | 2 000 | acompte payé en ligne |
| Premium | 149 € | 10 | 5 000 | rendez-vous Google Agenda, avis Google |

- Essai de 14 jours **sur Premium**, sans carte. S'abonner pendant l'essai conserve les jours restants (premier prélèvement à la fin de l'essai).
- Offres et limites dans la table `plans` (fonctionnalités dans `plans.features`, testées par `private.plan_has_feature()`) ; prix Stripe retrouvés par `lookup_key` (`plan_<id>_monthly`) : aucun identifiant à recopier.
- **Essai terminé ou abonnement inactif** : données consultables, mais plus de création de devis/factures (RLS), IA et envoi d'emails suspendus, bandeau d'alerte.
- `billing` : Stripe Checkout (TVA intracom., adresse, codes promo) et portail client (carte, factures, changement d'offre au prorata, résiliation en fin de période).
- `stripe-webhook` : signature vérifiée, idempotence (`stripe_events`), synchronisation de l'offre et du statut.
- Page publique `/tarifs`.

## Tableau de bord et super-admin

- **Tableau de bord** : CA signé du mois (évolution vs mois précédent), devis en attente, taux d'acceptation (90 j), impayés ; histogramme du CA signé sur 6 mois (accessible : infobulle au survol et au clavier, vue tableau) ; liste **« À faire »** priorisée (demandes de devis de l'assistant, conversations à traiter, factures en retard, devis à relancer après 3 jours en précisant s'ils ont été ouverts) ; dernières conversations et derniers devis ; check-list de démarrage qui se coche toute seule.
- **Super-admin** (`/admin`, `profiles.is_platform_admin`) : MRR et répartition par offre, inscriptions sur 6 mois, essais (dont ceux qui finissent sous 7 jours), impayés, messages IA et coût estimé ; table des entreprises filtrable (payants, essai, fin d'essai, impayés, inactifs), assistant installé ou non, dernière activité ; **prolongation d'essai** (+7 / +30 jours) et **export CSV** (compatible Excel).

## Relances automatiques (offres Pro et plus)

- **Devis sans réponse** : relances à J+3 et J+7 après l'envoi (réglables, 3 au plus), tant que le devis n'est ni signé, ni refusé, ni expiré. La 1re relance s'adapte : « Avez-vous pu en prendre connaissance ? » si le client n'a pas ouvert le devis, « Avez-vous des questions ? » s'il l'a ouvert.
- **Factures impayées** : J+1, J+7, J+15 après l'échéance (4 au plus), ton progressif — rappel courtois, puis ferme, puis dernier rappel avec les pénalités de retard.
- **Heures ouvrées locales** : du lundi au samedi, 9 h–18 h, dans le fuseau de l'entreprise (déduit du code postal : Guyane, Antilles, Réunion, Mayotte…).
- Textes personnalisables avec variables (`{client}`, `{numero}`, `{montant}`…) et aperçu exact (module partagé `supabase/functions/_shared/reminders.ts`) ; PDF joint ; pause par document ; bouton « Relancer maintenant ».
- Page `/relances` : réglages, aperçu, prochaines relances, historique.
- Sécurité et fiabilité : `due_reminders()` / `record_reminder()` réservées au serveur, appel planifié authentifié par `CRON_SECRET` (Vault), réservation dans `email_logs` + index uniques → jamais deux fois la même relance, même en cas d'exécutions concurrentes ; en cas d'échec d'envoi, la relance est retentée à l'heure suivante.

## Acompte payé en ligne (offres Business et Premium)

- L'entreprise relie **son propre compte Stripe** (Stripe Connect, compte Standard) depuis `/paiements` : l'acompte est versé **directement** sur son compte, la plateforme ne l'encaisse jamais ; frais Stripe et litiges restent à la charge de l'entreprise (aucune responsabilité financière pour la plateforme, aucune commission).
- Après la signature, la page du devis propose **« Payer l'acompte »** (Stripe Checkout, 3-D Secure) ; retour avec confirmation automatique.
- À l'encaissement, le webhook crée la **facture d'acompte** (obligatoire en France) : numérotée, payée, TVA **au prorata de chaque taux** du devis, titre « FACTURE D'ACOMPTE » ; la facture finale déduit l'acompte et le référence. Rejeu du webhook sans doublon ; contrôle que le compte Stripe encaisseur est bien celui de l'entreprise du devis.
- Notification email à l'entreprise à chaque acompte reçu.

### Tests

147 vérifications (isolation, calculs, signature, facturation, quotas, stockage) sur un Postgres local avec un bouchon Supabase :

```bash
npm run test:db     # PGHOST / PGPORT / PGUSER configurables
cd supabase/functions && deno test   # contrôles de la réponse IA et logique de l'assistant
```
