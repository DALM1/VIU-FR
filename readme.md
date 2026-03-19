```text
____   ____.___ ____ ___  _____________________
\   \ /   /|   |    |   \ \_   _____/\______   \
 \   Y   / |   |    |   /  |    __)   |       _/
  \     /  |   |    |  /   |     \    |    |   \
   \___/   |___|______/    \___  /    |____|_  /
                               \/            \/
```

![Accueil](cpt1.png)
![Détails](cpt2.png)

**VIU-FR** est une expérience de streaming d'animés directement depuis votre terminal, inspirée par [Viu](https://github.com/viu-media/viu). Il combine la puissance de l'API AniList pour les métadonnées et des scrapers optimisés pour les sources françaises.

---

## Fonctionnalités

- **Interface TUI Interactive** : Navigation fluide avec React Ink.
- **Recherche Hybride** : Résultats précis via **AniList API** (scores, synopsis, genres).
- 🇫🇷 **Sources VF/VOSTFR** : Priorité aux sources françaises via VostFree.
- 🇬🇧 **Fallback Anglais** : Recherche automatique de sources anglaises si la VF n'est pas disponible.
- **Lecteur Intégré** : Lancement instantané avec **mpv**.
- **Téléchargement** : Support de `yt-dlp` pour enregistrer vos épisodes (touche `D`).
- **Style Moderne** : Layout multi-colonnes, couleurs et ASCII art.

---

## 🚀 Installation

### Une seule étape (Recommandé)

Le script d'installation s'occupe de tout : vérification des outils (Node, Python, mpv, etc.), installation des dépendances et création de l'alias global.

```bash
chmod +x setup.sh && ./setup.sh
```

Une fois terminé, redémarrez votre terminal ou lancez `source ~/.zshrc` (ou `.bashrc`). Vous pourrez alors lancer l'app n'importe où :

```bash
viu-fr
```

### Prérequis manuels
Si le script échoue, assurez-vous d'avoir :
- **Node.js** (v16+)
- **Python 3.10+**
- **mpv** (`brew install mpv`)
- **chafa** (`brew install chafa`)
- **yt-dlp** (`brew install yt-dlp`)

---

## Utilisation

### Installation de la commande globale

Pour pouvoir lancer **viu-fr** n'importe où dans votre terminal, exécutez le script d'installation automatique :

```bash
chmod +x setup.sh && ./setup.sh
```

Une fois l'alias ajouté, redémarrez votre terminal ou lancez `source ~/.zshrc` (ou `.bashrc`). Vous pourrez alors simplement taper :

```bash
viu-fr
```

### Commandes classiques

Si vous préférez lancer manuellement depuis le dossier du projet :
```bash
npm start
```

### Commandes clavier
- `S` : Retourner à la barre de recherche.
- `Flèches` : Naviguer dans les listes.
- `Entrée` : Sélectionner un animé / Regarder un épisode.
- `D` : Télécharger l'épisode sélectionné (dans la vue des lecteurs).
- `ESC` : Retour à la vue précédente.
- `Q` / `Ctrl+C` : Quitter.

---

## Technologies

- **Frontend** : [Ink](https://github.com/vadimdemedes/ink) (React pour le CLI).
- **Backend Scraper** : Python avec `curl_cffi` (contournement Cloudflare).
- **Metadata** : [AniList GraphQL API](https://anilist.gitbook.io/anilist-api/).
- **Vidéo** : `mpv` & `yt-dlp`.

---

## Note
Ce projet est destiné à un usage personnel et éducatif uniquement. L'application n'héberge aucun contenu.

**By DALM1**
