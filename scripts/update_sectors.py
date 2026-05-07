"""Weekly sector overview updater (run on Saturdays)."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from db import log_event, supabase, upsert
from symbols import SECTOR_LIST

SECTORS_TABLE = "sectors"


def _is_saturday() -> bool:
    return datetime.now().weekday() == 5


def _safe_float(v: Any) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _latest_row(
    table: str,
    company_id: str,
    columns: str,
    *,
    extra_filter: tuple[str, str, Any] | None = None,
) -> dict[str, Any] | None:
    q = (
        supabase.table(table)
        .select(columns)
        .eq("company_id", company_id)
        .order("trading_date" if table != "financials" else "quarter_name", desc=True)
        .limit(1)
    )
    if extra_filter:
        col, op, val = extra_filter
        if op == "gte":
            q = q.gte(col, val)
        elif op == "eq":
            q = q.eq(col, val)
    res = q.execute()
    data = getattr(res, "data", None) or []
    return data[0] if data else None


def _latest_financial_row(company_id: str) -> dict[str, Any] | None:
    res = (
        supabase.table("financials")
        .select("quarter_name,revenue_growth_qoq,revenue_growth_yoy")
        .eq("company_id", company_id)
        .order("quarter_name", desc=True)
        .limit(1)
        .execute()
    )
    data = getattr(res, "data", None) or []
    return data[0] if data else None


def _delivery_7d_avg(company_id: str, since_date: str) -> float | None:
    res = (
        supabase.table("delivery_data")
        .select("delivery_pct,trading_date")
        .eq("company_id", company_id)
        .gte("trading_date", since_date)
        .order("trading_date", desc=True)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    vals = [_safe_float(r.get("delivery_pct")) for r in rows]
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return sum(vals) / len(vals)


def _compute_health(total: int, stage2_count: int, stage4_count: int) -> str:
    if total <= 0:
        return "amber"
    if stage2_count / total > 0.5:
        return "green"
    if stage4_count / total > 0.4:
        return "red"
    return "amber"


def _sector_companies(sector: str) -> list[dict[str, Any]]:
    res = (
        supabase.table("companies")
        .select("id,symbol,name,sector")
        .eq("sector", sector)
        .execute()
    )
    return getattr(res, "data", None) or []


def _sectors_needing_ai(sectors: list[dict[str, Any]], today: datetime) -> list[str]:
    threshold = (today - timedelta(days=7)).date().isoformat()
    need: list[str] = []
    for row in sectors:
        updated = str(row.get("overview_updated_at") or row.get("updated_at") or "")
        if not updated:
            need.append(str(row.get("sector")))
            continue
        try:
            d = datetime.fromisoformat(updated.replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            need.append(str(row.get("sector")))
            continue
        if d < threshold:
            need.append(str(row.get("sector")))
    return need


def main() -> None:
    if not _is_saturday():
        print("update_sectors skipped: runs only on Saturdays")
        log_event("update_sectors_skipped_not_saturday", {"weekday": datetime.now().strftime("%A")})
        return

    today = datetime.now()
    today_iso = today.date().isoformat()
    since_7d = (today - timedelta(days=7)).date().isoformat()

    log_event("update_sectors_started", {"trading_date": today_iso})
    updated_count = 0
    ai_prompt_queue: list[dict[str, Any]] = []

    for sector in SECTOR_LIST:
        companies = _sector_companies(sector)
        total = len(companies)
        if total == 0:
            continue

        stage1 = stage2 = stage3 = stage4 = 0
        obv_rising = 0
        revenue_growing = 0
        delivery_vals: list[float] = []

        for c in companies:
            cid = c.get("id")
            if not cid:
                continue

            p = _latest_row("price_data", cid, "stage,obv_trend,trading_date")
            if p:
                stage = str(p.get("stage") or "").strip().lower().replace(" ", "")
                if stage == "stage1":
                    stage1 += 1
                elif stage == "stage2":
                    stage2 += 1
                elif stage == "stage3":
                    stage3 += 1
                elif stage == "stage4":
                    stage4 += 1

                if str(p.get("obv_trend") or "").strip().lower() == "rising":
                    obv_rising += 1

            f = _latest_financial_row(cid)
            if f:
                qoq = _safe_float(f.get("revenue_growth_qoq"))
                yoy = _safe_float(f.get("revenue_growth_yoy"))
                if (qoq is not None and qoq > 0) or (yoy is not None and yoy > 0):
                    revenue_growing += 1

            d_avg = _delivery_7d_avg(cid, since_7d)
            if d_avg is not None:
                delivery_vals.append(d_avg)

        sector_delivery_avg = (sum(delivery_vals) / len(delivery_vals)) if delivery_vals else None
        health = _compute_health(total, stage2, stage4)

        summary = {
            "sector": sector,
            "total_companies": total,
            "stage_counts": {
                "stage1": stage1,
                "stage2": stage2,
                "stage3": stage3,
                "stage4": stage4,
            },
            "obv_rising_count": obv_rising,
            "revenue_growing_count": revenue_growing,
            "delivery_7d_avg_pct": sector_delivery_avg,
            "health": health,
            "computed_on": today_iso,
        }

        row = {
            "sector": sector,
            "trading_date": today_iso,
            "total_companies": total,
            "stage1_count": stage1,
            "stage2_count": stage2,
            "stage3_count": stage3,
            "stage4_count": stage4,
            "obv_rising_count": obv_rising,
            "revenue_growing_count": revenue_growing,
            "delivery_7d_avg_pct": sector_delivery_avg,
            "health": health,
            "summary": summary,
            "updated_at": datetime.utcnow().isoformat(),
        }
        upsert(SECTORS_TABLE, row, "sector,trading_date")
        updated_count += 1

        ai_prompt_queue.append(
            {
                "sector": sector,
                "summary": summary,
            },
        )

    # Queue sectors for AI overview generation if stale > 7d.
    existing = (
        supabase.table(SECTORS_TABLE)
        .select("sector,overview_updated_at,updated_at")
        .eq("trading_date", today_iso)
        .execute()
    )
    existing_rows = getattr(existing, "data", None) or []
    stale_sectors = set(_sectors_needing_ai(existing_rows, today))
    ai_queue_filtered = [x for x in ai_prompt_queue if x["sector"] in stale_sectors]

    print(
        f"update_sectors done: updated={updated_count} ai_overview_queue={len(ai_queue_filtered)}",
    )
    log_event(
        "update_sectors_finished",
        {
            "trading_date": today_iso,
            "sectors_updated": updated_count,
            "ai_overview_queue_count": len(ai_queue_filtered),
            "ai_overview_queue": [x["sector"] for x in ai_queue_filtered],
        },
    )


if __name__ == "__main__":
    main()
