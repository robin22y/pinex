# ─────────────────────────────────────────────────────────────────
# Dockerfile — used by Railway to run the PineX Telegram bot.
# ─────────────────────────────────────────────────────────────────
# Why a Dockerfile when this is mostly a Node/Vite repo:
#   Railway's auto-detector picked "Node static site" on first deploy
#   because package.json is at the root. The bot never ran.
#   railway.json now points Railway at THIS Dockerfile, which is
#   Python-only — Railway skips the Node/Vite path entirely.
#
# Netlify (which actually serves pinex.in) ignores Dockerfiles — it
# reads netlify.toml + package.json. So this file is Railway-only.
# ─────────────────────────────────────────────────────────────────

FROM python:3.11-slim

# Faster cold starts:
#   PYTHONDONTWRITEBYTECODE — skip writing .pyc files (no persistence)
#   PYTHONUNBUFFERED        — flush print() instantly so Railway logs
#                              show "PineX telegram bot started" the
#                              moment it happens, not 30s later.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install Python deps FIRST so this layer caches across rebuilds.
# Code changes don't invalidate the dep layer → ~5s redeploys vs
# the 30-60s install on every change.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy only what the bot needs. scripts/db.py provides the supabase
# client; telegram_bot.py is the entry point. .dockerignore keeps
# the rest of the repo (node_modules, dist, src/, etc) out of the
# build context.
COPY scripts/ ./scripts/

# WORKDIR /app/scripts mirrors what scripts/run_daily.py does locally:
# cwd=scripts/ so `from db import …` resolves without PYTHONPATH
# tweaks. Same import semantics as a manual `python telegram_bot.py`
# from your laptop.
WORKDIR /app/scripts

CMD ["python", "telegram_bot.py"]
