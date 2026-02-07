"""Cloud AI restoration using OpenAI GPT Image.

Two-phase approach:
  1. Analyze the photo with GPT-4o vision → detailed description (4-5 lines)
  2. Build prompt (instructions + protections + description) → image edit with gpt-image-1

Steps can be combined: restore, colorize, enhance.

Requires OPENAI_API_KEY environment variable.

Usage: python restore_openai.py input.jpg output.jpg [steps]
  steps: comma-separated list of: restore, colorize, enhance (default: restore,colorize,enhance)
"""
import sys
import os
import base64
import json
import logging
from datetime import datetime
from pathlib import Path

# --- Logging setup ---

SCRIPT_DIR = Path(__file__).resolve().parent
LOG_DIR = SCRIPT_DIR.parent / 'logs'
LOG_DIR.mkdir(exist_ok=True)

log_filename = datetime.now().strftime('openai_%Y%m%d_%H%M%S.log')
logger = logging.getLogger('restore_openai')
logger.setLevel(logging.DEBUG)

fh = logging.FileHandler(LOG_DIR / log_filename, encoding='utf-8')
fh.setLevel(logging.DEBUG)
fh.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
logger.addHandler(fh)

sh = logging.StreamHandler(sys.stderr)
sh.setLevel(logging.INFO)
sh.setFormatter(logging.Formatter('%(message)s'))
logger.addHandler(sh)

# --- Prompt building blocks ---

ANALYSIS_PROMPT = """Describe this old photograph in 4-5 lines. Include:
- The people: gender, age, clothing details (type, length, style, patterns), hairstyle, pose
- The setting: location, architecture, objects, lighting
- The estimated era (decade)
Be precise and factual. Only describe what is visible."""

STEP_PROMPTS = {
    'restore': """Step — Restoration:
- Remove all scratches, stains, spots, and surface damage
- Fix torn and worn edges of the photo
- Reduce grain and noise while keeping natural film texture
- Improve contrast and tonal range
- Sharpen facial details gently
- Clean up the background without altering the scene""",

    'colorize': """Step — Colorization:
- Apply realistic, era-appropriate colors
- Skin tones should be natural and realistic
- Clothing colors should be plausible for the era — soft and natural, not bold or saturated
- Architecture and background should have natural tones
- Maintain natural sunlight and shadow tones consistent with the setting""",

    'enhance': """Step — Enhancement:
- Sharpen details, especially faces and text
- Improve overall contrast and dynamic range
- Reduce remaining noise while preserving texture""",
}


def get_mime(filepath):
    ext = os.path.splitext(filepath)[1].lower().lstrip('.')
    return {
        'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
        'png': 'image/png', 'webp': 'image/webp',
    }.get(ext, 'image/jpeg')


def analyze_photo(client, input_path):
    """Phase 1: Analyze the photo with GPT-4o vision."""
    logger.info('Phase 1 : Analyse de la photo...')
    logger.debug('Analysis prompt:\n%s', ANALYSIS_PROMPT)

    with open(input_path, 'rb') as f:
        img_b64 = base64.standard_b64encode(f.read()).decode('utf-8')
    mime = get_mime(input_path)
    logger.debug('Image size: %d bytes (base64), mime: %s', len(img_b64), mime)

    response = client.responses.create(
        model='gpt-4o',
        input=[{
            'role': 'user',
            'content': [
                {'type': 'input_text', 'text': ANALYSIS_PROMPT},
                {'type': 'input_image', 'image_url': f'data:{mime};base64,{img_b64}'},
            ],
        }],
    )

    logger.debug('Phase 1 response id: %s', getattr(response, 'id', 'N/A'))
    logger.debug('Phase 1 usage: %s', getattr(response, 'usage', 'N/A'))

    description = ''
    for i, item in enumerate(response.output):
        item_type = getattr(item, 'type', 'unknown')
        logger.debug('  output[%d] type=%s', i, item_type)
        if hasattr(item, 'text'):
            description = item.text
            break
        if hasattr(item, 'content'):
            for part in item.content:
                if hasattr(part, 'text'):
                    description += part.text

    logger.info('Description: %s', description[:200] + ('...' if len(description) > 200 else ''))
    logger.debug('Full description:\n%s', description)
    return description


def build_prompt(description, steps):
    """Build prompt: instructions + protections + description."""
    prompt = "Restore and colorize this old photograph while strictly preserving every original detail. "
    prompt += "Do NOT alter, modify, or reinterpret any element of the image — no changes to clothing, faces, poses, proportions, or background.\n\n"

    for s in steps:
        if s in STEP_PROMPTS:
            prompt += STEP_PROMPTS[s] + "\n\n"

    prompt += """CRITICAL — DO NOT:
- Extend, enlarge, shorten, or modify any clothing shape or silhouette
- Change facial features, expressions, or body proportions
- Add any elements not present in the original
- Use artistic reinterpretation or AI-generated embellishments
- Change hairstyles, poses, or composition in any way
- Crop or reframe the image

"""
    prompt += description
    return prompt


def edit_image(client, input_path, prompt):
    """Phase 2: Edit image with gpt-image-1."""
    logger.info('Phase 2 : Édition de l\'image avec gpt-image-1...')
    logger.debug('Edit prompt:\n%s', prompt)

    with open(input_path, 'rb') as img_file:
        result = client.images.edit(
            model='gpt-image-1.5',
            image=img_file,
            prompt=prompt,
            quality='high',
            output_format='png',
        )

    logger.debug('Phase 2 response: data count=%d', len(result.data))

    if result.data:
        item = result.data[0]
        logger.debug('Phase 2 result item keys: %s', [k for k in dir(item) if not k.startswith('_')])

        if hasattr(item, 'b64_json') and item.b64_json:
            logger.info('Image trouvée (b64_json, %d chars)', len(item.b64_json))
            return base64.standard_b64decode(item.b64_json)

        if hasattr(item, 'url') and item.url:
            logger.info('Image trouvée (url), téléchargement...')
            import urllib.request
            with urllib.request.urlopen(item.url) as resp:
                data = resp.read()
            logger.info('Image téléchargée: %d bytes', len(data))
            return data

    logger.error('Aucune image dans la réponse')
    return None


def main(input_path, output_path, steps_str='restore,colorize,enhance'):
    logger.info('=== Démarrage restore_openai ===')
    logger.info('Input: %s', input_path)
    logger.info('Output: %s', output_path)
    logger.info('Steps: %s', steps_str)
    logger.info('Log file: %s', LOG_DIR / log_filename)

    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        logger.error('OPENAI_API_KEY non définie')
        sys.exit(1)
    logger.debug('API key: %s...%s (%d chars)', api_key[:8], api_key[-4:], len(api_key))

    steps = [s.strip() for s in steps_str.split(',')]
    logger.info('Étapes: %s', ', '.join(steps))

    from openai import OpenAI, __version__ as openai_version
    logger.debug('openai SDK version: %s', openai_version)
    client = OpenAI(api_key=api_key)

    # Phase 1: Analyze photo with GPT-4o vision
    description = analyze_photo(client, input_path)

    # Phase 2: Build prompt + edit image with gpt-image-1
    prompt = build_prompt(description, steps)
    logger.info('Prompt construit: %d chars', len(prompt))
    logger.debug('=== PROMPT COMPLET ===\n%s\n=== FIN PROMPT ===', prompt)

    img_bytes = edit_image(client, input_path, prompt)

    if not img_bytes:
        logger.error('Aucune image générée par OpenAI')
        sys.exit(1)

    with open(output_path, 'wb') as f:
        f.write(img_bytes)
    logger.info('Image sauvegardée: %s (%d bytes)', output_path, len(img_bytes))
    print(f'OK {output_path}')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: python restore_openai.py <input> <output> [restore,colorize,enhance]', file=sys.stderr)
        sys.exit(1)
    steps = sys.argv[3] if len(sys.argv) > 3 else 'restore,colorize,enhance'
    main(sys.argv[1], sys.argv[2], steps)
