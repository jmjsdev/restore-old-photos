#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Old Photos AI Setup ==="
echo ""

# Find Python 3.12 or 3.11 (required for torch/basicsr compatibility)
PYTHON_BIN=""
for v in python3.12 python3.11; do
  if command -v "$v" &>/dev/null; then
    PYTHON_BIN="$v"
    break
  fi
done
if [ -z "$PYTHON_BIN" ]; then
  echo "ERROR: Python 3.11 or 3.12 required. Install with: brew install python@3.12"
  exit 1
fi
echo "Using: $PYTHON_BIN ($($PYTHON_BIN --version))"

# Create virtual environment
if [ ! -d "venv" ]; then
  echo "Creating Python virtual environment..."
  $PYTHON_BIN -m venv venv
fi

source venv/bin/activate
echo "Python: $(python --version)"

# Install dependencies
echo ""
echo "Installing AI dependencies..."
echo "This may take a few minutes on first install..."
echo ""
pip install --upgrade pip -q
pip install -r requirements.txt

# colorizers is vendored in ai/colorizers/ (from github.com/richzhang/colorization)

# Patch basicsr for torchvision >= 0.20 compat
PYTHON_VER=$($PYTHON_BIN -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
DEGRADATIONS="venv/lib/python${PYTHON_VER}/site-packages/basicsr/data/degradations.py"
if [ -f "$DEGRADATIONS" ]; then
  sed -i '' 's/from torchvision.transforms.functional_tensor import rgb_to_grayscale/from torchvision.transforms.functional import rgb_to_grayscale/' "$DEGRADATIONS"
  echo "Patched basicsr for torchvision compat"
fi

# Patch simple-lama-inpainting: le modèle TorchScript contient des tenseurs CUDA
LAMA_MODEL="venv/lib/python${PYTHON_VER}/site-packages/simple_lama_inpainting/models/model.py"
if [ -f "$LAMA_MODEL" ]; then
  sed -i '' 's/torch\.jit\.load(model_path)/torch.jit.load(model_path, map_location="cpu")/' "$LAMA_MODEL"
  echo "Patched simple-lama-inpainting for CPU compat"
fi

# Download scratch detection model (Microsoft BOPBTL)
DETECTION_DIR="bopbtl/Global/checkpoints/detection"
DETECTION_MODEL="$DETECTION_DIR/FT_Epoch_latest.pt"
if [ ! -f "$DETECTION_MODEL" ]; then
  echo "Downloading scratch detection model (~441MB)..."
  mkdir -p "$DETECTION_DIR"
  curl -L -o "$DETECTION_MODEL" \
    "https://huggingface.co/databuzzword/bringing-old-photos-back-to-life/resolve/main/Global/checkpoints/detection/FT_Epoch_latest.pt"
  echo "  [OK] Scratch detection model downloaded"
else
  echo "  [OK] Scratch detection model already present"
fi

# Pre-download models
echo ""
echo "Pre-downloading AI models..."
echo ""

python -c "
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath('.')))
sys.path.insert(0, '.')
from colorizers import siggraph17
m = siggraph17(pretrained=True)
print('  [OK] Colorization model (siggraph17) downloaded')
"

python -c "
from simple_lama_inpainting import SimpleLama
print('  [OK] LaMa inpainting model loaded')
"

python -c "
from gfpgan import GFPGANer
print('  [OK] GFPGAN loaded (model downloads on first job)')
"

python -c "
from basicsr.archs.rrdbnet_arch import RRDBNet
from realesrgan import RealESRGANer
print('  [OK] Real-ESRGAN loaded (model downloads on first job)')
"

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Run: npm run build && npm start"
