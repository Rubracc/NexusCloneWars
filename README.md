# Republic at War — Serveur Multijoueur v3

## Architecture

```
Navigateur Admin  ──────┐
Navigateur Joueur 1 ────┤── Socket.io ── Node.js Server ── État autoritaire
Navigateur Joueur 2 ────┘
```

**Stack :**
- **Serveur** : Node.js + Express + Socket.io
- **Client** : Phaser 3 (WebGL) + Socket.io-client
- **Rendu** : WebGL natif via Phaser → 0 lag DOM

---

## Installation

```bash
# 1. Installer les dépendances
npm install

# 2. Lancer le serveur
npm start

# Ou en mode dev (auto-restart)
npm run dev
```

---

## Accès

| URL | Rôle |
|-----|------|
| `http://localhost:3000/` | Vue joueur (lecture seule) |
| `http://localhost:3000/admin` | Panneau administrateur |

**Mot de passe admin par défaut :** `admin123`

Pour changer le mot de passe :
```bash
ADMIN_PASS=monsupermotdepasse node server/index.js
```

---

## Déploiement en ligne (gratuit)

### Render.com (recommandé)
1. Créer un compte sur render.com
2. New → Web Service → connecter ton repo GitHub
3. Build Command : `npm install`
4. Start Command : `npm start`
5. Ajouter variable d'environnement : `ADMIN_PASS=tonmotdepasse`

### Railway.app
```bash
npm install -g railway
railway login
railway init
railway up
```

---

## Fonctionnalités

### Admin (`/admin`)
- 🔐 Authentification par mot de passe
- 🌍 Carte interactive Phaser 3 (pan/zoom fluide)
- ✏️ Édition planètes en temps réel
- 🔗 Tracé de routes hyperspatiales (outil Route)
- 🌍 Création de planètes (Ctrl+clic sur la carte)
- 🚀 Déplacement de flottes (clic planète → outil Select → bouton "Déplacer")
- 🔨 Construction d'unités et bâtiments
- ⚡ Construction gratuite (cheat mode)
- 🤖 IA Séparatiste activable/désactivable
- ⚔️ Système de combat activable/désactivable
- 📢 Annonces broadcast à tous les joueurs
- 💾 Sauvegarde manuelle + auto toutes les 30s

### Joueur (`/`)
- 👁 Vue lecture seule temps réel
- 🗺️ Navigation fluide WebGL
- 📍 Clic sur planète → détail flottes/structures
- ⚔️ Bannière de combat animée
- 📢 Annonces du GM en temps réel
- 📋 Journal des événements

### Serveur
- 🔄 État autoritaire côté serveur (anti-triche)
- 💰 Revenus passifs automatiques par planète
- 🚀 Transit de flottes avec pathfinding BFS
- ⚔️ Résolution de combat automatique
- 🤖 IA Séparatiste (expand, attack, reinforce, build)
- 💾 Sauvegarde JSON automatique
- 📡 Socket.io broadcast temps réel

---

## Structure des fichiers

```
republic-at-war/
├── server/
│   ├── index.js        ← Serveur principal + Socket.io
│   ├── gameState.js    ← État de jeu + logique (combat, pathfinding, income)
│   └── ai.js           ← IA Séparatiste
├── client/
│   ├── admin.html      ← Interface admin Phaser 3
│   └── viewer.html     ← Vue joueur Phaser 3
├── save.json           ← Sauvegarde auto (créé au premier save)
└── package.json
```

---

## Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | `3000` | Port du serveur |
| `ADMIN_PASS` | `admin123` | Mot de passe admin |
