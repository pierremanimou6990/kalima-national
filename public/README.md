# Kalima Jeunesse Nationale — Mission Kalima Guinée

Application nationale de suivi de la jeunesse, à trois niveaux : responsable
d'église → président régional → président national. Comptes individuels
pour chaque personne (traçabilité complète), cotisations par région,
camps bibliques avec orateurs et planning libre, communiqués nationaux.

## Étape 1 — Créer la base Supabase

1. https://supabase.com → **Start your project** → connecte-toi avec GitHub
   → **New project**
2. Nom : `kalima-national`, mot de passe (garde-le de côté), région proche
   → **Create new project**. Attends 1-2 minutes.
3. **SQL Editor** → **New query**, colle ceci, puis **Run** :

   ```sql
   create table users (
     id uuid primary key default gen_random_uuid(),
     email text unique not null,
     password_hash text not null,
     role text not null check (role in ('national','regional','eglise')),
     region text,
     nom text not null,
     eglise text,
     created_by uuid references users(id),
     created_at timestamptz not null default now()
   );

   create table jeunes (
     id uuid primary key default gen_random_uuid(),
     eglise text not null,
     region text not null,
     nom text not null,
     telephone text,
     email text,
     fonction text,
     photo_url text,
     created_by uuid references users(id),
     created_at timestamptz not null default now()
   );

   create table paiements (
     id uuid primary key default gen_random_uuid(),
     jeune_id uuid references jeunes(id) on delete cascade,
     region text not null,
     montant numeric not null,
     date_paiement date not null default current_date,
     note_par uuid references users(id),
     created_at timestamptz not null default now()
   );

   create table objectifs_region (
     region text primary key,
     montant_cible numeric not null default 0
   );

   create table camps (
     id uuid primary key default gen_random_uuid(),
     titre text not null,
     date_debut date not null,
     date_fin date,
     lieu text,
     description text,
     planning_columns jsonb default '[]',
     planning_rows jsonb default '[]',
     created_at timestamptz not null default now()
   );

   create table orateurs (
     id uuid primary key default gen_random_uuid(),
     camp_id uuid references camps(id) on delete cascade,
     nom text not null,
     photo_url text
   );

   create table inscriptions_camp (
     id uuid primary key default gen_random_uuid(),
     camp_id uuid references camps(id) on delete cascade,
     nom text not null,
     telephone text,
     eglise text,
     region text,
     created_at timestamptz not null default now()
   );

   create table communiques (
     id uuid primary key default gen_random_uuid(),
     titre text not null,
     contenu text not null,
     created_at timestamptz not null default now()
   );
   ```

4. **Storage** → **New bucket** → nom `photos` → active **Public bucket**
   → **Create bucket**

5. **Project Settings** → **API**. Note le **Project URL** et la clé
   **secret** / **service_role** (jamais l'`anon`/`publishable`).

## Étape 2 — GitHub

1. Nouveau dépôt (ex. `kalima-national`), Public, rien coché.
2. Uploade tout le contenu de ce dossier (`server.js`, `package.json`, le
   dossier `public/`, `.gitignore`, ce `README.md`).
3. Commit.

## Étape 3 — Render

1. **New** → **Web Service** → connecte le dépôt `kalima-national`
2. Build Command : `npm install`
3. Start Command : `npm start`
4. Onglet **Environment** → ajoute :
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `JWT_SECRET` → une phrase secrète longue et unique, ex. un mot de passe
     aléatoire de 40 caractères (sert à signer les sessions de connexion —
     change-la et tout le monde sera déconnecté)
   - `NATIONAL_EMAIL` → l'email du président national (ex.
     `president@kalima.gn`)
   - `NATIONAL_PASSWORD` → le mot de passe initial du président national
     (à changer dès la première connexion, voir plus bas)
5. **Create Web Service**

Au premier démarrage, le serveur crée automatiquement le compte national
avec l'email et le mot de passe indiqués dans les variables d'environnement
ci-dessus (ou `national@kalima.local` / `MissionKalima2026` si tu ne les as
pas définies — dans ce cas, connecte-toi et change-les tout de suite).

## Comment tout s'articule

**Le président national** se connecte avec son compte, et depuis son
espace :
- Crée le compte de chaque président régional (un compte par région, avec
  possibilité de réinitialiser le mot de passe à tout moment)
- Fixe le montant à collecter par région (ex. 5 000 000 GNF pour la Moyenne
  Guinée)
- Voit pour chaque région : nombre d'églises, nombre de jeunes, montant
  collecté sur l'objectif
- Programme les camps : titre, dates, lieu, description, plusieurs
  orateurs avec photo, et un planning en tableau entièrement libre
  (colonnes et lignes ajoutables à volonté)
- Publie des communiqués, visibles par tous dès l'écran d'accueil
- Consulte l'annuaire national complet (tous les jeunes, toutes régions),
  imprimable
- Télécharge la liste des inscrits à un camp (fichier CSV, ouvrable dans
  Excel)

**Chaque président régional** se connecte avec le compte que le national
lui a créé, et depuis son espace :
- Crée un compte pour chaque responsable d'église de sa région (email +
  mot de passe qu'il communique lui-même à la personne)
- Voit le nombre d'églises et de jeunes de sa région, église par église
- Note les paiements de cotisation de chaque jeune (possibilité de payer
  en plusieurs fois, historique conservé) et suit la progression de sa
  région vers l'objectif national
- Imprime la liste des jeunes de sa région
- Consulte les camps programmés (lecture seule)

**Chaque responsable d'église** se connecte avec le compte que son
président régional lui a créé. À la première connexion, il crée le nom de
son église, puis saisit ses jeunes (nom, téléphone, email, fonction,
photo).

**Tout le monde**, même sans se connecter, peut voir sur l'écran
d'accueil : les communiqués nationaux, les prochains camps avec un compte
à rebours (J-N), le détail d'un camp (orateurs, planning), et s'inscrire
pour y participer.

## Sécurité — bon à savoir

- Chaque personne a son propre identifiant et mot de passe : fini le mot
  de passe partagé, chaque paiement noté et chaque jeune ajouté est
  rattaché à la personne qui l'a fait.
- Le président régional ou national peut réinitialiser un mot de passe
  oublié à tout moment depuis son espace.
- **Chaque utilisateur peut aussi changer lui-même son propre email et son
  mot de passe** depuis le bouton "⚙️ Mon compte", visible en haut de son
  espace une fois connecté. C'est ainsi que le président national peut
  remplacer les identifiants provisoires par les siens dès sa première
  connexion.
- La variable `JWT_SECRET` doit rester secrète — c'est elle qui garantit
  que personne ne peut fabriquer une fausse session de connexion.

## Liste des inscrits à un camp

Depuis la fiche d'un camp (espace national → Camps → Gérer → Inscriptions
reçues), la liste des jeunes inscrits peut être téléchargée sous deux
formats : un **PDF** prêt à imprimer ou partager tel quel, ou un fichier
**CSV** à ouvrir dans Excel pour retravailler les données.

## Lancer en local (facultatif)

```bash
npm install
SUPABASE_URL=https://xxxxx.supabase.co SUPABASE_SERVICE_KEY=xxxx JWT_SECRET=test NATIONAL_EMAIL=moi@mail.com NATIONAL_PASSWORD=motdepasse npm start
```

Puis ouvrir http://localhost:3000
