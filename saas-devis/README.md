# SaaS Devis & Assistant IA

SaaS multi-tenant pour TPE/PME, artisans et freelances : devis et factures conformes, génération de devis par IA, assistant IA de réponse aux clients (widget), abonnements Stripe.

**Stack** : React 19 + Vite + Tailwind 4 · Supabase (Auth, Postgres + RLS, Storage, Edge Functions) · API Claude · Stripe · Resend · Netlify.

## Avancement

| # | Étape | État |
|---|-------|------|
| 1 | Base de données, RLS et authentification | ✅ |
| 2 | Profil entreprise et catalogue | ⏳ |
| 3 | Devis + PDF (envoi, signature, facture) | ⏳ (schéma prêt) |
| 4 | Génération IA des devis | ⏳ |
| 5 | Assistant IA et widget | ⏳ (schéma prêt) |
| 6 | Stripe et abonnements | ⏳ (schéma prêt) |
| 7 | Tableau de bord et admin | ⏳ (fonctions SQL prêtes) |
| + | Relances, acompte, rendez-vous, avis Google, mobile Expo | ⏳ (tables prêtes) |

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

### Tests

63 vérifications (isolation, calculs, signature, facturation, quotas, stockage) sur un Postgres local avec un bouchon Supabase :

```bash
npm run test:db     # PGHOST / PGPORT / PGUSER configurables
```
