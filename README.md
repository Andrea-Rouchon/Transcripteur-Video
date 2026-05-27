# Transcripteur Vidéo

Application Next.js qui transcrit automatiquement des vidéos YouTube ou Vimeo
en texte horodaté, en utilisant [OpenAI Whisper](https://github.com/openai/whisper)
localement (aucun envoi à un service tiers).

## Prérequis

- **Node.js** ≥ 20 (testé avec 24.10)
- **Python 3** avec `pip`
- **ffmpeg** (requis par Whisper et yt-dlp)
- Paquets Python : `openai-whisper`, `yt-dlp`

Installation des dépendances :

```bash
# Système (macOS)
brew install ffmpeg

# Node
npm install

# Python
pip install openai-whisper yt-dlp
```

Copiez ensuite `.env.example` en `.env.local` et ajustez si besoin
(modèle Whisper par défaut, timeouts, rate limit…).

## Démarrer

```bash
./start.sh
```

Ce script :

- tue les éventuels anciens serveurs Next.js,
- trouve un port libre à partir de 3000,
- lance Next.js en mode webpack (plus stable que Turbopack sur ce projet),
- attend que la page soit pré-compilée,
- ouvre automatiquement le navigateur sur la bonne URL,
- affiche les logs en direct.

La première compilation peut prendre 30 s à 2 min ; les suivantes sont
quasi instantanées grâce au cache.

## Arrêter

Dans le terminal qui exécute `./start.sh` : **`Ctrl-C`** suffit (le script
nettoie les processus enfants).

Si jamais un serveur reste bloqué en arrière-plan :

```bash
pkill -9 -f next
```

## Tests

```bash
npm test           # tests unitaires Vitest
npm run test:e2e   # tests Playwright
```

## Structure

- `app/page.tsx` — UI principale
- `app/api/transcribe/route.ts` — endpoint SSE qui orchestre téléchargement + transcription
- `scripts/download.py` — téléchargement audio via yt-dlp (YouTube/Vimeo uniquement)
- `scripts/transcribe.py` — transcription Whisper
- `start.sh` — script de démarrage fiabilisé
