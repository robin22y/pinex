"""
PineX Academy Content Generator
================================
Reads English module content from JSON
Translates to Hindi, Malayalam, Tamil
via Gemini with style-specific prompts
Inserts into Supabase academy tables

Usage:
  python generate_academy_module.py \
    --module module2_moving_average

  python generate_academy_module.py \
    --all

  python generate_academy_module.py \
    --module module2_moving_average \
    --skip-translation  (use English only)

  python generate_academy_module.py \
    --module module2_moving_average \
    --lang hi  (translate one language)
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import time
from pathlib import Path

from google import genai
from google.genai import types
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(
    Path(__file__).parent.parent / '.env')

SUPABASE_URL = os.environ.get(
    'SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get(
    'SUPABASE_SERVICE_KEY', '')
GEMINI_API_KEY = os.environ.get(
    'GEMINI_API_KEY', '')

supabase = create_client(
    SUPABASE_URL, SUPABASE_KEY)

gemini_client = genai.Client(
    api_key=GEMINI_API_KEY)
GEMINI_MODEL = 'gemini-2.5-flash'

CONTENT_DIR = Path(__file__).parent / \
    'content'
IMAGES_DIR = Path(__file__).parent / 'images'

# ─────────────────────────────────────
# Style prompts per language
# ─────────────────────────────────────

STYLE_PROMPTS = {
    'hi': """You are translating financial 
education content into Hindi.

Style guide:
- Use Hindustani style — conversational,
  clear, accessible to retail investors
- Mix Hindi and common English financial 
  terms naturally (Stage 2, Moving Average,
  Breakout etc. can stay in English)
- Avoid overly formal or bookish Hindi
- Use short sentences
- Keep → bullet points exactly as is
- Do NOT translate: Stage 1/2/3/4, 
  SwingX, PineX, Nifty, NSE, RS, VIX,
  Moving Average, Breakout, Weinstein
- Translate everything else naturally

Translate this text to Hindi:
""",

    'ml': """You are translating financial 
education content into Malayalam.

Style guide:
- Use Malayala Manorama style —
  the most widely read Malayalam newspaper
- Clear, educated, but not overly academic
- Warm and accessible tone
- Mix Malayalam naturally with English 
  technical terms where Malayalam readers
  would expect them
- Keep → bullet points exactly as is
- Do NOT translate: Stage 1/2/3/4,
  SwingX, PineX, Nifty, NSE, RS, VIX,
  Moving Average, Breakout, Weinstein
- Financial terms can stay in English
  with Malayalam explanation if needed

Translate this text to Malayalam:
""",

    'ta': """You are translating financial 
education content into Tamil.

Style guide:
- Use The Hindu Tamil style —
  educated, clear, trustworthy tone
- Accessible to Tamil retail investors
- Mix Tamil naturally with English 
  technical terms
- Keep → bullet points exactly as is
- Do NOT translate: Stage 1/2/3/4,
  SwingX, PineX, Nifty, NSE, RS, VIX,
  Moving Average, Breakout, Weinstein
- Use standard Tamil financial vocabulary
  where it exists

Translate this text to Tamil:
""",
}

OPTION_STYLE_PROMPTS = {
    'hi': """Translate these quiz answer 
options to Hindi. Keep Stage 1/2/3/4, 
SwingX, PineX, technical terms in English.
Short, clear options only.
Return ONLY a JSON array of 4 strings.

Options to translate:
""",
    'ml': """Translate these quiz answer 
options to Malayalam (Manorama style). 
Keep Stage 1/2/3/4, SwingX, PineX, 
technical terms in English.
Short, clear options only.
Return ONLY a JSON array of 4 strings.

Options to translate:
""",
    'ta': """Translate these quiz answer 
options to Tamil (The Hindu style). 
Keep Stage 1/2/3/4, SwingX, PineX, 
technical terms in English.
Short, clear options only.
Return ONLY a JSON array of 4 strings.

Options to translate:
""",
}


def translate(text: str, lang: str,
              is_options: bool = False,
              retries: int = 3) -> str:
    """Translate text to target language
    using Gemini with style prompt."""

    if lang == 'en':
        return text

    prompt_prefix = (
        OPTION_STYLE_PROMPTS[lang]
        if is_options
        else STYLE_PROMPTS[lang]
    )

    for attempt in range(retries):
        try:
            response = gemini_client\
                .models.generate_content(
                    model=GEMINI_MODEL,
                    contents=prompt_prefix +
                             '\n\n' + text,
                    # WHY: max_output_tokens was 2000
                    # — lessons with 4+ paragraphs got
                    # truncated mid-sentence in Hindi /
                    # Malayalam (which produce more
                    # tokens per char than English).
                    # 8192 covers the longest lesson
                    # we've authored with headroom.
                    config=types
                        .GenerateContentConfig(
                            temperature=0.3,
                            max_output_tokens=8192,
                        )
                )
            result = response.text.strip()

            # Clean markdown backticks
            if result.startswith('```'):
                lines = result.split('\n')
                result = '\n'.join(
                    lines[1:-1]
                    if lines[-1] == '```'
                    else lines[1:]
                ).strip()

            return result

        except Exception as e:
            print(f'    Translation error '
                  f'(attempt {attempt+1}): {e}')
            if attempt < retries - 1:
                time.sleep(2 ** attempt)

    print(f'    WARNING: Translation failed '
          f'for {lang}, using English')
    return text


def upload_lesson_image(
    module_id: str,
    lesson_order: int,
    filename: str,
) -> str | None:
    """Upload a lesson image to Supabase
    Storage bucket 'academy'.
    Returns public URL or None."""

    if not filename:
        return None

    image_path = IMAGES_DIR / filename
    if not image_path.exists():
        print(f'    ⚠ Image not found: '
              f'{image_path}')
        return None

    storage_path = (
        f'lessons/{module_id}/'
        f'lesson{lesson_order}_'
        f'{filename}'
    )

    mime_type = (
        mimetypes.guess_type(filename)[0]
        or 'image/png'
    )

    try:
        with open(image_path, 'rb') as f:
            image_bytes = f.read()

        # Upload — upsert so re-runs
        # don't fail on existing files
        supabase.storage\
            .from_('academy')\
            .upload(
                storage_path,
                image_bytes,
                file_options={
                    'content-type': mime_type,
                    'upsert': 'true',
                }
            )

        # Get public URL
        public_url = supabase.storage\
            .from_('academy')\
            .get_public_url(storage_path)

        return public_url

    except Exception as e:
        print(f'    Image upload error: {e}')
        return None


def translate_options(
        options: list[str],
        lang: str) -> list[str]:
    """Translate quiz options as a batch."""
    
    if lang == 'en':
        return options
    
    options_text = json.dumps(
        options, ensure_ascii=False)
    
    result = translate(
        options_text, lang,
        is_options=True)
    
    try:
        translated = json.loads(result)
        if (isinstance(translated, list) and
                len(translated) == 4):
            return translated
    except Exception:
        pass
    
    print(f'    WARNING: Options parse '
          f'failed for {lang}, '
          f'using English')
    return options


def process_module(
        module_file: Path,
        langs: list[str],
        dry_run: bool = False) -> None:
    """Process one module file — 
    translate and insert into Supabase."""
    
    print(f'\n{"="*50}')
    print(f'Processing: {module_file.name}')
    print(f'Languages: {langs}')
    print(f'{"="*50}')
    
    with open(module_file, 'r',
              encoding='utf-8') as f:
        data = json.load(f)
    
    module_id = data['id']
    
    # ── 1. Insert/upsert module ──────
    print(f'\n📚 Module: {data["title"]}')
    
    module_record = {
        'id': module_id,
        'title_en': data['title'],
        'subtitle_en': data.get(
            'subtitle', ''),
        'icon': data.get('icon', '📊'),
        'duration': data.get(
            'duration', '5 min'),
        'sort_order': data.get(
            'sort_order', 99),
        'is_published': True,
        'pass_mark': data.get(
            'pass_mark', 4),
        'total_questions': len(
            data.get('questions', [])),
    }
    
    # Translate module title and subtitle
    for lang in langs:
        if lang == 'en':
            continue
        print(f'  Translating title → {lang}')
        module_record[f'title_{lang}'] = \
            translate(data['title'], lang)
        module_record[f'subtitle_{lang}'] = \
            translate(
                data.get('subtitle', ''),
                lang)
        time.sleep(0.5)
    
    if not dry_run:
        supabase.table('academy_modules')\
            .upsert(module_record,
                    on_conflict='id')\
            .execute()
        print(f'  ✅ Module record saved')
    else:
        print(f'  [DRY RUN] Would save module')
    
    # ── 2. Process lessons ───────────
    print(f'\n📖 Processing '
          f'{len(data["lessons"])} lessons...')
    
    # Delete existing lessons 
    # (will re-insert fresh)
    if not dry_run:
        supabase.table('academy_lessons')\
            .delete()\
            .eq('module_id', module_id)\
            .execute()
    
    for lesson in data['lessons']:
        print(f'\n  Lesson {lesson["sort_order"]}: '
              f'{lesson["title"]}')
        
        lesson_record = {
            'module_id': module_id,
            'sort_order': lesson['sort_order'],
            'title': lesson['title'],
            'content_en': lesson['content'],
            'visual_type': lesson.get(
                'visual_type', 'none'),
            'visual_chart_type': lesson.get(
                'visual_chart_type'),
            'is_published': True,
        }

        # Handle image upload
        img_filename = lesson.get(
            'visual_image_filename')
        caption_en = lesson.get(
            'visual_caption', '')

        if img_filename and not dry_run:
            print(
                f'    Uploading image: '
                f'{img_filename}...',
                end='', flush=True)
            img_url = upload_lesson_image(
                module_id,
                lesson['sort_order'],
                img_filename,
            )
            if img_url:
                lesson_record[
                    'visual_image_url'] = img_url
                lesson_record[
                    'visual_type'] = 'image'
                print(' uploaded')
            else:
                print(' skipped')

        if caption_en:
            lesson_record[
                'visual_caption_en'] = caption_en

        # Translate content
        for lang in langs:
            if lang == 'en':
                continue
            print(f'    Translating content '
                  f'→ {lang}...',
                  end='', flush=True)
            lesson_record[
                f'content_{lang}'] = \
                translate(
                    lesson['content'], lang)
            print(' ✓')
            time.sleep(1)

            # Caption translation
            if caption_en:
                print(
                    f'    Translating caption '
                    f'→ {lang}...',
                    end='', flush=True)
                lesson_record[
                    f'visual_caption_{lang}'] = \
                    translate(caption_en, lang)
                print(' ✓')
                time.sleep(0.5)

        if not dry_run:
            supabase.table('academy_lessons')\
                .insert(lesson_record)\
                .execute()
            print(f'    ✅ Lesson saved')
        else:
            print(f'    [DRY RUN] Would save')
    
    # ── 3. Process questions ─────────
    print(f'\n❓ Processing '
          f'{len(data["questions"])} questions...')
    
    # Delete existing questions
    if not dry_run:
        supabase.table('academy_questions')\
            .delete()\
            .eq('module_id', module_id)\
            .execute()
    
    for q in data['questions']:
        print(f'\n  Q{q["sort_order"]}: '
              f'{q["question"][:50]}...')
        
        q_record = {
            'module_id': module_id,
            'sort_order': q['sort_order'],
            'question_en': q['question'],
            'option1_en': q['options'][0],
            'option2_en': q['options'][1],
            'option3_en': q['options'][2],
            'option4_en': q['options'][3],
            'correct_option': 
                q['correct'] + 1,
            # Convert 0-indexed to 1-indexed
            'explanation_en': 
                q['explanation'],
            'is_published': True,
        }
        
        # Translate question and explanation
        for lang in langs:
            if lang == 'en':
                continue
            
            print(f'    Translating Q → '
                  f'{lang}...',
                  end='', flush=True)
            q_record[f'question_{lang}'] = \
                translate(q['question'], lang)
            print(' ✓')
            time.sleep(0.5)
            
            print(f'    Translating options '
                  f'→ {lang}...',
                  end='', flush=True)
            translated_opts = \
                translate_options(
                    q['options'], lang)
            q_record[f'option1_{lang}'] = \
                translated_opts[0]
            q_record[f'option2_{lang}'] = \
                translated_opts[1]
            q_record[f'option3_{lang}'] = \
                translated_opts[2]
            q_record[f'option4_{lang}'] = \
                translated_opts[3]
            print(' ✓')
            time.sleep(0.5)
            
            print(f'    Translating explanation '
                  f'→ {lang}...',
                  end='', flush=True)
            q_record[f'explanation_{lang}'] = \
                translate(
                    q['explanation'], lang)
            print(' ✓')
            time.sleep(0.5)
        
        if not dry_run:
            supabase.table(
                'academy_questions')\
                .insert(q_record)\
                .execute()
            print(f'    ✅ Question saved')
        else:
            print(f'    [DRY RUN] Would save')
    
    print(f'\n✅ Module {module_id} complete!')


def main() -> None:
    parser = argparse.ArgumentParser(
        description='PineX Academy '
                    'Content Generator')
    
    parser.add_argument(
        '--module',
        type=str,
        help='Module file name '
             '(e.g. module2_moving_average)')
    
    parser.add_argument(
        '--all',
        action='store_true',
        help='Process all module files')
    
    parser.add_argument(
        '--lang',
        type=str,
        default=None,
        help='Translate specific language '
             'only: hi, ml, ta')
    
    parser.add_argument(
        '--skip-translation',
        action='store_true',
        help='Skip translation, '
             'insert English only')
    
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would happen '
             'without inserting')
    
    args = parser.parse_args()
    
    # Determine languages
    if args.skip_translation:
        langs = ['en']
    elif args.lang:
        langs = ['en', args.lang]
    else:
        langs = ['en', 'hi', 'ml', 'ta']
    
    # Find files to process
    if args.all:
        files = sorted(
            CONTENT_DIR.glob('module*.json'))
        if not files:
            print('No module JSON files '
                  f'found in {CONTENT_DIR}')
            sys.exit(1)
    elif args.module:
        # Accept with or without .json
        name = args.module
        if not name.endswith('.json'):
            name += '.json'
        f = CONTENT_DIR / name
        if not f.exists():
            print(f'File not found: {f}')
            print(f'Available files:')
            for ff in CONTENT_DIR.glob(
                    '*.json'):
                print(f'  {ff.name}')
            sys.exit(1)
        files = [f]
    else:
        parser.print_help()
        sys.exit(1)
    
    print(f'PineX Academy Generator')
    print(f'Files to process: '
          f'{len(files)}')
    print(f'Languages: {langs}')
    print(f'Dry run: {args.dry_run}')
    
    for file in files:
        process_module(
            file, langs, args.dry_run)
        if len(files) > 1:
            print('\nWaiting 2s before '
                  'next module...')
            time.sleep(2)
    
    print(f'\n🎉 All done!')
    print(f'Modules processed: '
          f'{len(files)}')


if __name__ == '__main__':
    main()