"""Colorize grayscale / old photos using Zhang et al. models.
Supports siggraph17 (default) and eccv16.
Model auto-downloads on first run (~130MB).

Usage: python colorize.py input.jpg output.jpg [siggraph17|eccv16]
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import cv2
import torch
from colorizers import siggraph17, eccv16, load_img, preprocess_img, postprocess_tens

def get_device():
    if torch.cuda.is_available():
        return torch.device('cuda')
    if torch.backends.mps.is_available():
        return torch.device('mps')
    return torch.device('cpu')

def is_already_color(img_path, sat_threshold=30, pct_threshold=15, hue_std_threshold=20):
    """Detect if an image is already in color via HSV saturation + hue diversity.
    Sepia/toned photos have saturation but all on the same hue — not truly colored.
    """
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


def main(input_path, output_path, model_name='siggraph17'):
    device = get_device()
    print(f'Using device: {device}', file=sys.stderr)

    if is_already_color(input_path):
        print('Image déjà en couleur, copie sans traitement', file=sys.stderr)
        img = cv2.imread(input_path)
        cv2.imwrite(output_path, img)
        print(f'OK {output_path}')
        return

    if model_name == 'eccv16':
        print('Loading ECCV16 colorizer...', file=sys.stderr)
        colorizer = eccv16(pretrained=True).eval().to(device)
    else:
        print('Loading Siggraph17 colorizer...', file=sys.stderr)
        colorizer = siggraph17(pretrained=True).eval().to(device)

    img = load_img(input_path)
    if img is None:
        print(f'Error: cannot read {input_path}', file=sys.stderr)
        sys.exit(1)

    tens_l_orig, tens_l_rs = preprocess_img(img, HW=(256, 256))

    with torch.no_grad():
        output = colorizer(tens_l_rs.to(device)).cpu()

    result = postprocess_tens(tens_l_orig, output)
    result_bgr = cv2.cvtColor((result * 255).astype(np.uint8), cv2.COLOR_RGB2BGR)
    cv2.imwrite(output_path, result_bgr)
    print(f'OK {output_path}')

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: python colorize.py <input> <output> [siggraph17|eccv16]', file=sys.stderr)
        sys.exit(1)
    model = sys.argv[3] if len(sys.argv) > 3 else 'siggraph17'
    main(sys.argv[1], sys.argv[2], model)
