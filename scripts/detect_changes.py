"""Quarterly change detection engine."""

from __future__ import annotations

import sys
from datetime import datetime
from typing import Any

from db import log_event, supabase, upsert

TEST_MODE = "--test" in sys.argv
TEST_SYMBOLS = ["SYRMA", "APTUS", "TEJASNET"]

HEADLINE_PRIORITY = [
    "stage4_entered",
    "pat_decline_first",
    "promoter_selling_significant",
    "margin_compression_first",
    "revenue_decline_first",
    "stage2_confirmed",
    "pat_recovery_first",
    "revenue_record",
]


def _safe_float(v: Any) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _norm_stage(v: Any) -> str:
    return str(v or "").strip().lower().replace(" ", "")


def _add_change(
    changes: list[dict[str, Any]],
    *,
    typ: str,
    severity: str,
    is_first_time: bool,
    previous_value: Any,
    current_value: Any,
    context: str,
) -> None:
    changes.append(
        {
            "type": typ,
            "severity": severity,
            "is_first_time": is_first_time,
            "previous_value": previous_value,
            "current_value": current_value,
            "context": context,
        },
    )


def _fetch_company(company_id: str) -> dict[str, Any] | None:
    res = supabase.table("companies").select("id,symbol,name").eq("id", company_id).limit(1).execute()
    rows = getattr(res, "data", None) or []
    return rows[0] if rows else None


def _fetch_financial_history(company_id: str, limit: int = 12) -> list[dict[str, Any]]:
    res = (
        supabase.table("financials")
        .select("company_id,quarter_name,revenue,net_profit,margin")
        .eq("company_id", company_id)
        .order("quarter_name", desc=True)
        .limit(limit)
        .execute()
    )
    return getattr(res, "data", None) or []


def _fetch_shareholding_history(company_id: str, limit: int = 8) -> list[dict[str, Any]]:
    res = (
        supabase.table("shareholding")
        .select(
            "company_id,quarter_name,promoter_pct,promoter_pledge_pct,fii_pct,dii_pct,named_investors",
        )
        .eq("company_id", company_id)
        .order("quarter_name", desc=True)
        .limit(limit)
        .execute()
    )
    return getattr(res, "data", None) or []


def _fetch_price_stage_history(company_id: str, limit: int = 40) -> list[dict[str, Any]]:
    res = (
        supabase.table("price_data")
        .select("company_id,date,stage")
        .eq("company_id", company_id)
        .order("date", desc=True)
        .limit(limit)
        .execute()
    )
    return getattr(res, "data", None) or []


def _fetch_delivery_30d_avg(company_id: str) -> float | None:
    res = (
        supabase.table("delivery_data")
        .select("delivery_pct")
        .eq("company_id", company_id)
        .order("date", desc=True)
        .limit(30)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    vals = [_safe_float(r.get("delivery_pct")) for r in rows]
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return sum(vals) / len(vals)


def _status_rank(status: str) -> int:
    # red first, then amber, then green
    order = {"red": 0, "amber": 1, "green": 2}
    return order.get(status, 3)


def generate_signal_panel(company_id: str, quarter: str) -> list[dict[str, Any]]:
    company = _fetch_company(company_id)
    if not company:
        return []
    symbol = str(company.get("symbol") or "").strip()
    if not symbol:
        return []

    fin_hist = _fetch_financial_history(company_id, limit=12)
    sh_hist = _fetch_shareholding_history(company_id, limit=8)
    stage_hist = _fetch_price_stage_history(company_id, limit=40)
    delivery_30d_avg = _fetch_delivery_30d_avg(company_id)

    fin_by_q = {str(r.get("quarter_name")): r for r in fin_hist}
    sh_by_q = {str(r.get("quarter_name")): r for r in sh_hist}
    cur_fin = fin_by_q.get(quarter) or (fin_hist[0] if fin_hist else {})
    cur_sh = sh_by_q.get(quarter) or (sh_hist[0] if sh_hist else {})
    prev_sh = sh_hist[1] if len(sh_hist) > 1 else {}

    signals: list[dict[str, Any]] = []

    # SIGNAL 1 — Revenue
    revs = [_safe_float(r.get("revenue")) for r in fin_hist[:6]]
    rev_pairs = []
    for i in range(min(3, len(revs) - 1)):
        a, b = revs[i], revs[i + 1]
        if a is None or b in (None, 0):
            continue
        rev_pairs.append(a - b)
    if len(rev_pairs) >= 3 and all(x > 0 for x in rev_pairs[:3]):
        status = "green"
        label = "Revenue grew for 3 consecutive quarters"
    elif len(rev_pairs) >= 2 and all(x < 0 for x in rev_pairs[:2]):
        status = "red"
        label = "Revenue declined for at least 2 consecutive quarters"
    else:
        status = "amber"
        label = "Revenue trend is mixed across recent quarters"
    signals.append(
        {
            "name": "Revenue",
            "status": status,
            "label": label,
            "detail": "Based on quarter-over-quarter revenue direction over recent quarters.",
        },
    )

    # SIGNAL 2 — Profitability
    cur_pat = _safe_float(cur_fin.get("net_profit"))
    prev_pat = _safe_float(fin_hist[1].get("net_profit")) if len(fin_hist) > 1 else None
    cur_margin = _safe_float(cur_fin.get("margin"))
    prev_margin = _safe_float(fin_hist[1].get("margin")) if len(fin_hist) > 1 else None
    prev_prev_margin = _safe_float(fin_hist[2].get("margin")) if len(fin_hist) > 2 else None

    if cur_pat is None or cur_margin is None:
        p_status = "amber"
        p_label = "Profitability data is incomplete this quarter"
    elif cur_pat <= 0 or (prev_pat is not None and cur_pat < prev_pat):
        p_status = "red"
        p_label = "PAT declined this quarter or is loss-making"
    elif prev_pat is not None and cur_pat > prev_pat:
        if prev_margin is not None and cur_margin < prev_margin:
            if prev_prev_margin is not None and prev_margin < prev_prev_margin and cur_margin > prev_margin:
                p_status = "amber"
                p_label = "PAT grew while margin is recovering from prior compression"
            else:
                p_status = "amber"
                p_label = "PAT grew but margin declined quarter over quarter"
        else:
            p_status = "green"
            p_label = "PAT grew and margin was stable to higher"
    else:
        p_status = "amber"
        p_label = "Profitability trend is mixed this quarter"
    signals.append(
        {
            "name": "Profitability",
            "status": p_status,
            "label": p_label,
            "detail": "Combines PAT direction with margin direction.",
        },
    )

    # SIGNAL 3 — Ownership (promoter + FII)
    cur_prom = _safe_float(cur_sh.get("promoter_pct"))
    prev_prom = _safe_float(prev_sh.get("promoter_pct"))
    cur_fii = _safe_float(cur_sh.get("fii_pct"))
    prev_fii = _safe_float(prev_sh.get("fii_pct"))

    prom_delta = (cur_prom - prev_prom) if cur_prom is not None and prev_prom is not None else None
    fii_delta = (cur_fii - prev_fii) if cur_fii is not None and prev_fii is not None else None

    if (prom_delta is not None and prom_delta <= -1) or (fii_delta is not None and fii_delta <= -1):
        o_status = "red"
        o_label = "Promoter/FII holdings show significant selling or sustained FII exit"
    elif (
        prom_delta is not None
        and prom_delta >= 0
        and fii_delta is not None
        and fii_delta > 0
    ):
        o_status = "green"
        o_label = "Promoter holding is stable-to-higher and FII holding increased"
    else:
        o_status = "amber"
        o_label = "Promoter/FII holdings are stable to mixed this quarter"
    signals.append(
        {
            "name": "Ownership",
            "status": o_status,
            "label": o_label,
            "detail": "Uses quarter-over-quarter changes in promoter and FII holdings.",
        },
    )

    # SIGNAL 4 — Market behaviour (delivery)
    if delivery_30d_avg is None:
        m_status = "amber"
        m_label = "30-day average delivery data is unavailable"
    elif delivery_30d_avg > 45:
        m_status = "green"
        m_label = f"30-day average delivery is {delivery_30d_avg:.1f}%"
    elif 30 <= delivery_30d_avg <= 65:
        m_status = "amber"
        m_label = f"30-day average delivery is {delivery_30d_avg:.1f}%"
    else:
        m_status = "red"
        m_label = f"30-day average delivery is {delivery_30d_avg:.1f}%"
    signals.append(
        {
            "name": "Market behaviour",
            "status": m_status,
            "label": m_label,
            "detail": "Compares 30-day average delivery percentage with threshold bands.",
        },
    )

    # SIGNAL 5 — Momentum (Stage + OBV)
    price_latest = (
        supabase.table("price_data")
        .select("stage,obv_trend")
        .eq("company_id", company_id)
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    p_rows = getattr(price_latest, "data", None) or []
    stage_now = _norm_stage(p_rows[0].get("stage")) if p_rows else ""
    obv_now = str(p_rows[0].get("obv_trend") or "").strip().lower() if p_rows else ""

    if stage_now in ("stage3", "stage4"):
        mom_status = "red"
        mom_label = f"Current stage is {stage_now.upper() if stage_now else 'UNKNOWN'}"
    elif stage_now == "stage2" and obv_now == "rising":
        mom_status = "green"
        mom_label = "Current stage is Stage2 and OBV trend is rising"
    elif stage_now == "stage1" or (stage_now == "stage2" and obv_now == "flat"):
        mom_status = "amber"
        mom_label = "Current stage is consolidating or Stage2 with flat OBV trend"
    else:
        mom_status = "amber"
        mom_label = "Momentum setup is mixed this session"
    signals.append(
        {
            "name": "Momentum",
            "status": mom_status,
            "label": mom_label,
            "detail": "Uses latest stage classification and OBV trend.",
        },
    )

    # Exactly 5 signals, sorted with red first.
    signals = signals[:5]
    signals.sort(key=lambda s: _status_rank(str(s.get("status"))))
    return signals


def _choose_headline(changes: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    if not changes:
        return None, None
    by_type = {c["type"]: c for c in changes}
    for typ in HEADLINE_PRIORITY:
        if typ in by_type:
            c = by_type[typ]
            return c["type"], c["severity"]
    # fallback first change
    c = changes[0]
    return c["type"], c["severity"]


def detect_all_changes(company_id: str, current_quarter: str, prev_quarter: str) -> list[dict[str, Any]]:
    company = _fetch_company(company_id)
    if not company:
        return []
    symbol = str(company.get("symbol") or "").strip()
    if not symbol:
        return []

    fin_hist = _fetch_financial_history(company_id, limit=12)
    sh_hist = _fetch_shareholding_history(company_id, limit=8)
    stage_hist = _fetch_price_stage_history(company_id, limit=40)
    delivery_30d_avg = _fetch_delivery_30d_avg(company_id)

    fin_by_q = {str(r.get("quarter_name")): r for r in fin_hist}
    sh_by_q = {str(r.get("quarter_name")): r for r in sh_hist}
    cur_fin = fin_by_q.get(current_quarter)
    prev_fin = fin_by_q.get(prev_quarter)
    cur_sh = sh_by_q.get(current_quarter)
    prev_sh = sh_by_q.get(prev_quarter)

    changes: list[dict[str, Any]] = []

    # ===== REVENUE =====
    cur_rev = _safe_float((cur_fin or {}).get("revenue"))
    prev_rev = _safe_float((prev_fin or {}).get("revenue"))
    if cur_rev is not None and prev_rev not in (None, 0):
        rev_growth = (cur_rev - prev_rev) / abs(prev_rev) * 100.0
        # prior growth streak check
        prev_revs = [_safe_float(r.get("revenue")) for r in fin_hist[1:5]]
        prev_growth_flags: list[bool] = []
        for i in range(len(prev_revs) - 1):
            a, b = prev_revs[i], prev_revs[i + 1]
            if a is None or b in (None, 0):
                continue
            prev_growth_flags.append(a > b)
        had_3_growth_quarters = len(prev_growth_flags) >= 3 and all(prev_growth_flags[:3])
        had_2_declines = len(prev_growth_flags) >= 2 and all(not x for x in prev_growth_flags[:2])

        prev_growth = None
        if len(fin_hist) >= 3:
            a = _safe_float(fin_hist[1].get("revenue"))
            b = _safe_float(fin_hist[2].get("revenue"))
            if a is not None and b not in (None, 0):
                prev_growth = (a - b) / abs(b) * 100.0

        if rev_growth > 0:
            if had_2_declines:
                _add_change(
                    changes,
                    typ="revenue_recovery_first",
                    severity="high",
                    is_first_time=True,
                    previous_value=prev_rev,
                    current_value=cur_rev,
                    context="Revenue turned positive after at least two declining quarters.",
                )
            elif prev_growth is not None and rev_growth < prev_growth:
                _add_change(
                    changes,
                    typ="revenue_deceleration",
                    severity="medium",
                    is_first_time=False,
                    previous_value=prev_growth,
                    current_value=rev_growth,
                    context="Revenue is still growing, but at a slower pace than last quarter.",
                )
            else:
                _add_change(
                    changes,
                    typ="revenue_growth_continued",
                    severity="low",
                    is_first_time=False,
                    previous_value=prev_rev,
                    current_value=cur_rev,
                    context="Revenue growth continued quarter over quarter.",
                )
        else:
            if had_3_growth_quarters:
                _add_change(
                    changes,
                    typ="revenue_decline_first",
                    severity="high",
                    is_first_time=True,
                    previous_value=prev_rev,
                    current_value=cur_rev,
                    context="First revenue decline after a multi-quarter growth run.",
                )
            else:
                _add_change(
                    changes,
                    typ="revenue_decline_continued",
                    severity="medium",
                    is_first_time=False,
                    previous_value=prev_rev,
                    current_value=cur_rev,
                    context="Revenue decline continued from the previous quarter trend.",
                )

        all_revs = [_safe_float(r.get("revenue")) for r in fin_hist]
        all_revs = [v for v in all_revs if v is not None]
        if all_revs and cur_rev >= max(all_revs):
            _add_change(
                changes,
                typ="revenue_record",
                severity="high",
                is_first_time=False,
                previous_value=max(all_revs[:-1]) if len(all_revs) > 1 else None,
                current_value=cur_rev,
                context="Revenue hit a new high versus available historical quarters.",
            )

    # ===== PAT =====
    cur_pat = _safe_float((cur_fin or {}).get("net_profit"))
    prev_pat = _safe_float((prev_fin or {}).get("net_profit"))
    if cur_pat is not None and prev_pat is not None:
        prior_pats = [_safe_float(r.get("net_profit")) for r in fin_hist[1:5]]
        prior_profit_streak = len(prior_pats) >= 3 and all((p is not None and p > 0) for p in prior_pats[:3])
        prior_decline_flags = []
        for i in range(len(prior_pats) - 1):
            a, b = prior_pats[i], prior_pats[i + 1]
            if a is None or b is None:
                continue
            prior_decline_flags.append(a <= b)

        if cur_pat < prev_pat or cur_pat <= 0:
            if prior_profit_streak:
                _add_change(
                    changes,
                    typ="pat_decline_first",
                    severity="high",
                    is_first_time=True,
                    previous_value=prev_pat,
                    current_value=cur_pat,
                    context="First PAT decline/loss after at least three profitable quarters.",
                )
            elif cur_pat <= 0 and prev_pat <= 0:
                _add_change(
                    changes,
                    typ="pat_loss_continued",
                    severity="medium",
                    is_first_time=False,
                    previous_value=prev_pat,
                    current_value=cur_pat,
                    context="PAT remained in loss territory for consecutive quarters.",
                )
        else:
            had_decline_run = len(prior_decline_flags) >= 2 and all(prior_decline_flags[:2])
            if had_decline_run or prev_pat <= 0:
                _add_change(
                    changes,
                    typ="pat_recovery_first",
                    severity="high",
                    is_first_time=True,
                    previous_value=prev_pat,
                    current_value=cur_pat,
                    context="PAT recovered after a weak/declining period.",
                )

        all_pats = [_safe_float(r.get("net_profit")) for r in fin_hist]
        all_pats = [v for v in all_pats if v is not None]
        if all_pats and cur_pat >= max(all_pats):
            _add_change(
                changes,
                typ="pat_record",
                severity="high",
                is_first_time=False,
                previous_value=max(all_pats[:-1]) if len(all_pats) > 1 else None,
                current_value=cur_pat,
                context="PAT reached a new high versus available historical quarters.",
            )

    # ===== MARGINS =====
    cur_margin = _safe_float((cur_fin or {}).get("margin"))
    prev_margin = _safe_float((prev_fin or {}).get("margin"))
    if cur_margin is not None and prev_margin is not None:
        prior_margins = [_safe_float(r.get("margin")) for r in fin_hist[1:5]]
        prior_expansion = []
        for i in range(len(prior_margins) - 1):
            a, b = prior_margins[i], prior_margins[i + 1]
            if a is None or b is None:
                continue
            prior_expansion.append(a > b)
        had_3_expansion = len(prior_expansion) >= 3 and all(prior_expansion[:3])

        if cur_margin < prev_margin:
            if had_3_expansion:
                _add_change(
                    changes,
                    typ="margin_compression_first",
                    severity="high",
                    is_first_time=True,
                    previous_value=prev_margin,
                    current_value=cur_margin,
                    context="First margin compression after a multi-quarter expansion trend.",
                )
            else:
                _add_change(
                    changes,
                    typ="margin_compression_continued",
                    severity="low",
                    is_first_time=False,
                    previous_value=prev_margin,
                    current_value=cur_margin,
                    context="Margins continued to compress quarter over quarter.",
                )
        elif cur_margin > prev_margin:
            prev_prev_margin = _safe_float(fin_hist[2].get("margin")) if len(fin_hist) > 2 else None
            if prev_prev_margin is not None and prev_margin < prev_prev_margin:
                _add_change(
                    changes,
                    typ="margin_recovery_first",
                    severity="high",
                    is_first_time=True,
                    previous_value=prev_margin,
                    current_value=cur_margin,
                    context="Margins recovered after prior compression.",
                )
            else:
                _add_change(
                    changes,
                    typ="margin_expansion_continued",
                    severity="low",
                    is_first_time=False,
                    previous_value=prev_margin,
                    current_value=cur_margin,
                    context="Margins continued to expand quarter over quarter.",
                )

    # ===== PROMOTER / FII / DII =====
    if cur_sh and prev_sh:
        cur_prom = _safe_float(cur_sh.get("promoter_pct"))
        prev_prom = _safe_float(prev_sh.get("promoter_pct"))
        if cur_prom is not None and prev_prom is not None:
            d = cur_prom - prev_prom
            if d > 1:
                _add_change(
                    changes,
                    typ="promoter_buying_significant",
                    severity="high",
                    is_first_time=False,
                    previous_value=prev_prom,
                    current_value=cur_prom,
                    context="Promoter holding increased by more than 1%.",
                )
            elif d < -1:
                _add_change(
                    changes,
                    typ="promoter_selling_significant",
                    severity="high",
                    is_first_time=False,
                    previous_value=prev_prom,
                    current_value=cur_prom,
                    context="Promoter holding decreased by more than 1%.",
                )

        cur_pledge = _safe_float(cur_sh.get("promoter_pledge_pct"))
        prev_pledge = _safe_float(prev_sh.get("promoter_pledge_pct"))
        if cur_pledge is not None and prev_pledge is not None:
            if cur_pledge > prev_pledge:
                _add_change(
                    changes,
                    typ="promoter_pledge_increase",
                    severity="high",
                    is_first_time=False,
                    previous_value=prev_pledge,
                    current_value=cur_pledge,
                    context="Promoter pledge increased versus previous quarter.",
                )
            elif prev_pledge > 0 and cur_pledge == 0:
                _add_change(
                    changes,
                    typ="promoter_pledge_cleared",
                    severity="high",
                    is_first_time=True,
                    previous_value=prev_pledge,
                    current_value=cur_pledge,
                    context="Promoter pledge was fully cleared.",
                )

        cur_fii = _safe_float(cur_sh.get("fii_pct"))
        prev_fii = _safe_float(prev_sh.get("fii_pct"))
        if cur_fii is not None and prev_fii is not None:
            d = cur_fii - prev_fii
            if d >= 1:
                _add_change(
                    changes,
                    typ="fii_entry_significant",
                    severity="medium",
                    is_first_time=False,
                    previous_value=prev_fii,
                    current_value=cur_fii,
                    context="FII holding increased by at least 1%.",
                )
            elif d <= -1:
                _add_change(
                    changes,
                    typ="fii_exit_significant",
                    severity="medium",
                    is_first_time=False,
                    previous_value=prev_fii,
                    current_value=cur_fii,
                    context="FII holding decreased by at least 1%.",
                )

        cur_dii = _safe_float(cur_sh.get("dii_pct"))
        prev_dii = _safe_float(prev_sh.get("dii_pct"))
        if cur_dii is not None and prev_dii is not None and (cur_dii - prev_dii) >= 1:
            _add_change(
                changes,
                typ="dii_accumulation",
                severity="medium",
                is_first_time=False,
                previous_value=prev_dii,
                current_value=cur_dii,
                context="DII holding increased by at least 1%.",
            )

        prev_named = prev_sh.get("named_investors") or []
        cur_named = cur_sh.get("named_investors") or []
        prev_names = {str(x.get("name")).strip() for x in prev_named if isinstance(x, dict) and x.get("name")}
        cur_names = {str(x.get("name")).strip() for x in cur_named if isinstance(x, dict) and x.get("name")}

        new_names = sorted(cur_names - prev_names)
        exited_names = sorted(prev_names - cur_names)
        if new_names:
            _add_change(
                changes,
                typ="new_named_investor",
                severity="medium",
                is_first_time=False,
                previous_value=list(prev_names),
                current_value=list(cur_names),
                context=f"New >1% named investors appeared: {', '.join(new_names[:3])}.",
            )
        if exited_names:
            _add_change(
                changes,
                typ="named_investor_exit",
                severity="medium",
                is_first_time=False,
                previous_value=list(prev_names),
                current_value=list(cur_names),
                context=f"Named investors exited: {', '.join(exited_names[:3])}.",
            )

    # ===== STAGE =====
    if len(stage_hist) >= 2:
        current_stage = _norm_stage(stage_hist[0].get("stage"))
        prev_stage = _norm_stage(stage_hist[1].get("stage"))
        if current_stage == "stage2" and prev_stage != "stage2":
            _add_change(
                changes,
                typ="stage2_confirmed",
                severity="high",
                is_first_time=True,
                previous_value=prev_stage,
                current_value=current_stage,
                context="Price structure transitioned into Stage 2.",
            )
        if current_stage == "stage4" and prev_stage != "stage4":
            _add_change(
                changes,
                typ="stage4_entered",
                severity="high",
                is_first_time=False,
                previous_value=prev_stage,
                current_value=current_stage,
                context="Price structure deteriorated into Stage 4.",
            )
        if prev_stage == "stage4" and current_stage == "stage2":
            _add_change(
                changes,
                typ="stage_recovery",
                severity="high",
                is_first_time=False,
                previous_value=prev_stage,
                current_value=current_stage,
                context="Stage recovered directly from Stage 4 to Stage 2.",
            )

    # Add optional context-only delivery signal
    if delivery_30d_avg is not None and changes:
        for c in changes:
            c["context"] = f"{c['context']} 30d avg delivery: {delivery_30d_avg:.2f}%."

    headline, headline_severity = _choose_headline(changes)
    row = {
        "company_id": company_id,
        "current_quarter": current_quarter,
        "prev_quarter": prev_quarter,
        "headline": headline,
        "headline_severity": headline_severity,
        "changes": changes,
        "signal_panel": generate_signal_panel(company_id, current_quarter),
        "updated_at": datetime.utcnow().isoformat(),
    }
    upsert("quarterly_changes", row, "company_id,current_quarter")
    return changes


def _latest_two_quarters(company_id: str) -> tuple[str | None, str | None]:
    hist = _fetch_financial_history(company_id, limit=2)
    if len(hist) < 2:
        return None, None
    current_q = str(hist[0].get("quarter_name") or "")
    prev_q = str(hist[1].get("quarter_name") or "")
    return current_q or None, prev_q or None


def main() -> None:
    started = datetime.utcnow().isoformat()
    log_event("detect_changes_started", {"start_time": started, "test_mode": TEST_MODE})
    if TEST_MODE:
        print("TEST MODE enabled: processing symbols SYRMA, APTUS, TEJASNET")

    companies = supabase.table("companies").select("id,symbol").limit(5000).execute()
    rows = getattr(companies, "data", None) or []
    if TEST_MODE:
        allow = set(TEST_SYMBOLS)
        rows = [r for r in rows if str(r.get("symbol") or "").strip() in allow]
    ok = 0
    skipped = 0
    failed = 0

    for c in rows:
        cid = str(c.get("id") or "").strip()
        if not cid:
            continue
        current_q, prev_q = _latest_two_quarters(cid)
        if not current_q or not prev_q:
            skipped += 1
            continue
        try:
            detect_all_changes(cid, current_q, prev_q)
            ok += 1
        except Exception as exc:
            failed += 1
            log_event(
                "detect_changes_company_failed",
                {"company_id": cid, "symbol": c.get("symbol"), "error": str(exc)},
            )

    ended = datetime.utcnow().isoformat()
    summary = {
        "start_time": started,
        "end_time": ended,
        "processed": ok,
        "skipped": skipped,
        "failed": failed,
    }
    print(f"detect_changes done processed={ok} skipped={skipped} failed={failed}")
    log_event("detect_changes_finished", summary)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

