# Old Photos Restorer

Application de restauration de vieilles photos par IA. Interface web avec pipeline de traitement configurable.

## Étapes de restauration

| Étape | Modèles disponibles | Description |
|-------|---------------------|-------------|
| Recadrage | Rect / Ellipse / Perspective | Recadrage libre, elliptique ou correction de perspective |
| Retouche manuelle | LaMa (WACV 2022) | Inpainting sur masque dessiné à la main |
| Nettoyage des taches | Multi-échelle + LaMa / OpenCV | Détection multi-échelle (médian + top-hat + par canal) + inpainting |
| Suppression des rayures | BOPBTL + LaMa / OpenCV | Détection IA des rayures + inpainting |
| Restauration des visages | GFPGAN v1.4 | Amélioration et restauration des visages |
| Colorisation | DDColor, DeOldify (Artistic/Stable), Siggraph17, ECCV16 | 5 algorithmes de colorisation |
| Upscale x2 | Real-ESRGAN (Compact/x4plus/Anime/x2plus), Lanczos | Super-résolution x2 |

## Stack

- **Frontend** : Preact + Tailwind CSS v4 + esbuild
- **Backend** : Node.js Express 5
- **IA** : Python 3.12, PyTorch (GPU auto : CUDA / MPS / CPU)

## Docker (recommandé)

```bash
docker compose up -d
# → http://localhost:3001
```

Image Docker Hub : [`jmjs/oldphotos`](https://hub.docker.com/r/jmjs/oldphotos)

Les modèles IA se téléchargent automatiquement au premier job et persistent dans un volume Docker.

`compose.yml` :
```yaml
services:
  app:
    image: jmjs/oldphotos:latest
    container_name: oldphotos
    ports:
      - "3001:3001"
    environment:
      - MAX_CONCURRENT_JOBS=2          # Jobs IA en parallèle (1–4)
      - CLEANUP_INTERVAL_HOURS=2       # Fréquence du nettoyage auto
      - CLEANUP_MAX_AGE_HOURS=2        # Âge max des fichiers
      - HEARTBEAT_TIMEOUT_SECONDS=10   # Auto-stop si frontend déconnecté
    volumes:
      - oldphotos-data:/data
    restart: unless-stopped
    # GPU NVIDIA (décommenter si disponible) :
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: 1
    #           capabilities: [gpu]

volumes:
  oldphotos-data:
```

## Installation locale

```bash
# 1. Dépendances Node
npm install

# 2. Dépendances Python + modèles IA
cd ai && bash setup.sh && cd ..

# 3. Build frontend
npm run build
```

## Utilisation

```bash
npm start
# → http://localhost:3001
```

1. Glissez vos photos dans la page
2. Sélectionnez les étapes et modèles au centre
3. Lancez les jobs — résultats dans le panneau de droite
4. Comparez avant/après avec le slider (zoom molette, pan clic droit)

## Fonctionnalités

- Upload multi-fichiers + drag & drop pleine page
- Pipeline configurable : choix des étapes et modèles par étape
- File de jobs avec concurrence configurable et priorités
- Étapes manuelles (recadrage, retouche) séquencées une image à la fois
- Annulation de jobs en cours (kill du process Python)
- Retry / skip / changement de modèle sur étape échouée
- Heartbeat : arrêt automatique si le navigateur est fermé
- Galerie de résultats intermédiaires par étape
- Re-import d'un résultat comme nouvelle photo
- Nettoyage automatique des fichiers anciens

## Développement

```bash
npm run dev
```

## Structure

```
├── server/index.js           # Express API + job queue
├── src/                      # Frontend Preact
│   ├── app.tsx               # Layout principal
│   ├── components/           # Composants UI
│   ├── api.ts                # Client API
│   └── types.ts              # Types TypeScript
├── ai/                       # Scripts Python IA
│   ├── colorize_ddcolor.py   # DDColor (ICCV 2023)
│   ├── colorize_deoldify.py  # DeOldify (Artistic / Stable)
│   ├── colorize.py           # Siggraph17 / ECCV16
│   ├── restore.py            # Rayures (BOPBTL + LaMa)
│   ├── clean_spots.py        # Taches (multi-échelle + LaMa)
│   ├── face_restore.py       # Visages (GFPGAN)
│   ├── upscale.py            # Super-résolution (Real-ESRGAN)
│   ├── inpaint.py            # Inpainting manuel (LaMa)
│   ├── crop.py               # Recadrage (rect/ellipse/perspective)
│   └── auto_crop.py          # Détection auto des bords
├── Dockerfile
├── compose.yml
├── docker-entrypoint.sh
└── .github/workflows/docker.yml  # CI/CD → Docker Hub
```

## GPU

Détection automatique :
- **NVIDIA** : CUDA
- **Apple Silicon** : MPS
- **Fallback** : CPU
