-- ── Add BYOK hybrid-model routing rows to ai_config ───────────────────
-- Two new admin-editable model configs feed the Research Assistant's
-- task router (src/components/ResearchAssistant.jsx :: getModelForTask):
--
--   gemini_simple_model   — used for Tier 1 summaries, "❓ Explain"
--                           chips, freeform follow-ups, blueprint
--                           checks. Cheapest tier with the largest
--                           free RPD allowance.
--   gemini_complex_model  — used for "📊 Full analysis" chips, the
--                           full company-overview profile, "🌐"
--                           translation chips, runCompare, the
--                           handleTranslate language-pill flow.
--                           Better reasoning + Indic-script quality.
--
-- Defaults match what was hardcoded before the router:
--   simple   → gemini-2.5-flash-lite
--   complex  → gemini-2.5-flash
--
-- Idempotent — ON CONFLICT (config_key) DO UPDATE refreshes the value
-- + timestamp without churning the existing row's audit history. Safe
-- to re-apply.
--
-- Run in the Supabase SQL editor.

INSERT INTO ai_config
    (config_key,           config_value,           display_name,                description,                                                                                              category)
VALUES
    ('gemini_simple_model',
     'gemini-2.5-flash-lite',
     'Simple Tasks Model (BYOK)',
     'Used for Tier 1 summaries, ❓ Explain chips, freeform follow-ups, Blueprint checks. Cheapest model — largest free RPD allowance.',
     'gemini'),
    ('gemini_complex_model',
     'gemini-2.5-flash',
     'Complex Tasks Model (BYOK)',
     'Used for 📊 Full analysis chips, full Company Overview profile, 🌐 translations, Compare with Another Stock, language pills. Better reasoning + Indic-script quality.',
     'gemini')
ON CONFLICT (config_key) DO UPDATE
SET
    config_value = EXCLUDED.config_value,
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    category     = EXCLUDED.category,
    updated_at   = NOW();
