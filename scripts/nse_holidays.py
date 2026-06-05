"""NSE closed days (single source for pipeline scripts).

Canonical list of NSE-India trading holidays for the calendar year.
Used by every pipeline script that wants to bail out early on a
non-trading day — avoids downloading empty bhav copies, writing
stale swing conditions, corrupting stage history, and burning
Gemini API credits on a holiday.

Saturdays and Sundays are NOT in this list — those are already
handled by `datetime.weekday() >= 5` checks in every caller. We
only list dates that fall on a regular trading weekday (Mon–Fri)
but are closed because of a public holiday.

NSE_HOLIDAYS_2026 is a frozenset so all existing call sites that
do `today.isoformat() in NSE_HOLIDAYS_2026` keep working. The
thin `is_nse_holiday()` wrapper is the preferred call site for
new code — easier to mock in tests and explicit about intent.
"""

NSE_HOLIDAYS_2026 = frozenset(
    {
        "2026-01-15",  # Municipal Corp Election Maharashtra
        "2026-01-26",  # Republic Day
        "2026-03-03",  # Holi
        "2026-03-26",  # Ram Navami
        "2026-03-31",  # Mahavir Jayanti
        "2026-04-03",  # Good Friday
        "2026-04-14",  # Ambedkar Jayanti
        "2026-05-01",  # Maharashtra Day
        "2026-05-28",  # Bakri Id
        "2026-06-26",  # Muharram
        "2026-09-14",  # Ganesh Chaturthi
        "2026-10-02",  # Gandhi Jayanti
        "2026-10-20",  # Dussehra
        "2026-11-10",  # Diwali Balipratipada
        "2026-11-24",  # Guru Nanak Jayanti
        "2026-12-25",  # Christmas
        # Note: 2026-08-15 (Independence Day) is a Saturday, so it's
        # already a non-trading day via the weekend guard — no need
        # to list it here.
    }
)


def is_nse_holiday(date_str: str) -> bool:
    """Check if a given date (YYYY-MM-DD) is an NSE trading holiday.

    Weekends are NOT covered here — callers should pair this with
    `datetime.weekday() >= 5` if they need to skip Saturdays /
    Sundays as well. Returns False for any year other than 2026
    (extend NSE_HOLIDAYS_<year> as new years approach).
    """
    return date_str in NSE_HOLIDAYS_2026
