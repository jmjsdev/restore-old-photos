"""Auto spot/stain cleaning using multi-scale detection + inpainting.

Detects small isolated defects (white spots, mold stains, dust marks, foxing)
that scratch detection models miss. Uses a combination of:
- Multi-scale median filter comparison (catches spots of different sizes)
- Morphological top-hat transforms (bright and dark anomalies)
- Adaptive local thresholding
Then inpaints detected regions with LaMa or OpenCV.

Usage: python clean_spots.py input.jpg output.jpg [lama|opencv]
"""
import sys
import os
import numpy as np
import torch

# Monkey-patch torch.jit.load pour forcer map_location="cpu" sur PyTorch CPU-only
_orig_jit_load = torch.jit.load
def _patched_jit_load(*args, **kwargs):
    kwargs.setdefault('map_location', 'cpu')
    return _orig_jit_load(*args, **kwargs)
torch.jit.load = _patched_jit_load
from PIL import Image
import cv2


def get_device():
    if torch.cuda.is_available():
        return torch.device('cuda')
    if torch.backends.mps.is_available():
        return torch.device('mps')
    return torch.device('cpu')


def detect_spots(image_path):
    """Detect spots/stains via multi-scale analysis.

    Combines:
    1. Multi-scale median filter comparison (sizes 5, 11, 21)
    2. White and black top-hat transforms for bright/dark anomalies
    3. Per-channel analysis (not just grayscale)

    Returns a binary mask (uint8, 255=spot) or None if no spots found.
    """
    img = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if img is None:
        print(f'ERROR: Cannot read image {image_path}', file=sys.stderr)
        sys.exit(1)

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    combined_mask = np.zeros((h, w), dtype=np.float32)

    # --- 1. Multi-scale median filter comparison ---
    # Different kernel sizes catch spots of different scales
    for ksize in [5, 11, 21]:
        median = cv2.medianBlur(gray, ksize)
        diff = cv2.absdiff(gray, median).astype(np.float32)
        # Normalize by local standard deviation to adapt to different image regions
        local_std = cv2.GaussianBlur(diff, (31, 31), 0) + 1.0
        normalized = diff / local_std
        combined_mask += normalized

    # --- 2. Per-channel analysis (catches colored spots that grayscale misses) ---
    for c in range(3):
        channel = img[:, :, c]
        median = cv2.medianBlur(channel, 11)
        diff = cv2.absdiff(channel, median).astype(np.float32)
        local_std = cv2.GaussianBlur(diff, (31, 31), 0) + 1.0
        combined_mask += diff / local_std * 0.5  # Lower weight for per-channel

    # --- 3. Morphological top-hat transforms ---
    # White top-hat: bright spots on dark background
    # Black top-hat: dark spots on light background
    for ksize in [7, 15]:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksize, ksize))
        tophat_white = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel)
        tophat_black = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
        combined_mask += tophat_white.astype(np.float32) / 30.0
        combined_mask += tophat_black.astype(np.float32) / 30.0

    # --- Threshold the combined score ---
    # Use adaptive thresholding based on image statistics
    mean_score = np.mean(combined_mask)
    std_score = np.std(combined_mask)
    threshold = mean_score + 2.5 * std_score
    threshold = max(threshold, 3.0)  # Minimum threshold
    print(f'Detection combinée — seuil: {threshold:.1f} (mean={mean_score:.1f}, std={std_score:.1f})', file=sys.stderr)

    binary = (combined_mask > threshold).astype(np.uint8) * 255

    # --- Filter by connected component size ---
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)

    # Adaptive max spot area based on image size
    max_spot_area = min(int(h * w * 0.005), 2000)  # 0.5% of image or 2000px max
    min_spot_area = 3  # Ignore very tiny noise

    mask = np.zeros_like(binary)
    spots_found = 0
    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        if min_spot_area <= area <= max_spot_area:
            # Additional check: aspect ratio — very elongated regions are likely edges, not spots
            comp_w = stats[i, cv2.CC_STAT_WIDTH]
            comp_h = stats[i, cv2.CC_STAT_HEIGHT]
            aspect = max(comp_w, comp_h) / (min(comp_w, comp_h) + 1)
            if aspect < 8:  # Spots are roughly circular, not long scratches
                mask[labels == i] = 255
                spots_found += 1

    n_pixels = np.count_nonzero(mask)
    total = h * w
    pct = (n_pixels / total) * 100
    print(f'Taches détectées: {spots_found} taches, {n_pixels} pixels ({pct:.2f}% de l\'image)', file=sys.stderr)

    if n_pixels == 0:
        return None

    # Dilate to ensure full coverage of spots
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.dilate(mask, kernel, iterations=1)

    return mask


def inpaint_lama(input_path, spot_mask, device):
    """High-quality inpainting with LaMa (WACV 2022)."""
    from simple_lama_inpainting import SimpleLama

    img = cv2.imread(input_path, cv2.IMREAD_COLOR)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(img_rgb)
    pil_mask = Image.fromarray(spot_mask)

    lama = SimpleLama(device=device)
    result = lama(pil_image, pil_mask)
    return cv2.cvtColor(np.array(result), cv2.COLOR_RGB2BGR)


def inpaint_opencv(input_path, spot_mask):
    """Fast inpainting with OpenCV Navier-Stokes."""
    img = cv2.imread(input_path, cv2.IMREAD_COLOR)
    return cv2.inpaint(img, spot_mask, inpaintRadius=3, flags=cv2.INPAINT_NS)


def main(input_path, output_path, inpaint_model='lama'):
    device = get_device()
    print(f'Using device: {device}', file=sys.stderr)

    # Step 1: Detect spots
    print('Détection des taches (analyse multi-échelle)...', file=sys.stderr)
    spot_mask = detect_spots(input_path)

    if spot_mask is None:
        print('Aucune tache détectée, copie de l\'entrée', file=sys.stderr)
        img = cv2.imread(input_path)
        cv2.imwrite(output_path, img)
        print(f'OK {output_path}')
        return

    # Step 2: Inpaint
    if inpaint_model == 'opencv':
        print('Inpainting avec OpenCV Navier-Stokes (rapide)...', file=sys.stderr)
        result_bgr = inpaint_opencv(input_path, spot_mask)
    else:
        print('Inpainting avec LaMa (meilleure qualité)...', file=sys.stderr)
        result_bgr = inpaint_lama(input_path, spot_mask, device)

    cv2.imwrite(output_path, result_bgr)
    print(f'OK {output_path}')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: python clean_spots.py <input> <output> [lama|opencv]', file=sys.stderr)
        sys.exit(1)
    model = sys.argv[3] if len(sys.argv) > 3 else 'lama'
    main(sys.argv[1], sys.argv[2], model)
