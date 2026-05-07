"""
One-off helper to regenerate symbols.py from scripts/data CSV snapshots.

Reads:
  scripts/data/ind_nifty500list.csv  (official-style Nifty 500 columns)
  scripts/data/EQUITY_L.csv          (historic NSE master; EQ series)
"""

from __future__ import annotations

import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
NF_CSV = DATA / "ind_nifty500list.csv"
EQ_CSV = DATA / "EQUITY_L.csv"
OUT_PY = ROOT / "symbols.py"

SECTOR_LIST = [
    "IT Services",
    "Pharma",
    "NBFC",
    "Banking",
    "Auto",
    "Auto Ancillary",
    "FMCG",
    "Cement",
    "Steel",
    "Defence",
    "EMS Electronics",
    "Chemicals",
    "Real Estate",
    "Infrastructure",
    "Telecom",
    "Power",
    "Renewable Energy",
    "Consumer Durables",
    "Retail",
    "Healthcare Hospitals",
    "Insurance",
    "Wealth Management",
    "Textiles",
    "Agro Chemicals",
    "Logistics",
]


def assign_sector_from_nifty(*, company: str, industry: str) -> str:
    cn = company.upper()
    ind = industry.upper()

    def fin_services() -> str:
        if "INSURANCE" in cn:
            return "Insurance"
        if "BANK" in cn or cn.strip().startswith("HDFC BANK") or cn.endswith(
            "BANK LTD.",
        ):
            # Keep broad Banking coverage
            pass
        if " BANK" in cn or cn.startswith("STATE BANK"):
            return "Banking"
        if any(
            token in cn
            for token in (
                "AMC",
                "ASSET MANAGEMENT",
                "SECURITIES LTD",
                "CAPITAL SERVICES",
                "BROKING",
            )
        ):
            return "Wealth Management"
        return "NBFC"

    if "PHARMA" in ind or "PHARMACEUTICAL" in ind:
        return "Pharma"
    if ind == "IT" or "INFORMATION TECHNOLOGY" in ind:
        return "IT Services"
    if ind == "FINANCIAL SERVICES":
        return fin_services()
    if "INSURANCE" in cn and "BANK" not in cn:
        return "Insurance"
    if "AUTOMOBILE" in ind:
        if any(
            x in cn
            for x in (
                "TYRE",
                "MINDA",
                "MOTHERSON",
                "SUMI",
                "ENDURANCE",
                "BOSCH",
                "EXIDE",
                "AMARAJA",
            )
        ):
            return "Auto Ancillary"
        return "Auto"
    if "CEMENT" in ind:
        return "Cement"
    if "STEEL" in ind or ("METALS" in ind and "STEEL" in cn):
        return "Steel"
    if "METALS" in ind:
        return "Steel"
    if any(x in cn for x in ("AERONAUT", "DYNAMICS", "DEFENCE", "DEFENSE")):
        return "Defence"
    if "ELECTRON" in cn or cn.startswith("DIXON"):
        return "EMS Electronics"
    if "CHEMICAL" in ind and "FERTILISER" not in ind:
        return "Chemicals"
    if "FERTILISER" in ind or "PESTICIDE" in ind:
        return "Agro Chemicals"
    if "REAL" in cn and ("ESTATE" in cn or "REALTY" in cn):
        return "Real Estate"
    if "CONSTRUCTION" in ind:
        return "Infrastructure"
    if "TELECOM" in ind:
        return "Telecom"
    if ind == "ENERGY":
        if any(x in cn for x in ("SOLAR", "RENEWABLE", "GREEN", "WIND", "ADANI GREEN")):
            return "Renewable Energy"
        return "Power"
    if ind == "CONSUMER GOODS":
        if any(x in cn for x in ("WHIRL", "VOLTAS", "CROMPTON", "ORIENT ELECTRIC")):
            return "Consumer Durables"
        if any(x in cn for x in (" MART ", " DMART ", "RETAIL LTD", "AVENUE SUPER")):
            return "Retail"
        return "FMCG"
    if "HEALTHCARE" in ind:
        if "HOSPITAL" in cn:
            return "Healthcare Hospitals"
        return "Healthcare Hospitals"
    if "TEXTILE" in ind or ind == "PAPER":
        return "Textiles"
    if ind == "SERVICES":
        if any(x in cn for x in ("LOGIST", "CARGO", "EXPRESS", "SHIPPING")):
            return "Logistics"
        return "Infrastructure"
    if ind == "INDUSTRIAL MANUFACTURING":
        if any(x in cn for x in ("ELECTRON", "ELECTRIC", "AUTOMATION", "TECH")):
            return "EMS Electronics"
        if any(x in cn for x in ("DEFENCE", "AEROSPACE")):
            return "Defence"
        return "Infrastructure"
    if ind == "MEDIA & ENTERTAINMENT":
        return "Retail"
    if ind == "FMCG":
        return "FMCG"
    return "Retail"


def guess_sector_equity_only(company: str) -> str:
    u = company.upper()
    heuristics: list[tuple[tuple[str, ...], str]] = [
        (("PHARMA", "PHARMACEUTICAL", "MEDICI", "LIFE SCIENCES"), "Pharma"),
        ((" BANK", "BANK ", " BANK,"), "Banking"),
        (("FINANCE", "FINANCIAL"), "NBFC"),
        (("INSURANCE", "INSURANCES"), "Insurance"),
        (
            ("ASSET MANAGEMENT", " AMC", " SECURITIES LTD", "BROKING"),
            "Wealth Management",
        ),
        ((" SOFTWARE", "TECHNOLOGY", " CONSULT", "SERVICES LTD"), "IT Services"),
        (("TELECOM", "COMMUNICATION", "DIGITAL "), "Telecom"),
        (("POWER", " ENERGY "), "Power"),
        (("SOLAR", "RENEWABLE", "WIND "), "Renewable Energy"),
        (("STEEL ", "IRON ", "METAL "), "Steel"),
        (("CEMENT ", "CEMENTS "), "Cement"),
        (("REAL ", "PROPERTY", "HOMES "), "Real Estate"),
        (("AUTO ", "MOTORS", "VEHICLE", " TYRE "), "Auto"),
        (("LOGISTICS", "FREIGHT", "SHIPYARD "), "Logistics"),
        (("CHEMICAL", "PETROCHEMIC"), "Chemicals"),
        (("FERTILIZER", "FERTILISER", "AGRO "), "Agro Chemicals"),
        (
            ("HOSPITAL", "HEALTHCARE", "MEDICA", " DIAGNOST"),
            "Healthcare Hospitals",
        ),
        (("TEXTILE", "GARMENTS", " FABRIC"), "Textiles"),
        (
            ("ELECTRONICS", "ELECTRIC", " COMPONENTS", "TECHNOCRAFT"),
            "EMS Electronics",
        ),
        (("DEFENCE", " DEFENSE ", "WEAPON"), "Defence"),
        (("RETAIL", " STORE", " HYPER"), "Retail"),
        (("FMCG", "FOODS", "BEVERAGE"), "FMCG"),
    ]
    for keys, sec in heuristics:
        if any(k in u for k in keys):
            return sec
    return assign_sector_from_nifty(company=company, industry="")


def read_nifty_rows() -> list[dict[str, str]]:
    with NF_CSV.open(encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def iter_eq_rows() -> list[dict[str, str]]:
    with EQ_CSV.open(encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def main() -> None:
    nifty = read_nifty_rows()
    tier1: list[str] = []
    tier1_meta: dict[str, dict[str, str | int]] = {}
    seen_t1: set[str] = set()

    for row in nifty:
        sym = (row.get("Symbol") or "").strip()
        if not sym or sym in seen_t1:
            continue
        seen_t1.add(sym)
        tier1.append(sym)
        name = (row.get("Company Name") or "").strip()
        industry = (row.get("Industry") or "").strip()
        sector = assign_sector_from_nifty(company=name, industry=industry)
        if sector not in SECTOR_LIST:
            sector = "Retail"
        tier1_meta[sym] = {
            "name": name,
            "sector": sector,
            "bse_code": "",
            "exchange": "NSE",
            "tier": 1,
            "website": "",
        }

    eq_rows = iter_eq_rows()
    tier1_set = set(tier1)
    tier2: list[str] = []
    tier2_meta: dict[str, dict[str, str | int]] = {}

    for row in eq_rows:
        series = (row.get(" SERIES") or row.get("SERIES") or "").strip()
        if series != "EQ":
            continue
        sym = (row.get("SYMBOL") or "").strip()
        if not sym or sym in tier1_set or sym in tier2_meta:
            continue
        name = (row.get("NAME OF COMPANY") or "").strip()
        if not name:
            name = sym
        tier2.append(sym)
        sector = guess_sector_equity_only(name)
        if sector not in SECTOR_LIST:
            sector = "Retail"
        tier2_meta[sym] = {
            "name": name,
            "sector": sector,
            "bse_code": "",
            "exchange": "NSE",
            "tier": 2,
            "website": "",
        }
        if len(tier2) >= 1000:
            break

    company_meta = {**tier1_meta, **tier2_meta}
    all_symbols = tier1 + tier2

    missing = [s for s in all_symbols if s not in company_meta]
    if missing:
        raise SystemExit(f"Missing COMPANY_META entries: {missing[:10]}")

    parts: list[str] = []
    parts.append('"""Auto-generated NSE symbol tiers and company metadata."""\n')
    parts.append(f"SECTOR_LIST = {SECTOR_LIST!r}\n\n")
    parts.append(f"TIER1_SYMBOLS = {tier1!r}\n\n")
    parts.append(f"TIER2_SYMBOLS = {tier2!r}\n\n")
    parts.append(f"ALL_SYMBOLS = {all_symbols!r}\n\n")
    parts.append(f"COMPANY_META = {company_meta!r}\n")

    OUT_PY.write_text("".join(parts), encoding="utf-8")
    print(
        f"Wrote {OUT_PY} (tier1={len(tier1)}, tier2={len(tier2)}, meta={len(company_meta)})",
    )


if __name__ == "__main__":
    main()
