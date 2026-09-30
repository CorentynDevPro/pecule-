# Pécule

Assistant d'investissement personnel, utilisable comme application (PWA) sur ton iPhone, ton Mac
et ta tour Windows. Il fonctionne **seul sur le téléphone** (hébergé sur GitHub Pages) et se relie
à ta tour quand elle est en place.

| Phase | Contenu | État |
| --- | --- | --- |
| 1 · Suivi | Profil et poches, portefeuille (PRU, plus-values), flux, cours en direct, conseil de versement | fait |
| 2 · Analyse | Simulation Monte-Carlo à queues épaisses, statistiques (Sharpe, Sortino, pire baisse), frontière efficiente, test de stratégie hors échantillon | fait |
| 3 · Agent | Signaux backtestés, contrôle de risque, positions fictives suivies en direct, journal, compteur des 90 jours | fait, en mode entraînement |
| 4 · Affinage | Scénarios de crise, récapitulatif fiscal annuel | fait |
| Suite | Agent en continu sur la tour, notifications push, IA locale (Ollama), exécution réelle plafonnée sur la crypto | après 90 jours d'entraînement réussis |

## Sur ton iPhone, sans la tour

L'application est publiée sur `https://corentyndevpro.github.io/pecule/`.

1. Ouvre l'adresse dans **Safari**, puis **Partager → Sur l'écran d'accueil**.
2. Crypto et taux EUR/USD : en direct depuis Kraken, sans rien configurer.
3. Actions américaines (Take-Two, EA…) : crée une clé gratuite sur twelvedata.com et colle-la dans
   **Plus → Profil et appareil**. Elle reste sur ton téléphone.
4. ETF européens (DCAM) : pas de source gratuite utilisable depuis un téléphone. Saisis le cours
   de ton courtier (**Saisir le cours** sur la ligne du portefeuille) jusqu'à ce que la tour prenne le relais.

Tes données restent dans le téléphone. Quand la tour sera prête, saisis son adresse
(`tour.xxx.ts.net`) dans **Profil et appareil** : tout ce que tu as saisi y sera envoyé.
Pense à **Exporter** une sauvegarde de temps en temps : sans tour, le téléphone est le seul à avoir tes données.

## L'agent (phase 3)

- Deux règles connues : cassure de tendance (plus haut 20 jours, moyenne 20 > moyenne 50) et
  retour à la moyenne (cours à plus de 2 écarts-types sous sa moyenne 20 jours).
- Chaque règle est rejouée sur l'historique de l'actif ; elle n'est proposée que si elle a gagné,
  frais déduits, sur **chacune** des deux moitiés de l'historique.
- Taille de position : perte au stop ≤ 2 % du capital ; au plus 3 positions ; levier ≤ 5 (≤ 2 en crypto) ;
  coupe-circuit à −20 % sur le mois.
- Tout est fictif (1 000 € d'entraînement). L'argent réel n'est envisagé qu'après 90 jours,
  10 opérations fermées, un résultat positif et meilleur que l'ETF monde sur la même période.
- Sur le téléphone, l'agent veille quand l'application est ouverte.

---

## Pourquoi il n'y a « jamais de coupure »

| Situation | Ce qui se passe |
| --- | --- |
| Tout va bien | Chaque appareil reçoit les cours en direct de la tour et se synchronise toutes les 20 s. |
| La tour est éteinte ou injoignable | L'application s'ouvre quand même (elle est en cache sur l'appareil) avec **toutes tes données**, stockées localement. Après 8 s, l'appareil se branche **lui-même** sur le flux public de Kraken : la crypto et le taux EUR/USD restent en direct. Les autres cours restent affichés avec leur âge. |
| Tu saisis une opération sans la tour | Elle est enregistrée sur l'appareil et mise en file d'attente (le badge l'indique), puis envoyée dès que la tour répond. |
| Deux appareils modifient la même chose | La modification la plus récente gagne, de façon identique sur tous les appareils. |
| Pas de réseau du tout | Mode hors ligne : dernières valeurs connues, saisie possible, synchronisation au retour. |

Le badge en haut à droite dit toujours d'où viennent les chiffres : *Tour connectée*, *Mode autonome*,
*Tour injoignable* ou *Hors ligne*.

---

## Architecture

```
iPhone / Mac / tour ── PWA (Vue 3) ── IndexedDB locale ─┐
        │                                                │  synchro POST /api/sync
        │  HTTPS (tailscale serve)                       │  cours en direct WS /api/live
        ▼                                                ▼
   nginx ──► API Node.js (Fastify) ──► PostgreSQL + TimescaleDB ◄── flux Python
                                                                    (Kraken, Twelve Data, Yahoo)
```

| Dossier | Rôle |
| --- | --- |
| `apps/web` | PWA : Vue 3, TypeScript, Tailwind, ECharts, Dexie (IndexedDB), service worker ; sources directes Kraken et Twelve Data |
| `apps/api` | API : synchronisation, cours, relais temps réel (LISTEN/NOTIFY → WebSocket) |
| `packages/shared` | Schémas, protocole, moteur d'analyse et logique de l'agent, partagés par l'API et la PWA |
| `services/feed` | Collecte des cours, bougies d'une minute, historiques quotidiens |
| `infra/nginx` | Sert la PWA et relaie l'API |

Sources de cours (toutes gratuites) :

| Préfixe | Source | Délai | Exemple |
| --- | --- | --- | --- |
| `kraken:` | WebSocket public Kraken | temps réel, 24 h/24 | `kraken:BTC/EUR` |
| `td:` | Twelve Data (clé gratuite) | temps réel pendant la séance US | `td:TTWO` |
| `yf:` | Yahoo Finance | environ 15 min | `yf:DCAM.PA` |
| `fx:` | change, via Twelve Data ou Yahoo | selon la source | `fx:EUR/USD` |

Sans clé Twelve Data, les actifs `td:` sont récupérés via Yahoo (avec délai). Le budget gratuit
(800 crédits par jour) est réparti automatiquement sur la séance américaine.

---

## Installation sur la tour Windows

### 1. Prérequis

1. **Docker Desktop** avec WSL 2 : <https://www.docker.com/products/docker-desktop/>.
   Dans ses réglages, coche *Start Docker Desktop when you sign in to your computer*.
2. **Tailscale**, déjà en place sur tes machines. Dans la console d'administration Tailscale
   (*DNS*), active **MagicDNS** et **HTTPS Certificates**.
3. **Alimentation** : Paramètres → Système → Alimentation → mise en veille sur **Jamais**
   (branché secteur). La crypto ne dort jamais : la tour non plus.

> Après une mise à jour Windows, Docker Desktop ne redémarre qu'une fois ta session ouverte.
> Si tu veux une reprise sans intervention, active l'ouverture de session automatique de Windows.
> Pendant ce temps, les appareils passent en mode autonome.

### 2. Lancer Pécule

Dans PowerShell, depuis le dossier du projet :

```powershell
Copy-Item .env.example .env
notepad .env        # choisis un mot de passe long ; ajoute ta clé Twelve Data si tu en as une
docker compose up -d --build
```

Vérification : <http://localhost:8080/api/health> doit afficher `"ok":true`.

### 3. Publier en HTTPS sur ton réseau Tailscale

Une PWA ne s'installe qu'en HTTPS. Tailscale fournit le certificat :

```powershell
tailscale serve --bg 8080
```

L'application est alors disponible sur `https://<nom-de-la-tour>.<ton-tailnet>.ts.net`, uniquement
pour tes appareils Tailscale. Rien n'est ouvert sur Internet.

### 4. Installer l'application sur chaque appareil

| Appareil | Étapes |
| --- | --- |
| iPhone | Tailscale actif → Safari → adresse ci-dessus → **Partager** → **Sur l'écran d'accueil** |
| Mac | Safari → adresse ci-dessus → **Fichier** → **Ajouter au Dock** (macOS Sonoma ou plus récent) |
| Tour Windows | Edge → adresse ci-dessus → icône **Installer** dans la barre d'adresse → épingler à la barre des tâches |

Utilise bien l'adresse `https://…ts.net` sur la tour aussi, pas `localhost` : chaque adresse
a sa propre base locale, et c'est celle-ci qui est partagée par tes appareils.

---

## Sauvegardes

- Le conteneur `backup` écrit chaque nuit un export de la base dans `./backups`
  (30 jours conservés). Copie ce dossier vers ton NAS Synology (Synology Drive Client ou une
  tâche planifiée `robocopy`).
- Profil → **Exporter** produit un fichier JSON avec toutes tes données, restaurable par
  **Importer** sur n'importe quel appareil.

Restaurer un export de la base :

```powershell
docker compose exec -T db pg_restore -U pecule -d pecule --clean < backups\pecule-AAAA-MM-JJ.dump
```

---

## Développement

```bash
npm install                          # à la racine
npm run dev:api                      # API sur :3000 (DATABASE_URL requis)
npm run dev:web                      # PWA sur :5173, relaie /api vers :3000
cd services/feed && pip install -r requirements.txt && python -m feed.main
```

Tests :

```bash
TEST_DATABASE_URL=postgres://… npm test -w apps/api          # API contre un vrai PostgreSQL
PECULE_API_URL=http://localhost:3000 npm test -w apps/web     # calculs + synchro multi-appareils
cd services/feed && TEST_DATABASE_URL="host=… dbname=…" pytest
```

Conventions : identifiants en anglais, commentaires et documentation en français,
commits au format Conventional Commits.

---

## Ce qui a été vérifié, et ce qui reste à vérifier chez toi

Vérifié pendant le développement :

- 9 tests d'API contre PostgreSQL 16, dont la diffusion en direct par WebSocket et le CORS pour GitHub Pages ;
- 16 tests du flux, dont l’écriture en base ;
- 51 tests de la PWA : calculs, synchronisation (dont un trajet iPhone → tour → Mac à travers l'API réelle),
  moteur d'analyse, agent, fiscalité ;
- la version GitHub Pages dans Chromium, format iPhone : démarrage sans tour, puis liaison à une tour ;
- la PWA dans Chromium en format iPhone et ordinateur, thèmes clair et sombre, sans erreur console ;
- le scénario de panne : tour arrêtée, application rouverte avec toutes ses données, saisie mise en attente.

À vérifier au premier lancement sur la tour (impossible depuis l'environnement de développement,
dont l'accès à Internet est filtré) :

- la construction des images Docker (`docker compose up -d --build`) ;
- la connexion réelle à Kraken, Twelve Data et Yahoo : l'état de chaque source est visible dans
  Profil → *Connexion et sources*, et dans `docker compose logs feed`.
