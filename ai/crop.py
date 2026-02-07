"""Crop image: rectangle, ellipse or perspective correction.

Usage:
  python crop.py input.jpg output.jpg x,y,w,h           # Rectangle crop
  python crop.py input.jpg output.jpg E:x,y,w,h          # Ellipse crop (RGBA, transparent outside)
  python crop.py input.jpg output.jpg P:x1,y1,...,x4,y4  # Perspective warp (4 corners: TL,TR,BR,BL)
"""
import sys
import numpy as np
import cv2


def crop_rect(img, crop_str):
    x, y, w, h = map(int, crop_str.split(','))
    ih, iw = img.shape[:2]
    x = max(0, min(x, iw - 1))
    y = max(0, min(y, ih - 1))
    w = max(1, min(w, iw - x))
    h = max(1, min(h, ih - y))
    print(f'Cropped to {w}x{h} at ({x},{y})', file=sys.stderr)
    return img[y:y + h, x:x + w]


def crop_perspective(img, crop_str):
    coords = list(map(float, crop_str[2:].split(',')))
    if len(coords) != 8:
        print(f'ERROR: perspective needs 8 coords, got {len(coords)}', file=sys.stderr)
        sys.exit(1)

    # Source points: TL, TR, BR, BL
    pts_src = np.float32([
        [coords[0], coords[1]],
        [coords[2], coords[3]],
        [coords[4], coords[5]],
        [coords[6], coords[7]],
    ])

    # Compute output size from quadrilateral edges
    w_top = np.linalg.norm(pts_src[1] - pts_src[0])
    w_bot = np.linalg.norm(pts_src[2] - pts_src[3])
    h_left = np.linalg.norm(pts_src[3] - pts_src[0])
    h_right = np.linalg.norm(pts_src[2] - pts_src[1])
    out_w = int(round(max(w_top, w_bot)))
    out_h = int(round(max(h_left, h_right)))

    pts_dst = np.float32([
        [0, 0],
        [out_w, 0],
        [out_w, out_h],
        [0, out_h],
    ])

    M = cv2.getPerspectiveTransform(pts_src, pts_dst)
    result = cv2.warpPerspective(img, M, (out_w, out_h), flags=cv2.INTER_LANCZOS4)
    print(f'Perspective warp to {out_w}x{out_h}', file=sys.stderr)
    return result


def crop_ellipse(img, crop_str):
    x, y, w, h = map(int, crop_str[2:].split(','))
    ih, iw = img.shape[:2]
    x = max(0, min(x, iw - 1))
    y = max(0, min(y, ih - 1))
    w = max(1, min(w, iw - x))
    h = max(1, min(h, ih - y))
    cropped = img[y:y + h, x:x + w].copy()
    # Masque elliptique : blanc à l'intérieur, noir à l'extérieur
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.ellipse(mask, (w // 2, h // 2), (w // 2, h // 2), 0, 0, 360, 255, -1)
    # Remplir l'extérieur de l'ellipse en noir
    cropped[mask == 0] = 0
    print(f'Ellipse crop to {w}x{h} at ({x},{y})', file=sys.stderr)
    return cropped


def main(input_path, output_path, crop_str):
    img = cv2.imread(input_path, cv2.IMREAD_COLOR)
    if img is None:
        print(f'ERROR: Cannot read image {input_path}', file=sys.stderr)
        sys.exit(1)

    if crop_str.startswith('P:'):
        result = crop_perspective(img, crop_str)
    elif crop_str.startswith('E:'):
        result = crop_ellipse(img, crop_str)
    else:
        result = crop_rect(img, crop_str)

    cv2.imwrite(output_path, result)
    print(f'OK {output_path}')


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print('Usage: python crop.py <input> <output> <x,y,w,h | E:x,y,w,h | P:x1,y1,...,x4,y4>', file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
