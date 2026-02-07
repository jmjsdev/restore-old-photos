"""Scratch/damage removal using Microsoft's trained scratch detection model + LaMa inpainting.

Step 1: Detect scratches using a trained UNet from Microsoft's
        "Bringing Old Photos Back to Life" (CVPR 2020)
Step 2: If scratches are found, inpaint with LaMa (WACV 2022)

Models auto-download on first run (~200MB LaMa + ~25MB detection).

Usage: python restore.py input.jpg output.jpg
"""
import sys
import os
import gc
import numpy as np
import torch

# Monkey-patch torch.jit.load pour forcer map_location="cpu" sur PyTorch CPU-only
_orig_jit_load = torch.jit.load
def _patched_jit_load(*args, **kwargs):
    kwargs.setdefault('map_location', 'cpu')
    return _orig_jit_load(*args, **kwargs)
torch.jit.load = _patched_jit_load
import torch.nn.functional as F
import torchvision as tv
from PIL import Image
import cv2

# Add bopbtl/Global to path for the detection model
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GLOBAL_DIR = os.path.join(SCRIPT_DIR, 'bopbtl', 'Global')
sys.path.insert(0, GLOBAL_DIR)

from detection_models import networks


def get_device():
    if torch.cuda.is_available():
        return torch.device('cuda')
    if torch.backends.mps.is_available():
        return torch.device('mps')
    return torch.device('cpu')


def detect_scratches_ai(image_path, device):
    """Use Microsoft's trained UNet to detect scratches in the image.
    Returns a binary mask (numpy uint8, 255=scratch) or None if no scratches found.
    """
    checkpoint_path = os.path.join(GLOBAL_DIR, 'checkpoints', 'detection', 'FT_Epoch_latest.pt')
    if not os.path.exists(checkpoint_path):
        print('WARNING: Scratch detection model not found, skipping', file=sys.stderr)
        return None

    # Load model
    model = networks.UNet(
        in_channels=1,
        out_channels=1,
        depth=4,
        conv_num=2,
        wf=6,
        padding=True,
        batch_norm=True,
        up_mode='upsample',
        with_tanh=False,
        sync_bn=True,
        antialiasing=True,
    )

    checkpoint = torch.load(checkpoint_path, map_location='cpu', weights_only=False)
    model.load_state_dict(checkpoint['model_state'])
    model.to(device)
    model.eval()

    # Load and preprocess image
    img = Image.open(image_path).convert('RGB')
    orig_w, orig_h = img.size

    # Resize to multiple of 16 (scale_256 mode)
    if orig_w < orig_h:
        new_w = 256
        new_h = orig_h / orig_w * 256
    else:
        new_h = 256
        new_w = orig_w / orig_h * 256
    new_h = int(round(new_h / 16) * 16)
    new_w = int(round(new_w / 16) * 16)

    img_resized = img.resize((new_w, new_h), Image.BICUBIC)
    img_gray = img_resized.convert('L')

    # To tensor + normalize
    tensor = tv.transforms.ToTensor()(img_gray)
    tensor = tv.transforms.Normalize([0.5], [0.5])(tensor)
    tensor = tensor.unsqueeze(0)  # batch dim

    # Scale for model input
    _, _, th, tw = tensor.shape
    if tw < th:
        scale_w = 256
        scale_h = th / tw * 256
    else:
        scale_h = 256
        scale_w = tw / th * 256
    scale_h = int(round(scale_h / 16) * 16)
    scale_w = int(round(scale_w / 16) * 16)
    tensor_scaled = F.interpolate(tensor, [scale_h, scale_w], mode='bilinear', align_corners=False)

    # Run detection
    with torch.no_grad():
        tensor_scaled = tensor_scaled.to(device)
        prediction = torch.sigmoid(model(tensor_scaled))

    prediction = prediction.data.cpu()
    # Resize back to resized image dimensions
    prediction = F.interpolate(prediction, [new_h, new_w], mode='nearest')

    # Threshold at 0.4 (same as Microsoft's code)
    mask_resized = (prediction.squeeze().numpy() >= 0.4).astype(np.uint8) * 255

    # Resize mask back to original image dimensions
    mask_original = cv2.resize(mask_resized, (orig_w, orig_h), interpolation=cv2.INTER_NEAREST)

    # Dilate slightly to ensure full scratch coverage
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask_original = cv2.dilate(mask_original, kernel, iterations=1)

    gc.collect()
    if device.type == 'cuda':
        torch.cuda.empty_cache()

    return mask_original


def inpaint_lama(input_path, scratch_mask, device):
    """High-quality inpainting with LaMa (WACV 2022)."""
    from simple_lama_inpainting import SimpleLama

    img = cv2.imread(input_path, cv2.IMREAD_COLOR)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(img_rgb)
    pil_mask = Image.fromarray(scratch_mask)

    lama = SimpleLama(device=device)
    result = lama(pil_image, pil_mask)
    return cv2.cvtColor(np.array(result), cv2.COLOR_RGB2BGR)


def inpaint_opencv(input_path, scratch_mask):
    """Fast inpainting with OpenCV Navier-Stokes."""
    img = cv2.imread(input_path, cv2.IMREAD_COLOR)
    return cv2.inpaint(img, scratch_mask, inpaintRadius=3, flags=cv2.INPAINT_NS)


def main(input_path, output_path, inpaint_model='lama'):
    device = get_device()
    print(f'Using device: {device}', file=sys.stderr)

    # Step 1: AI scratch detection
    print('Detecting scratches (Microsoft BOPBTL model)...', file=sys.stderr)
    scratch_mask = detect_scratches_ai(input_path, device)

    if scratch_mask is None:
        img = cv2.imread(input_path)
        cv2.imwrite(output_path, img)
        print(f'OK {output_path}')
        return

    n_pixels = np.count_nonzero(scratch_mask)
    total = scratch_mask.shape[0] * scratch_mask.shape[1]
    pct = (n_pixels / total) * 100
    print(f'Scratches detected: {n_pixels} pixels ({pct:.1f}% of image)', file=sys.stderr)

    if n_pixels == 0 or pct < 0.1:
        print('No significant scratches detected, copying input', file=sys.stderr)
        img = cv2.imread(input_path)
        cv2.imwrite(output_path, img)
        print(f'OK {output_path}')
        return

    # Step 2: Inpaint
    if inpaint_model == 'opencv':
        print('Inpainting with OpenCV Navier-Stokes (fast)...', file=sys.stderr)
        result_bgr = inpaint_opencv(input_path, scratch_mask)
    else:
        print('Inpainting with LaMa (best quality)...', file=sys.stderr)
        result_bgr = inpaint_lama(input_path, scratch_mask, device)

    cv2.imwrite(output_path, result_bgr)
    print(f'OK {output_path}')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: python restore.py <input> <output> [lama|opencv]', file=sys.stderr)
        sys.exit(1)
    model = sys.argv[3] if len(sys.argv) > 3 else 'lama'
    main(sys.argv[1], sys.argv[2], model)
