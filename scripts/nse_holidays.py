"""NSE closed days (single source for pipeline scripts)."""

NSE_HOLIDAYS_2026 = frozenset(
    {
        "2026-01-26",
        "2026-03-19",
        "2026-04-14",
        "2026-04-17",
        "2026-05-01",
        "2026-05-28",  # Buddha Purnima 2026 — was missing; scripts wrote stale rows for this date
        "2026-06-29",
        "2026-08-15",
        "2026-10-02",
        "2026-11-04",
        "2026-11-20",
        "2026-12-25",
    }
)
