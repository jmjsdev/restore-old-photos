"""Upscale images using Real-ESRGAN variants or fast alternatives.
Models auto-download on first run.

Usage: python upscale.py input.jpg output.jpg [model] [scale]
  model: x4plus (default), x4plus-anime, x2plus, ultrasharp, ultramix, compact, lanczos
  scale: 2 or 4 (default: 2)
"""
import sys
import os
import time
import cv2
import numpy as np


def get_device():
    import torch
    if torch.cuda.is_available():
        return torch.device('cuda')
    if torch.backends.mps.is_available():
        return torch.device('mps')
    return torch.device('cpu')


# ---- Fast non-AI upscale ----

def upscale_lanczos(input_path, output_path, outscale):
    img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        print(f'Error: cannot read {input_path}', file=sys.stderr)
        sys.exit(1)
    h, w = img.shape[:2]
    new_w, new_h = int(w * outscale), int(h * outscale)
    print(f'Lanczos upscale {w}x{h} -> {new_w}x{new_h}', file=sys.stderr)
    output = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
    cv2.imwrite(output_path, output)
    print(f'OK {output_path}')


# ---- Real-ESRGAN models (RRDBNet architecture) ----

RRDB_MODELS = {
    'x4plus': {
        'url': 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth',
        'scale': 4,
        'num_block': 23,
        'num_feat': 64,
        'num_grow_ch': 32,
    },
    'x4plus-anime': {
        'url': 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth',
        'scale': 4,
        'num_block': 6,
        'num_feat': 64,
        'num_grow_ch': 32,
    },
    'x2plus': {
        'url': 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth',
        'scale': 2,
        'num_block': 23,
        'num_feat': 64,
        'num_grow_ch': 32,
    },
}


def compute_tile_size(img, device, num_block):
    """Pick tile size based on image size and available GPU memory."""
    h, w = img.shape[:2]
    pixels = h * w

    if device.type == 'cuda':
        import torch
        mem_gb = torch.cuda.get_device_properties(device).total_mem / (1024**3)
        if mem_gb >= 8:
            tile = 512 if pixels > 1024*1024 else 0
        else:
            tile = 400 if pixels > 512*512 else 0
    elif device.type == 'mps':
        # MPS: conservative tiling, heavy models need smaller tiles
        tile = 320 if num_block >= 23 else 400
        if pixels <= 512*512:
            tile = 0
    else:
        # CPU: always tile to limit RAM usage
        tile = 256 if pixels > 256*256 else 0

    return tile


def upscale_rrdb(input_path, output_path, model_name, outscale):
    import torch
    from basicsr.archs.rrdbnet_arch import RRDBNet
    from realesrgan import RealESRGANer

    device = get_device()
    cfg = RRDB_MODELS[model_name]

    # Half precision: CUDA only (MPS doesn't support half for this arch)
    use_half = device.type == 'cuda'

    print(f'Device: {device} | Model: {model_name} | Half: {use_half}', file=sys.stderr)

    model = RRDBNet(
        num_in_ch=3, num_out_ch=3,
        num_feat=cfg['num_feat'],
        num_block=cfg['num_block'],
        num_grow_ch=cfg['num_grow_ch'],
        scale=cfg['scale'],
    )

    img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        print(f'Error: cannot read {input_path}', file=sys.stderr)
        sys.exit(1)

    tile = compute_tile_size(img, device, cfg['num_block'])
    print(f'Image: {img.shape[1]}x{img.shape[0]} | Tile: {tile or "full"}', file=sys.stderr)

    upsampler = RealESRGANer(
        scale=cfg['scale'],
        model_path=cfg['url'],
        model=model,
        tile=tile,
        tile_pad=10,
        pre_pad=0,
        half=use_half,
        device=device,
    )

    t0 = time.time()
    output, _ = upsampler.enhance(img, outscale=outscale)
    elapsed = time.time() - t0
    print(f'Done in {elapsed:.1f}s -> {output.shape[1]}x{output.shape[0]}', file=sys.stderr)

    cv2.imwrite(output_path, output)
    print(f'OK {output_path}')

    # Free GPU memory
    del upsampler, model
    if device.type == 'cuda':
        torch.cuda.empty_cache()
    elif device.type == 'mps':
        torch.mps.empty_cache()


# ---- Real-ESRGAN Compact (ESRGAN-lite, ~5x faster) ----

def upscale_compact(input_path, output_path, outscale):
    """Real-ESRGAN compact model (SRVGGNetCompact) - much faster, decent quality."""
    import torch
    from realesrgan import RealESRGANer

    device = get_device()
    use_half = device.type == 'cuda'
    print(f'Device: {device} | Model: compact (SRVGGNet) | Half: {use_half}', file=sys.stderr)

    # SRVGGNetCompact - need to import from realesrgan
    from realesrgan.archs.srvgg_arch import SRVGGNetCompact

    model = SRVGGNetCompact(
        num_in_ch=3, num_out_ch=3,
        num_feat=64, num_conv=32,
        upscale=4, act_type='prelu',
    )

    img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        print(f'Error: cannot read {input_path}', file=sys.stderr)
        sys.exit(1)

    h, w = img.shape[:2]
    tile = 0 if (h * w) <= 1024*1024 else 400
    print(f'Image: {w}x{h} | Tile: {tile or "full"}', file=sys.stderr)

    upsampler = RealESRGANer(
        scale=4,
        model_path='https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth',
        model=model,
        tile=tile,
        tile_pad=10,
        pre_pad=0,
        half=use_half,
        device=device,
    )

    t0 = time.time()
    output, _ = upsampler.enhance(img, outscale=outscale)
    elapsed = time.time() - t0
    print(f'Done in {elapsed:.1f}s -> {output.shape[1]}x{output.shape[0]}', file=sys.stderr)

    cv2.imwrite(output_path, output)
    print(f'OK {output_path}')

    del upsampler, model
    if device.type == 'cuda':
        torch.cuda.empty_cache()
    elif device.type == 'mps':
        torch.mps.empty_cache()


# ---- Main ----

def main(input_path, output_path, model_name='x4plus', outscale=2):
    if model_name == 'lanczos':
        upscale_lanczos(input_path, output_path, outscale)
    elif model_name == 'compact':
        upscale_compact(input_path, output_path, outscale)
    elif model_name in RRDB_MODELS:
        upscale_rrdb(input_path, output_path, model_name, outscale)
    else:
        all_models = list(RRDB_MODELS.keys()) + ['compact', 'lanczos']
        print(f'Unknown model: {model_name}, available: {all_models}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: python upscale.py <input> <output> [model] [scale]', file=sys.stderr)
        sys.exit(1)
    model_name = sys.argv[3] if len(sys.argv) > 3 else 'x4plus'
    outscale = int(sys.argv[4]) if len(sys.argv) > 4 else 2
    main(sys.argv[1], sys.argv[2], model_name, outscale)
