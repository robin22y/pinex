-- ── Academy Module 9 — BYOK Gemini explainer ──────────────────────
-- Display-only module (no quiz). Body text + comparison + safety
-- callout are rendered inline in src/pages/Academy.jsx — the row
-- below carries only the multilingual titles + the no-quiz signals
-- (total_questions = 0, pass_mark = 0). is_published = true so it
-- shows up in the modules list immediately.
--
-- Why no `content` / `module_key` / `has_quiz` / `is_active` /
-- `unlock_after` columns: the live academy_modules schema in the
-- production Supabase project uses title_<lang> columns + sort_order
-- (not module_key/module_number) and is_published (not is_active).
-- Adding new columns for one display-only module would be overkill;
-- the existing total_questions=0 already lets the frontend skip the
-- quiz path, and the id field plays the role of module_key.
--
-- Idempotent: ON CONFLICT (id) DO UPDATE refreshes the titles so a
-- copy-edit pass can re-run the script without churning audit data.

INSERT INTO academy_modules
    (id,                       sort_order, is_published, total_questions, pass_mark, icon, duration,
     title_en,
     title_hi,
     title_ml,
     title_ta,
     subtitle_en,
     subtitle_hi,
     subtitle_ml,
     subtitle_ta)
VALUES
    ('byok_gemini_explainer',  9,          TRUE,         0,                0,         '🔑', '3 min',
     'Why connect your Gemini API key?',
     'अपनी Gemini API Key क्यों जोड़ें?',
     'നിങ്ങളുടെ Gemini API Key എന്തിന് connect ചെയ്യണം?',
     'உங்கள் Gemini API Key ஏன் இணைக்க வேண்டும்?',
     'Live PineX data + Gemini intelligence = answers about TODAY',
     'PineX का लाइव डेटा + Gemini की समझ = आज के सटीक जवाब',
     'PineX ലൈവ് ഡാറ്റ + Gemini ബുദ്ധി = ഇന്നത്തെ കൃത്യമായ ഉത്തരം',
     'PineX-ன் நேரடித் தரவு + Gemini-ன் புத்திசாலி = இன்றைய சரியான பதில்')
ON CONFLICT (id) DO UPDATE
SET
    sort_order      = EXCLUDED.sort_order,
    is_published    = EXCLUDED.is_published,
    total_questions = EXCLUDED.total_questions,
    pass_mark       = EXCLUDED.pass_mark,
    icon            = EXCLUDED.icon,
    duration        = EXCLUDED.duration,
    title_en        = EXCLUDED.title_en,
    title_hi        = EXCLUDED.title_hi,
    title_ml        = EXCLUDED.title_ml,
    title_ta        = EXCLUDED.title_ta,
    subtitle_en     = EXCLUDED.subtitle_en,
    subtitle_hi     = EXCLUDED.subtitle_hi,
    subtitle_ml     = EXCLUDED.subtitle_ml,
    subtitle_ta     = EXCLUDED.subtitle_ta;
