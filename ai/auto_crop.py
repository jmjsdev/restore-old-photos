"""Auto-detect photo content bounds for cropping.
Detects the photo region within a scan (removes borders/margins).

Usage: python auto_crop.py input.jpg
  Outputs JSON: {"x":0,"y":0,"w":100,"h":100} (pixel coordinates)
"""
import sys
import json
import numpy as np
import cv2


def detect_bounds(input_path):
    img = cv2.imread(input_path, cv2.IMREAD_COLOR)
    if img is None:
        print(f'ERROR: Cannot read image {input_path}', file=sys.stderr)
        sys.exit(1)

    h, w = img.shape[:2]

    # Work on a scaled-down version for speed
    max_dim = 512
    scale = min(max_dim / w, max_dim / h, 1.0)
    if scale < 1.0:
        small = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    else:
        small = img
    sh, sw = small.shape[:2]

    # Convert to grayscale
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

    # Sample border pixels (2% thickness) to determine background color
    border = max(2, int(min(sh, sw) * 0.02))
    border_pixels = np.concatenate([
        gray[:border, :].ravel(),       # top
        gray[-border:, :].ravel(),      # bottom
        gray[:, :border].ravel(),       # left
        gray[:, -border:].ravel(),      # right
    ])
    bg_luma = float(np.median(border_pixels))
    threshold = 25

    # Per-row and per-column content ratio
    diff = np.abs(gray.astype(float) - bg_luma)
    content_mask = diff > threshold

    row_ratio = content_mask.mean(axis=1)  # shape (sh,)
    col_ratio = content_mask.mean(axis=0)  # shape (sw,)

    min_ratio = 0.10

    # Find first/last row/col with enough content
    row_indices = np.where(row_ratio > min_ratio)[0]
    col_indices = np.where(col_ratio > min_ratio)[0]

    if len(row_indices) == 0 or len(col_indices) == 0:
        # No content detected, return full image
        print(json.dumps({"x": 0, "y": 0, "w": w, "h": h}))
        return

    top = row_indices[0]
    bottom = row_indices[-1]
    left = col_indices[0]
    right = col_indices[-1]

    # Add small margin (0.5%)
    margin = max(1, int(min(sh, sw) * 0.005))
    top = max(0, top - margin)
    bottom = min(sh - 1, bottom + margin)
    left = max(0, left - margin)
    right = min(sw - 1, right + margin)

    # Scale back to original coordinates
    x = int(round(left / scale))
    y = int(round(top / scale))
    crop_w = int(round((right - left + 1) / scale))
    crop_h = int(round((bottom - top + 1) / scale))

    # Clamp
    x = max(0, min(x, w - 1))
    y = max(0, min(y, h - 1))
    crop_w = max(1, min(crop_w, w - x))
    crop_h = max(1, min(crop_h, h - y))

    print(json.dumps({"x": x, "y": y, "w": crop_w, "h": crop_h}))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python auto_crop.py <input>', file=sys.stderr)
        sys.exit(1)
    detect_bounds(sys.argv[1])
