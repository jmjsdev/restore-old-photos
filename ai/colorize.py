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

def main(input_path, output_path, model_name='siggraph17'):
    device = get_device()
    print(f'Using device: {device}', file=sys.stderr)

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
