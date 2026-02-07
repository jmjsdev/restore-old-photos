"""Manual inpainting with a user-provided mask using LaMa (WACV 2022).

Usage: python inpaint.py image.jpg mask.png output.jpg

The mask should be a PNG where white (255) = zones to inpaint,
black (0) = zones to keep.
"""
import sys
import os
import numpy as np
import torch
from PIL import Image
import cv2

# Monkey-patch torch.jit.load pour forcer map_location="cpu" sur PyTorch CPU-only
# (le modèle LaMa TorchScript contient des tenseurs CUDA)
_orig_jit_load = torch.jit.load
def _patched_jit_load(*args, **kwargs):
    kwargs.setdefault('map_location', 'cpu')
    return _orig_jit_load(*args, **kwargs)
torch.jit.load = _patched_jit_load


def get_device():
    if torch.cuda.is_available():
        return torch.device('cuda')
    if torch.backends.mps.is_available():
        return torch.device('mps')
    return torch.device('cpu')


def inpaint(image_path, mask_path, output_path):
    device = get_device()
    print(f'Using device: {device}', file=sys.stderr)

    from simple_lama_inpainting import SimpleLama

    # Load image
    img = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if img is None:
        print(f'ERROR: Cannot read image {image_path}', file=sys.stderr)
        sys.exit(1)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(img_rgb)

    # Load mask and convert to grayscale
    mask = cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)
    if mask is None:
        print(f'ERROR: Cannot read mask {mask_path}', file=sys.stderr)
        sys.exit(1)

    # Resize mask to match image if needed
    h, w = img.shape[:2]
    if mask.shape[:2] != (h, w):
        mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)

    # Ensure binary mask (threshold at 128)
    mask = ((mask > 128).astype(np.uint8)) * 255

    n_pixels = np.count_nonzero(mask)
    total = mask.shape[0] * mask.shape[1]
    pct = (n_pixels / total) * 100
    print(f'Mask: {n_pixels} pixels to inpaint ({pct:.1f}% of image)', file=sys.stderr)

    if n_pixels == 0:
        print('Empty mask, copying input', file=sys.stderr)
        cv2.imwrite(output_path, img)
        print(f'OK {output_path}')
        return

    pil_mask = Image.fromarray(mask)

    print('Inpainting with LaMa...', file=sys.stderr)
    lama = SimpleLama(device=device)
    result = lama(pil_image, pil_mask)

    result_bgr = cv2.cvtColor(np.array(result), cv2.COLOR_RGB2BGR)
    cv2.imwrite(output_path, result_bgr)
    print(f'OK {output_path}')


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print('Usage: python inpaint.py <image> <mask> <output>', file=sys.stderr)
        sys.exit(1)
    inpaint(sys.argv[1], sys.argv[2], sys.argv[3])
