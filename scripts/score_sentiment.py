"""
Sentiment scorer utility.
Takes a list of headline strings, returns a list of integer scores 1-10.
One Claude (Haiku) call per symbol batch. No Supabase interaction.
"""

from __future__ import annotations

import json
import os
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()
client = Anthropic(api_key=os.environ.get("CLAUDE_API_KEY"))

SYSTEM_PROMPT = """You are a financial news classifier for Indian stocks.
Score each headline 1-10 for positive business impact on the company.
1 = very negative (fraud, resignation, loss, fine)
5 = neutral (routine filing, AGM notice)
10 = very positive (major contract win, record profit, expansion)
Return ONLY a JSON array of integers, same order as input. No explanation."""


def score_headlines(headlines: list[str]) -> list[int]:
    """
    Takes a list of headline strings.
    Returns a list of integer scores (1-10), same length and order.
    Falls back to 5 (neutral) for any parsing failure.
    """
    if not headlines:
        return []

    numbered = "\n".join(f"{i + 1}. {h}" for i, h in enumerate(headlines))

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=256,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": numbered}],
    )

    raw = response.content[0].text.strip()

    try:
        scores = json.loads(raw)
        if isinstance(scores, list) and len(scores) == len(headlines):
            return [max(1, min(10, int(s))) for s in scores]
    except (json.JSONDecodeError, ValueError, TypeError):
        pass

    # Fallback: neutral score for all
    return [5] * len(headlines)


# ---------------------------------------------------------------------------
# Quick local test — run: python score_sentiment.py
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    test_headlines = [
        "TCS wins $500M deal with European bank",
        "CFO of Infosys resigns with immediate effect",
        "HDFC Bank reports record quarterly profit",
        "Routine board meeting scheduled for next week",
        "SEBI imposes fine on promoter for insider trading",
    ]

    scores = score_headlines(test_headlines)
    for headline, score in zip(test_headlines, scores):
        print(f"{score:2d}  {headline}")
