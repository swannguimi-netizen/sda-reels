# Application mobile (iOS et Android)

Application Expo (SDK 58, React Native, Expo Router) qui partage le backend Supabase de l'application web.
Pensée pour le terrain : créer un devis sur le chantier, l'envoyer, suivre sa signature, répondre aux clients.

## Écrans

| Onglet / écran | Contenu |
|---|---|
| Accueil | CA signé, devis en attente, taux d'acceptation, impayés ; « À faire » (demandes de devis, visiteurs qui attendent, devis à relancer) |
| Devis | Liste filtrable (brouillons, en attente, acceptés, refusés) ; bouton « Nouveau » |
| Nouveau devis | Client (recherche ou création rapide), description du chantier → **lignes proposées par l'IA** (dictée possible via le micro du clavier), catalogue, lignes libres, totaux en direct |
| Détail du devis | Envoi par email, **partage du lien de signature** (WhatsApp, SMS… via la feuille de partage), relance, « accepté », appel du client |
| Messages | Conversations de l'assistant (temps réel), badges « Devis » et « À traiter » |
| Conversation | Appeler / SMS / email en un geste, réponse, reprise en main ou retour à l'IA |
| Compte | Entreprise, activation des notifications, dernières alertes, déconnexion |

Le calcul des totaux et les statuts viennent du même code que l'application web (`../src/lib/documents.ts`, via `metro.config.js`).

## Notifications

Devis signé ou refusé, acompte reçu, demande de devis, visiteur qui attend une réponse, message pendant la reprise en main,
rendez-vous pris par l'assistant. Côté serveur : table `notification_events` (triggers) distribuée chaque minute par
l'Edge Function `push-dispatch` (service Expo Push). Toucher une notification ouvre le devis ou la conversation.

## Démarrer

```bash
cp .env.example .env    # URL et clé anon Supabase, adresse de l'application web
npm install
npx expo start          # Expo Go ou build de développement
```

## Publier sur les stores (EAS)

```bash
npx eas-cli@latest init                       # crée le projet EAS ; remplacez extra.eas.projectId dans app.json
npx eas-cli@latest build --platform all       # builds iOS et Android dans le cloud
npx eas-cli@latest submit --platform ios      # App Store Connect ; idem android pour Google Play
```

- Identifiants : `fr.devisia.app` (iOS et Android) dans `app.json` — à adapter à votre nom de domaine.
- Notifications : identifiants APNs (iOS) et FCM (Android) à configurer dans EAS (`eas credentials`) ; les
  notifications ne s'affichent pas dans Expo Go sur Android, utiliser un build de développement.
- Comptes développeur requis : Apple (99 $/an) et Google Play (25 $ une fois).

## Vérifications

```bash
npx tsc --noEmit                      # typage (inclut le code partagé avec le web)
npx expo export --platform web        # build web, utilisé pour tester les écrans dans un navigateur
```
