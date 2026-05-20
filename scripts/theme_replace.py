#!/usr/bin/env python3
"""
Replace all hardcoded colors with CSS variables across PineX JSX files.
Run from the stockiq project root.
"""
import os, re, glob

BASE = r"C:\Users\robin\Desktop\stockiq"

# ORDER MATTERS — more specific/longer patterns first to avoid partial matches
SIMPLE = [
    # ── Gradients (before individual colors inside them) ─────────────────
    ("'linear-gradient(180deg, #0D1420 0%, #0B0E11 100%)'",
     "'var(--gradient-hero)'"),
    ("'linear-gradient(135deg, rgba(0,200,5,.1) 0%, rgba(0,200,5,.03) 100%)'",
     "'var(--gradient-swingx)'"),
    ("linear-gradient(135deg, rgba(0,200,5,.04) 0%, rgba(0,200,5,0) 60%)",
     "var(--gradient-swingx)"),

    # ── Full border shorthand rules (before bare hex) ─────────────────────
    ("'1.5px solid #1E2530'",  "'1.5px solid var(--border)'"),
    ("'2px solid #1E2530'",    "'2px solid var(--border)'"),
    ("'1px solid #1E2530'",    "'1px solid var(--border)'"),
    ("'1px solid #2D3748'",    "'1px solid var(--border-hover)'"),
    ("'1px solid #334155'",    "'1px solid var(--border-strong)'"),
    # Template-literal borders from the C constant
    ("`1px solid ${C.border}`",        "'1px solid var(--border)'"),
    ("`1px solid ${C.border2}`",       "'1px solid var(--border-hover)'"),
    ("`1px solid ${C.border}`",        "'1px solid var(--border)'"),
    ("`border: 1px solid ${C.border}`","'border: 1px solid var(--border)'"),

    # ── rgba green accent (before bare #00C805) ───────────────────────────
    ("rgba(0,200,5,.06)",  "var(--accent-dim)"),
    ("rgba(0,200,5,.08)",  "var(--accent-dim)"),
    ("rgba(0,200,5,.09)",  "var(--accent-dim)"),
    ("rgba(0,200,5,.1)",   "var(--accent-dim)"),
    ("rgba(0,200,5,.12)",  "var(--accent-dim)"),
    ("rgba(0,200,5,.15)",  "var(--accent-glow)"),
    ("rgba(0,200,5,.2)",   "var(--accent-border)"),
    ("rgba(0,200,5,.25)",  "var(--accent-border)"),
    ("rgba(0,200,5,.3)",   "var(--accent-border)"),
    ("rgba(0,200,5,.35)",  "var(--border-focus)"),
    ("rgba(0,200,5,.4)",   "var(--accent-border)"),
    ("rgba(0,200,5,.5)",   "var(--accent-border)"),

    # ── rgba red ──────────────────────────────────────────────────────────
    ("rgba(255,59,48,.08)", "var(--negative-dim)"),
    ("rgba(255,59,48,.1)",  "var(--negative-dim)"),
    ("rgba(255,59,48,.12)", "var(--negative-dim)"),

    # ── rgba amber ────────────────────────────────────────────────────────
    ("rgba(251,191,36,.08)", "var(--warning-dim)"),
    ("rgba(251,191,36,.1)",  "var(--warning-dim)"),
    ("rgba(251,191,36,.12)", "var(--warning-dim)"),

    # ── rgba blue ─────────────────────────────────────────────────────────
    ("rgba(96,165,250,.08)", "var(--info-dim)"),
    ("rgba(96,165,250,.1)",  "var(--info-dim)"),
    ("rgba(96,165,250,.12)", "var(--info-dim)"),

    # ── Backgrounds ───────────────────────────────────────────────────────
    ("'#0B0E11'", "'var(--bg-primary)'"),
    ("'#0F1217'", "'var(--bg-surface)'"),
    ("'#141820'", "'var(--bg-elevated)'"),
    ("'#0D1117'", "'var(--bg-input)'"),
    ("'#1A2030'", "'var(--bg-overlay)'"),
    ("'#0D1420'", "'var(--bg-surface)'"),

    # ── Border hex values ─────────────────────────────────────────────────
    ("'#1E2530'", "'var(--border)'"),
    ("'#2D3748'", "'var(--border-hover)'"),
    # #334155 handled via regex below (context-sensitive)

    # ── Text colors ───────────────────────────────────────────────────────
    ("'#E2E8F0'", "'var(--text-primary)'"),
    ("'#CBD5E1'", "'var(--text-primary)'"),
    ("'#94A3B8'", "'var(--text-secondary)'"),
    ("'#64748B'", "'var(--text-muted)'"),
    ("'#475569'", "'var(--text-hint)'"),
    # #334155 → see regex section

    # ── Semantic: accent / positive / negative ────────────────────────────
    ("'#00C805'", "'var(--accent)'"),
    ("'#FF3B30'", "'var(--negative)'"),
    ("'#86EFAC'", "'var(--positive-soft)'"),
    ("'#FCA5A5'", "'var(--negative-soft)'"),
    ("'#FBBF24'", "'var(--warning)'"),
    ("'#60A5FA'", "'var(--info)'"),

    # ── Shadows ───────────────────────────────────────────────────────────
    ("'0 2px 8px rgba(0,0,0,.3)'",  "'var(--shadow-sm)'"),
    ("'0 4px 16px rgba(0,0,0,.3)'", "'var(--shadow-md)'"),
    ("'0 4px 16px rgba(0,0,0,.4)'", "'var(--shadow-md)'"),
    ("'0 8px 32px rgba(0,0,0,.4)'", "'var(--shadow-lg)'"),
    ("'0 8px 32px rgba(0,0,0,.5)'", "'var(--shadow-lg)'"),

    # ── Font families ─────────────────────────────────────────────────────
    # Various quoting patterns seen in JSX inline styles
    ("\"'DM Mono', monospace\"",           '"var(--font-mono)"'),
    ("\"'DM Mono', 'Fira Code', monospace\"","\"var(--font-mono)\""),
    ("'DM Mono, monospace'",               "'var(--font-mono)'"),
    ("\"DM Mono, monospace\"",             '"var(--font-mono)"'),

    # ── Gain/loss ternary fix (must run AFTER accent was replaced) ────────
    # Replace accent with positive when it's the "gain" side of a ternary
    ("'var(--accent)' : 'var(--negative)'",
     "'var(--positive)' : 'var(--negative)'"),
    ("'var(--accent)' : 'var(--negative-soft)'",
     "'var(--positive)' : 'var(--negative-soft)'"),
]


def process(filepath):
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        return f"ERROR: {e}"

    original = content

    # Simple string replacements
    for old, new in SIMPLE:
        content = content.replace(old, new)

    # Context-sensitive: #334155 as CSS color property → text-disabled
    content = re.sub(
        r"(color\s*:\s*)'#334155'",
        r"\1'var(--text-disabled)'",
        content,
    )
    # Remaining #334155 (borders, backgrounds) → border-strong
    content = content.replace("'#334155'", "'var(--border-strong)'")

    if content != original:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        return "UPDATED"
    return "unchanged"


# Collect all JSX files under src/
files = sorted(glob.glob(
    os.path.join(BASE, "src", "**", "*.jsx"),
    recursive=True,
))

updated, skipped = [], []
for fp in files:
    rel = os.path.relpath(fp, BASE)
    result = process(fp)
    if result == "UPDATED":
        updated.append(rel)
        print(f"  OK  {rel}")
    elif result == "unchanged":
        skipped.append(rel)
    else:
        print(f"  ERR  {rel} -- {result}")

print(f"\nUpdated {len(updated)} / {len(files)} files  ({len(skipped)} unchanged)")
