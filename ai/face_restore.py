"""Face restoration / enhancement using GFPGAN v1.4.
Restores and enhances faces in old or damaged photos.
Model auto-downloads on first run (~330MB).

Usage: python face_restore.py input.jpg output.jpg
"""
import sys
import os
import torch
import cv2
from gfpgan import GFPGANer


def get_device():
    if torch.cuda.is_available():
        return torch.device('cuda')
    if torch.backends.mps.is_available():
        return torch.device('mps')
    return torch.device('cpu')


def main(input_path, output_path):
    device = get_device()
    print(f'Using device: {device}', file=sys.stderr)

    kwargs = dict(
        model_path='https://github.com/TencentARC/GFPGAN/releases/download/v1.3.4/GFPGANv1.4.pth',
        upscale=1,
        arch='clean',
        channel_multiplier=2,
        bg_upsampler=None,
        device=device,
    )
    model_dir = os.environ.get('GFPGAN_MODEL_DIR', None)
    if model_dir:
        # Newer GFPGAN uses model_rootpath, older uses root_dir
        import inspect
        params = inspect.signature(GFPGANer.__init__).parameters
        if 'model_rootpath' in params:
            kwargs['model_rootpath'] = model_dir
        elif 'root_dir' in params:
            kwargs['root_dir'] = model_dir
    restorer = GFPGANer(**kwargs)

    img = cv2.imread(input_path, cv2.IMREAD_COLOR)
    if img is None:
        print(f'Error: cannot read {input_path}', file=sys.stderr)
        sys.exit(1)

    _, _, output = restorer.enhance(
        img,
        has_aligned=False,
        only_center_face=False,
        paste_back=True,
    )

    cv2.imwrite(output_path, output)
    print(f'OK {output_path}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('Usage: python face_restore.py <input> <output>', file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
