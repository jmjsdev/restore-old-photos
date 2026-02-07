"""Colorize grayscale / old photos using DDColor (ICCV 2023).
Model auto-downloads on first run (~912MB from HuggingFace).

Usage: python colorize_ddcolor.py input.jpg output.jpg
"""
import sys
import os
import gc
import numpy as np
import cv2
import torch
import torch.nn.functional as F

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ddcolor import DDColor


def get_device():
    if torch.cuda.is_available():
        return torch.device('cuda')
    if torch.backends.mps.is_available():
        return torch.device('mps')
    return torch.device('cpu')


def load_model(device):
    from huggingface_hub import hf_hub_download

    model_path = hf_hub_download('piddnad/ddcolor_modelscope', 'pytorch_model.bin')

    model = DDColor(
        encoder_name='convnext-l',
        decoder_name='MultiScaleColorDecoder',
        input_size=(512, 512),
        num_output_channels=2,
        last_norm='Spectral',
        do_normalize=False,
        num_queries=100,
        num_scales=3,
        dec_layers=9,
    )

    state_dict = torch.load(model_path, map_location='cpu', weights_only=False)
    model.load_state_dict(state_dict, strict=False)
    model.to(device)
    model.eval()
    return model


def colorize(model, img_bgr, device, input_size=512):
    """Colorize a BGR image using DDColor. Returns BGR result.
    Follows the official ColorizationPipeline from piddnad/DDColor.
    """
    orig_h, orig_w = img_bgr.shape[:2]

    # Float [0,1] BGR -> get original L channel (float32 LAB: L=[0,100])
    img_f32 = (img_bgr / 255.0).astype(np.float32)
    orig_l = cv2.cvtColor(img_f32, cv2.COLOR_BGR2Lab)[:, :, :1]  # [H, W, 1]

    # Resize, extract L, build grayscale RGB for model input
    img_resized = cv2.resize(img_f32, (input_size, input_size))
    img_l = cv2.cvtColor(img_resized, cv2.COLOR_BGR2Lab)[:, :, :1]
    img_gray_lab = np.concatenate([img_l, np.zeros_like(img_l), np.zeros_like(img_l)], axis=-1)
    img_gray_rgb = cv2.cvtColor(img_gray_lab, cv2.COLOR_LAB2RGB)

    # To tensor [1, 3, H, W]
    tensor = torch.from_numpy(img_gray_rgb.transpose(2, 0, 1)).float().unsqueeze(0)

    # Run model - outputs AB channels (already in float32 LAB range)
    with torch.no_grad():
        output_ab = model(tensor.to(device)).cpu()

    # Resize AB back to original resolution
    output_ab = F.interpolate(output_ab, size=(orig_h, orig_w))[0].float().numpy().transpose(1, 2, 0)

    # Combine original L with predicted AB
    result_lab = np.concatenate([orig_l, output_ab], axis=-1)
    result_bgr = cv2.cvtColor(result_lab, cv2.COLOR_LAB2BGR)
    return (result_bgr * 255).round().clip(0, 255).astype(np.uint8)


def is_already_color(img, sat_threshold=30, pct_threshold=15, hue_std_threshold=20):
    """Detect if an image is already in color via HSV saturation + hue diversity.
    Sepia/toned photos have saturation but all on the same hue — not truly colored.
    """
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]
    colored_mask = saturation > sat_threshold
    pct_colored = colored_mask.sum() / saturation.size * 100

    # Check hue diversity among saturated pixels
    hue_std = 0.0
    if colored_mask.sum() > 100:
        hues = hsv[:, :, 0][colored_mask].astype(np.float32)
        # Circular std for hue (0-179 in OpenCV)
        hues_rad = hues * (2 * np.pi / 180)
        sin_mean = np.mean(np.sin(hues_rad))
        cos_mean = np.mean(np.cos(hues_rad))
        hue_std = np.sqrt(-2 * np.log(max(1e-10, np.sqrt(sin_mean**2 + cos_mean**2)))) * (180 / (2 * np.pi))

    print(f'Couleur: {pct_colored:.1f}% pixels saturés, diversité teinte: {hue_std:.1f}° (seuils: {pct_threshold}%, {hue_std_threshold}°)', file=sys.stderr)
    return pct_colored > pct_threshold and hue_std > hue_std_threshold


def main(input_path, output_path):
    device = get_device()
    print(f'Using device: {device}', file=sys.stderr)

    img = cv2.imread(input_path, cv2.IMREAD_COLOR)
    if img is None:
        print(f'Error: cannot read {input_path}', file=sys.stderr)
        sys.exit(1)

    if is_already_color(img):
        print('Image déjà en couleur, copie sans traitement', file=sys.stderr)
        cv2.imwrite(output_path, img)
        print(f'OK {output_path}')
        return

    print('Loading DDColor model (ICCV 2023)...', file=sys.stderr)
    model = load_model(device)

    print('Colorizing...', file=sys.stderr)
    result = colorize(model, img, device)

    cv2.imwrite(output_path, result)
    print(f'OK {output_path}')

    gc.collect()
    if device.type == 'cuda':
        torch.cuda.empty_cache()


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('Usage: python colorize_ddcolor.py <input> <output>', file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
