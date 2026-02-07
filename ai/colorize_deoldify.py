"""Colorize grayscale / old photos using DeOldify (2019).
Two variants: Artistic (vibrant colors, may hallucinate) and Stable (conservative, consistent).
Models auto-download on first run (~255MB each).

Usage: python colorize_deoldify.py input.jpg output.jpg [artistic|stable]
"""
import sys
import os
import gc
import warnings
import numpy as np

warnings.filterwarnings('ignore', category=UserWarning)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, 'models')

# DeOldify model URLs (from the official repo)
MODEL_URLS = {
    'ColorizeArtistic_gen': 'https://data.deepai.org/deoldify/ColorizeArtistic_gen.pth',
    'ColorizeStable_gen': 'https://huggingface.co/spensercai/DeOldify/resolve/main/ColorizeStable_gen.pth',
}


def download_model(weights_name):
    """Download model weights if not already present."""
    model_path = os.path.join(MODELS_DIR, f'{weights_name}.pth')
    if os.path.exists(model_path):
        return

    url = MODEL_URLS.get(weights_name)
    if not url:
        print(f'ERROR: Unknown model {weights_name}', file=sys.stderr)
        sys.exit(1)

    os.makedirs(MODELS_DIR, exist_ok=True)
    print(f'Downloading {weights_name} (~255MB)...', file=sys.stderr)

    import urllib.request
    urllib.request.urlretrieve(url, model_path)
    print(f'Downloaded to {model_path}', file=sys.stderr)


def is_already_color(img_path, sat_threshold=30, pct_threshold=15, hue_std_threshold=20):
    """Detect if an image is already in color via HSV saturation + hue diversity.
    Sepia/toned photos have saturation but all on the same hue — not truly colored.
    """
    import cv2
    import numpy as np
    img = cv2.imread(img_path, cv2.IMREAD_COLOR)
    if img is None:
        return False
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]
    colored_mask = saturation > sat_threshold
    pct_colored = colored_mask.sum() / saturation.size * 100

    hue_std = 0.0
    if colored_mask.sum() > 100:
        hues = hsv[:, :, 0][colored_mask].astype(np.float32)
        hues_rad = hues * (2 * np.pi / 180)
        sin_mean = np.mean(np.sin(hues_rad))
        cos_mean = np.mean(np.cos(hues_rad))
        hue_std = np.sqrt(-2 * np.log(max(1e-10, np.sqrt(sin_mean**2 + cos_mean**2)))) * (180 / (2 * np.pi))

    print(f'Couleur: {pct_colored:.1f}% pixels saturés, diversité teinte: {hue_std:.1f}° (seuils: {pct_threshold}%, {hue_std_threshold}°)', file=sys.stderr)
    return pct_colored > pct_threshold and hue_std > hue_std_threshold


def main(input_path, output_path, variant='artistic'):
    if is_already_color(input_path):
        print('Image déjà en couleur, copie sans traitement', file=sys.stderr)
        import shutil
        shutil.copy2(input_path, output_path)
        print(f'OK {output_path}')
        return

    import torch
    from pathlib import Path

    # PyTorch 2.6+ defaults weights_only=True which breaks fastai v1 model loading.
    # Monkey-patch torch.load to use weights_only=False for DeOldify models.
    _original_torch_load = torch.load
    def _patched_load(*args, **kwargs):
        kwargs.setdefault('weights_only', False)
        return _original_torch_load(*args, **kwargs)
    torch.load = _patched_load

    # Determine device
    if torch.cuda.is_available():
        device_name = 'cuda'
    elif torch.backends.mps.is_available():
        device_name = 'mps'
    else:
        device_name = 'cpu'
    print(f'Using device: {device_name}', file=sys.stderr)

    # Configure DeOldify device before importing visualize
    from deoldify.device_id import DeviceId
    from deoldify import device as deoldify_device

    if device_name == 'cuda':
        deoldify_device.set(device=DeviceId.GPU0)
    else:
        deoldify_device.set(device=DeviceId.CPU)

    artistic = (variant == 'artistic')
    weights_name = 'ColorizeArtistic_gen' if artistic else 'ColorizeStable_gen'

    # Download model if needed
    download_model(weights_name)

    print(f'Loading DeOldify {variant} model...', file=sys.stderr)
    from deoldify.visualize import get_image_colorizer

    render_factor = 35 if artistic else 25
    colorizer = get_image_colorizer(
        root_folder=Path(SCRIPT_DIR),
        render_factor=render_factor,
        artistic=artistic,
    )

    # Colorize
    print('Colorizing...', file=sys.stderr)
    result_image = colorizer.get_transformed_image(
        path=Path(input_path),
        render_factor=render_factor,
        watermarked=False,
    )

    # Save result
    result_bgr = np.array(result_image)[:, :, ::-1]  # RGB -> BGR
    import cv2
    cv2.imwrite(output_path, result_bgr)
    print(f'OK {output_path}')

    gc.collect()
    if device_name == 'cuda':
        torch.cuda.empty_cache()


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: python colorize_deoldify.py <input> <output> [artistic|stable]', file=sys.stderr)
        sys.exit(1)
    variant = sys.argv[3] if len(sys.argv) > 3 else 'artistic'
    main(sys.argv[1], sys.argv[2], variant)
