# Procfile — tells Railway (and Heroku-style hosts) how to run the bot.
#
# `worker:` is a long-running background process (not a web server).
# Railway picks this up automatically when no web process is defined.
#
# `cd scripts &&` is important: telegram_bot.py imports `from db import …`
# (db.py lives in scripts/). Running with cwd=scripts/ matches what
# scripts/run_daily.py does for every other pipeline script and keeps
# imports working with zero PYTHONPATH gymnastics.
worker: cd scripts && python telegram_bot.py
