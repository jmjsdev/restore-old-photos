#!/bin/bash
set -e

VENV_DIR="/data/venv"
VENV_STAMP="$VENV_DIR/.installed"
SETUP_LOG="/data/setup.log"
SETUP_ERROR="/data/setup.error"
SETUP_PID_FILE="/data/setup.pid"
REQ_FILE="/app/ai/requirements.txt"
BOPBTL_MODEL="/data/models/bopbtl/FT_Epoch_latest.pt"
BOPBTL_URL="https://huggingface.co/databuzzword/bringing-old-photos-back-to-life/resolve/main/Global/checkpoints/detection/FT_Epoch_latest.pt"

# ── Répertoires de données ────────────────────────────────────────────
mkdir -p /data/uploads /data/results /data/models/deoldify

# ── Symlinks vers le volume persistant ────────────────────────────────
ln -sfn /data/venv ai/venv
mkdir -p ai/bopbtl/Global/checkpoints/detection
ln -sf "$BOPBTL_MODEL" ai/bopbtl/Global/checkpoints/detection/FT_Epoch_latest.pt
ln -sfn /data/models/deoldify ai/models

# ── Nettoyage d'un setup précédent échoué ─────────────────────────────
# Supprimer les téléchargements partiels
rm -f "${BOPBTL_MODEL}.tmp"
# Supprimer le PID file si le process est mort
if [ -f "$SETUP_PID_FILE" ]; then
  old_pid=$(cat "$SETUP_PID_FILE" 2>/dev/null)
  if [ -n "$old_pid" ] && ! kill -0 "$old_pid" 2>/dev/null; then
    rm -f "$SETUP_PID_FILE"
  fi
fi

# ── Installation Python en arrière-plan ───────────────────────────────
setup_python() {
  # Nettoyer l'état d'erreur précédent
  rm -f "$SETUP_ERROR"

  local needs_install=false
  local TOTAL_STEPS=5

  if [ ! -f "$VENV_STAMP" ]; then
    needs_install=true
  elif ! md5sum -c "$VENV_STAMP" &>/dev/null; then
    needs_install=true
    echo "[setup 0/$TOTAL_STEPS] requirements.txt modifié, mise à jour..."
  fi

  if [ "$needs_install" = true ]; then
    echo "[setup 1/$TOTAL_STEPS] Création de l'environnement Python..."
    if [ ! -d "$VENV_DIR/bin" ]; then
      python -m venv "$VENV_DIR"
    fi
    source "$VENV_DIR/bin/activate"

    echo "[setup 2/$TOTAL_STEPS] Installation de PyTorch CPU..."
    pip install --no-cache-dir --progress-bar on \
      torch torchvision --index-url https://download.pytorch.org/whl/cpu 2>&1

    echo "[setup 3/$TOTAL_STEPS] Installation des dépendances IA (gfpgan, basicsr, realesrgan, lama, deoldify...)..."
    pip install --no-cache-dir --progress-bar on -r "$REQ_FILE" 2>&1

    echo "[setup 4/$TOTAL_STEPS] Patchs de compatibilité..."
    SITE_PKG="$VENV_DIR/lib/python3.12/site-packages"
    # basicsr: torchvision API changé
    sed -i 's/from torchvision.transforms.functional_tensor import rgb_to_grayscale/from torchvision.transforms.functional import rgb_to_grayscale/' \
      "$SITE_PKG/basicsr/data/degradations.py" 2>/dev/null || true
    # simple-lama-inpainting: le modèle TorchScript contient des tenseurs CUDA,
    # il faut forcer map_location pour charger sur CPU
    sed -i 's/torch\.jit\.load(model_path)/torch.jit.load(model_path, map_location="cpu")/' \
      "$SITE_PKG/simple_lama_inpainting/models/model.py" 2>/dev/null || true

    md5sum "$REQ_FILE" > "$VENV_STAMP"
    echo "[setup 4/$TOTAL_STEPS] ✓ Dépendances Python installées"
  else
    TOTAL_STEPS=1
  fi

  # Patchs appliqués à chaque démarrage (idempotents)
  SITE_PKG="$VENV_DIR/lib/python3.12/site-packages"
  if [ -d "$SITE_PKG" ]; then
    sed -i 's/from torchvision.transforms.functional_tensor import rgb_to_grayscale/from torchvision.transforms.functional import rgb_to_grayscale/' \
      "$SITE_PKG/basicsr/data/degradations.py" 2>/dev/null || true
    sed -i 's/torch\.jit\.load(model_path)/torch.jit.load(model_path, map_location="cpu")/' \
      "$SITE_PKG/simple_lama_inpainting/models/model.py" 2>/dev/null || true
  fi

  # Modèle BOPBTL — téléchargement dans un .tmp puis rename atomique
  if [ ! -f "$BOPBTL_MODEL" ]; then
    echo "[setup $TOTAL_STEPS/$TOTAL_STEPS] Téléchargement du modèle de détection de rayures (~441 Mo)..."
    mkdir -p "$(dirname "$BOPBTL_MODEL")"
    curl -L --progress-bar -o "${BOPBTL_MODEL}.tmp" "$BOPBTL_URL" 2>&1
    mv "${BOPBTL_MODEL}.tmp" "$BOPBTL_MODEL"
    echo "[setup $TOTAL_STEPS/$TOTAL_STEPS] ✓ Modèle BOPBTL téléchargé"
  fi

  echo "[setup done] ✓ Installation terminée — l'IA est prête"
  rm -f "$SETUP_PID_FILE"
}

# Wrapper avec gestion d'erreur
run_setup() {
  if setup_python; then
    rm -f "$SETUP_ERROR"
  else
    local exit_code=$?
    echo "[setup error] Échec de l'installation (code $exit_code)" | tee -a "$SETUP_LOG"
    echo "Échec de l'installation. Redémarrez le conteneur pour relancer." > "$SETUP_ERROR"
    rm -f "$SETUP_PID_FILE"
    # Nettoyer les fichiers partiels
    rm -f "${BOPBTL_MODEL}.tmp"
  fi
}

# ── Vérifier si le setup est nécessaire ───────────────────────────────
needs_setup=false
if [ ! -f "$VENV_STAMP" ]; then
  needs_setup=true
elif ! md5sum -c "$VENV_STAMP" &>/dev/null; then
  needs_setup=true
fi
if [ ! -f "$BOPBTL_MODEL" ]; then
  needs_setup=true
fi

if [ "$needs_setup" = true ]; then
  echo "══════════════════════════════════════════════════════════════"
  echo "  Installation IA en arrière-plan (premier démarrage)"
  echo "  Progression visible dans l'interface et dans docker logs"
  echo "══════════════════════════════════════════════════════════════"

  # tee : écrit dans le fichier ET dans stdout (docker logs)
  run_setup 2>&1 | tee "$SETUP_LOG" &
  SETUP_PID=$!
  echo "$SETUP_PID" > "$SETUP_PID_FILE"
else
  echo "✓ IA déjà installée"
  rm -f "$SETUP_ERROR"
fi

# ── Patchs de compatibilité (à chaque démarrage, idempotent) ─────────
SITE_PKG="$VENV_DIR/lib/python3.12/site-packages"
if [ -d "$SITE_PKG" ]; then
  # basicsr: API torchvision changé
  sed -i 's/from torchvision.transforms.functional_tensor import rgb_to_grayscale/from torchvision.transforms.functional import rgb_to_grayscale/' \
    "$SITE_PKG/basicsr/data/degradations.py" 2>/dev/null || true
  # simple-lama-inpainting: modèle TorchScript avec tenseurs CUDA → forcer CPU
  sed -i 's/torch\.jit\.load(model_path)/torch.jit.load(model_path, map_location="cpu")/' \
    "$SITE_PKG/simple_lama_inpainting/models/model.py" 2>/dev/null || true
fi

exec node server/index.js
