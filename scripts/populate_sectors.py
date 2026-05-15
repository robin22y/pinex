"""
Populate companies.sector and companies.industry from SECTOR_MAP.

Prerequisite (if `industry` column is missing):
  Run scripts/sql/add_companies_industry_column.sql in Supabase SQL Editor.

Usage (from repo root):
  python scripts/populate_sectors.py
"""

from __future__ import annotations

import sys
from typing import Any

from db import supabase

SECTOR_MAP: dict[str, dict[str, str]] = {
    # IT Services
    "TCS": {"sector": "IT Services", "industry": "IT Consulting & Software"},
    "INFY": {"sector": "IT Services", "industry": "IT Consulting & Software"},
    "WIPRO": {"sector": "IT Services", "industry": "IT Consulting & Software"},
    "HCLTECH": {"sector": "IT Services", "industry": "IT Consulting & Software"},
    "TECHM": {"sector": "IT Services", "industry": "IT Consulting & Software"},
    "LTIM": {"sector": "IT Services", "industry": "IT Consulting & Software"},
    "MPHASIS": {"sector": "IT Services", "industry": "IT Consulting & Software"},
    "COFORGE": {"sector": "IT Services", "industry": "IT Consulting & Software"},
    "PERSISTENT": {"sector": "IT Services", "industry": "IT Consulting & Software"},
    "KPITTECH": {"sector": "IT Services", "industry": "Automotive Software"},
    "TATATECH": {"sector": "IT Services", "industry": "Engineering R&D"},
    "CYIENT": {"sector": "IT Services", "industry": "Engineering R&D"},
    # Banking
    "HDFCBANK": {"sector": "Banking", "industry": "Private Sector Bank"},
    "ICICIBANK": {"sector": "Banking", "industry": "Private Sector Bank"},
    "KOTAKBANK": {"sector": "Banking", "industry": "Private Sector Bank"},
    "AXISBANK": {"sector": "Banking", "industry": "Private Sector Bank"},
    "INDUSINDBK": {"sector": "Banking", "industry": "Private Sector Bank"},
    "FEDERALBNK": {"sector": "Banking", "industry": "Private Sector Bank"},
    "IDFCFIRSTB": {"sector": "Banking", "industry": "Private Sector Bank"},
    "BANDHANBNK": {"sector": "Banking", "industry": "Private Sector Bank"},
    "RBLBANK": {"sector": "Banking", "industry": "Private Sector Bank"},
    "SBIN": {"sector": "Banking", "industry": "Public Sector Bank"},
    "PNB": {"sector": "Banking", "industry": "Public Sector Bank"},
    "BANKBARODA": {"sector": "Banking", "industry": "Public Sector Bank"},
    "CANBK": {"sector": "Banking", "industry": "Public Sector Bank"},
    "UNIONBANK": {"sector": "Banking", "industry": "Public Sector Bank"},
    "INDIANB": {"sector": "Banking", "industry": "Public Sector Bank"},
    # NBFC
    "BAJFINANCE": {"sector": "NBFC", "industry": "Consumer Finance"},
    "BAJAJFINSV": {"sector": "NBFC", "industry": "Diversified Finance"},
    "MUTHOOTFIN": {"sector": "NBFC", "industry": "Gold Finance"},
    "MANAPPURAM": {"sector": "NBFC", "industry": "Gold Finance"},
    "CHOLAFIN": {"sector": "NBFC", "industry": "Vehicle Finance"},
    "LICHSGFIN": {"sector": "NBFC", "industry": "Housing Finance"},
    "PNBHOUSING": {"sector": "NBFC", "industry": "Housing Finance"},
    "CANFINHOME": {"sector": "NBFC", "industry": "Housing Finance"},
    "APTUS": {"sector": "NBFC", "industry": "Housing Finance"},
    "AAVAS": {"sector": "NBFC", "industry": "Housing Finance"},
    "HOMEFIRST": {"sector": "NBFC", "industry": "Housing Finance"},
    # Pharma
    "SUNPHARMA": {"sector": "Pharma", "industry": "Pharmaceuticals"},
    "DRREDDY": {"sector": "Pharma", "industry": "Pharmaceuticals"},
    "CIPLA": {"sector": "Pharma", "industry": "Pharmaceuticals"},
    "DIVISLAB": {"sector": "Pharma", "industry": "API & Formulations"},
    "BIOCON": {"sector": "Pharma", "industry": "Biopharmaceuticals"},
    "AUROPHARMA": {"sector": "Pharma", "industry": "Pharmaceuticals"},
    "LUPIN": {"sector": "Pharma", "industry": "Pharmaceuticals"},
    "ALKEM": {"sector": "Pharma", "industry": "Pharmaceuticals"},
    "IPCALAB": {"sector": "Pharma", "industry": "Pharmaceuticals"},
    "LAURUS": {"sector": "Pharma", "industry": "API & CDMO"},
    "GRANULES": {"sector": "Pharma", "industry": "API & Formulations"},
    "ABBOTINDIA": {"sector": "Pharma", "industry": "MNC Pharma"},
    "PFIZER": {"sector": "Pharma", "industry": "MNC Pharma"},
    "TORNTPHARM": {"sector": "Pharma", "industry": "Pharmaceuticals"},
    "AJANTPHARM": {"sector": "Pharma", "industry": "Pharmaceuticals"},
    "GLAND": {"sector": "Pharma", "industry": "Injectable Formulations"},
    # Auto
    "MARUTI": {"sector": "Auto", "industry": "Passenger Vehicles"},
    "TATAMOTORS": {"sector": "Auto", "industry": "Commercial & Passenger Vehicles"},
    "BAJAJ-AUTO": {"sector": "Auto", "industry": "Two Wheelers"},
    "HEROMOTOCO": {"sector": "Auto", "industry": "Two Wheelers"},
    "EICHERMOT": {"sector": "Auto", "industry": "Two Wheelers & Trucks"},
    "TVSMOTOR": {"sector": "Auto", "industry": "Two Wheelers"},
    "ESCORTS": {"sector": "Auto", "industry": "Tractors"},
    # Auto Ancillary
    "MOTHERSON": {"sector": "Auto Ancillary", "industry": "Auto Components"},
    "BOSCH": {"sector": "Auto Ancillary", "industry": "Auto Components"},
    "BHARATFORG": {"sector": "Auto Ancillary", "industry": "Forgings"},
    "APOLLOTYRE": {"sector": "Auto Ancillary", "industry": "Tyres"},
    "MRF": {"sector": "Auto Ancillary", "industry": "Tyres"},
    "CEATLTD": {"sector": "Auto Ancillary", "industry": "Tyres"},
    "BALKRISHNA": {"sector": "Auto Ancillary", "industry": "Specialty Tyres"},
    "ENDURANCE": {"sector": "Auto Ancillary", "industry": "Auto Components"},
    "SONACOMS": {"sector": "Auto Ancillary", "industry": "EV Components"},
    "TIINDIA": {"sector": "Auto Ancillary", "industry": "Auto Components"},
    # FMCG
    "HINDUNILVR": {"sector": "FMCG", "industry": "Diversified FMCG"},
    "ITC": {"sector": "FMCG", "industry": "Diversified FMCG"},
    "NESTLEIND": {"sector": "FMCG", "industry": "Food & Beverages"},
    "BRITANNIA": {"sector": "FMCG", "industry": "Food & Beverages"},
    "DABUR": {"sector": "FMCG", "industry": "Healthcare & Personal Care"},
    "MARICO": {"sector": "FMCG", "industry": "Personal Care"},
    "COLPAL": {"sector": "FMCG", "industry": "Personal Care"},
    "GODREJCP": {"sector": "FMCG", "industry": "Personal Care"},
    "EMAMILTD": {"sector": "FMCG", "industry": "Personal Care"},
    "TATACONSUM": {"sector": "FMCG", "industry": "Food & Beverages"},
    "VBL": {"sector": "FMCG", "industry": "Beverages"},
    "JUBLFOOD": {"sector": "FMCG", "industry": "Quick Service Restaurants"},
    "WESTLIFE": {"sector": "FMCG", "industry": "Quick Service Restaurants"},
    # Cement
    "ULTRACEMCO": {"sector": "Cement", "industry": "Cement"},
    "SHREECEM": {"sector": "Cement", "industry": "Cement"},
    "AMBUJACEM": {"sector": "Cement", "industry": "Cement"},
    "ACC": {"sector": "Cement", "industry": "Cement"},
    "RAMCOCEM": {"sector": "Cement", "industry": "Cement"},
    "DALBHARAT": {"sector": "Cement", "industry": "Cement"},
    "JKCEMENT": {"sector": "Cement", "industry": "Cement"},
    "HEIDELBERG": {"sector": "Cement", "industry": "Cement"},
    # Steel & Metals
    "JSWSTEEL": {"sector": "Steel & Metals", "industry": "Steel"},
    "TATASTEEL": {"sector": "Steel & Metals", "industry": "Steel"},
    "SAIL": {"sector": "Steel & Metals", "industry": "Steel"},
    "HINDALCO": {"sector": "Steel & Metals", "industry": "Aluminium"},
    "NATIONALUM": {"sector": "Steel & Metals", "industry": "Aluminium"},
    "VEDL": {"sector": "Steel & Metals", "industry": "Diversified Metals"},
    "NMDC": {"sector": "Steel & Metals", "industry": "Iron Ore Mining"},
    "COALINDIA": {"sector": "Steel & Metals", "industry": "Coal Mining"},
    "JSPL": {"sector": "Steel & Metals", "industry": "Steel"},
    # Defence
    "HAL": {"sector": "Defence", "industry": "Aerospace & Defence"},
    "BEL": {"sector": "Defence", "industry": "Electronics & Defence"},
    "BEML": {"sector": "Defence", "industry": "Defence Equipment"},
    "MIDHANI": {"sector": "Defence", "industry": "Speciality Alloys"},
    "PARAS": {"sector": "Defence", "industry": "Defence Electronics"},
    # EMS & Electronics
    "DIXON": {"sector": "EMS Electronics", "industry": "Electronics Manufacturing"},
    "AMBER": {"sector": "EMS Electronics", "industry": "AC Components"},
    "KAYNES": {"sector": "EMS Electronics", "industry": "Electronics Manufacturing"},
    "SYRMA": {"sector": "EMS Electronics", "industry": "Electronics Manufacturing"},
    "AVALON": {"sector": "EMS Electronics", "industry": "Electronics Manufacturing"},
    "TATAELXSI": {"sector": "EMS Electronics", "industry": "Design Services"},
    # Telecom
    "BHARTIARTL": {"sector": "Telecom", "industry": "Telecom Services"},
    "TEJASNET": {"sector": "Telecom", "industry": "Telecom Equipment"},
    # Power & Energy
    "NTPC": {"sector": "Power", "industry": "Power Generation"},
    "POWERGRID": {"sector": "Power", "industry": "Power Transmission"},
    "TATAPOWER": {"sector": "Power", "industry": "Power Generation & Distribution"},
    "TORNTPOWER": {"sector": "Power", "industry": "Power Generation"},
    "CESC": {"sector": "Power", "industry": "Power Generation & Distribution"},
    "NHPC": {"sector": "Power", "industry": "Hydropower"},
    "SJVN": {"sector": "Power", "industry": "Hydropower"},
    "SUZLON": {"sector": "Power", "industry": "Wind Energy"},
    "INOXWIND": {"sector": "Power", "industry": "Wind Energy"},
    "WAAREE": {"sector": "Power", "industry": "Solar Energy"},
    # Oil & Gas
    "RELIANCE": {"sector": "Oil & Gas", "industry": "Diversified"},
    "ONGC": {"sector": "Oil & Gas", "industry": "Exploration & Production"},
    "BPCL": {"sector": "Oil & Gas", "industry": "Refining & Marketing"},
    "IOC": {"sector": "Oil & Gas", "industry": "Refining & Marketing"},
    "HPCL": {"sector": "Oil & Gas", "industry": "Refining & Marketing"},
    "GAIL": {"sector": "Oil & Gas", "industry": "Gas Distribution"},
    "PETRONET": {"sector": "Oil & Gas", "industry": "LNG"},
    "IGL": {"sector": "Oil & Gas", "industry": "City Gas Distribution"},
    "MGL": {"sector": "Oil & Gas", "industry": "City Gas Distribution"},
    "GUJGASLTD": {"sector": "Oil & Gas", "industry": "City Gas Distribution"},
    # Chemicals
    "PIDILITIND": {"sector": "Chemicals", "industry": "Adhesives & Specialty"},
    "DEEPAKNTR": {"sector": "Chemicals", "industry": "Specialty Chemicals"},
    "AARTI": {"sector": "Chemicals", "industry": "Specialty Chemicals"},
    "NAVINFLUOR": {"sector": "Chemicals", "industry": "Fluorochemicals"},
    "SRF": {"sector": "Chemicals", "industry": "Fluorochemicals & Films"},
    "VINATI": {"sector": "Chemicals", "industry": "Specialty Chemicals"},
    "FINEORG": {"sector": "Chemicals", "industry": "Oleo Chemicals"},
    "TATACHEM": {"sector": "Chemicals", "industry": "Diversified Chemicals"},
    # Infrastructure
    "LT": {"sector": "Infrastructure", "industry": "Engineering & Construction"},
    "ADANIPORTS": {"sector": "Infrastructure", "industry": "Ports & Logistics"},
    "CONCOR": {"sector": "Infrastructure", "industry": "Rail Logistics"},
    "IRFC": {"sector": "Infrastructure", "industry": "Railway Finance"},
    "RVNL": {"sector": "Infrastructure", "industry": "Railway Construction"},
    "IRCON": {"sector": "Infrastructure", "industry": "Railway Construction"},
    "NBCC": {"sector": "Infrastructure", "industry": "Government Construction"},
    # Healthcare
    "APOLLOHOSP": {"sector": "Healthcare", "industry": "Hospitals"},
    "FORTIS": {"sector": "Healthcare", "industry": "Hospitals"},
    "MAXHEALTH": {"sector": "Healthcare", "industry": "Hospitals"},
    "METROPOLIS": {"sector": "Healthcare", "industry": "Diagnostics"},
    "THYROCARE": {"sector": "Healthcare", "industry": "Diagnostics"},
    "KIMS": {"sector": "Healthcare", "industry": "Hospitals"},
    "NH": {"sector": "Healthcare", "industry": "Hospitals"},
    "SYNGENE": {"sector": "Healthcare", "industry": "CDMO"},
    # Insurance
    "SBILIFE": {"sector": "Insurance", "industry": "Life Insurance"},
    "HDFCLIFE": {"sector": "Insurance", "industry": "Life Insurance"},
    "ICICIPRU": {"sector": "Insurance", "industry": "Life Insurance"},
    "ICICIGI": {"sector": "Insurance", "industry": "General Insurance"},
    "NIACL": {"sector": "Insurance", "industry": "General Insurance"},
    "STARHEALTH": {"sector": "Insurance", "industry": "Health Insurance"},
    # Capital Markets
    "HDFCAMC": {"sector": "Capital Markets", "industry": "Asset Management"},
    "NIPPONLIFE": {"sector": "Capital Markets", "industry": "Asset Management"},
    "ABSLAMC": {"sector": "Capital Markets", "industry": "Asset Management"},
    "CAMS": {"sector": "Capital Markets", "industry": "Financial Services"},
    "CDSL": {"sector": "Capital Markets", "industry": "Depository"},
    "BSE": {"sector": "Capital Markets", "industry": "Stock Exchange"},
    "MCX": {"sector": "Capital Markets", "industry": "Commodity Exchange"},
    "ANGELONE": {"sector": "Capital Markets", "industry": "Broking"},
    # Consumer Durables
    "HAVELLS": {"sector": "Consumer Durables", "industry": "Electricals"},
    "VOLTAS": {"sector": "Consumer Durables", "industry": "Air Conditioning"},
    "BLUESTARCO": {"sector": "Consumer Durables", "industry": "Air Conditioning"},
    "TITAN": {"sector": "Consumer Durables", "industry": "Watches & Jewellery"},
    "KALYAN": {"sector": "Consumer Durables", "industry": "Jewellery"},
    "BATA": {"sector": "Consumer Durables", "industry": "Footwear"},
    "RELAXO": {"sector": "Consumer Durables", "industry": "Footwear"},
    "PAGEIND": {"sector": "Consumer Durables", "industry": "Innerwear"},
    # Real Estate
    "GODREJIND": {"sector": "Real Estate", "industry": "Diversified Real Estate"},
    # Retail
    "DMART": {"sector": "Retail", "industry": "Supermarkets"},
    "TRENT": {"sector": "Retail", "industry": "Fashion Retail"},
    "SHOPERSTOP": {"sector": "Retail", "industry": "Department Stores"},
    # Internet & New Age
    "ZOMATO": {"sector": "Internet & New Age", "industry": "Food Delivery"},
    "NYKAA": {"sector": "Internet & New Age", "industry": "Beauty E-commerce"},
    "PAYTM": {"sector": "Internet & New Age", "industry": "Fintech"},
    "DELHIVERY": {"sector": "Internet & New Age", "industry": "Logistics"},
    "NAUKRI": {"sector": "Internet & New Age", "industry": "Online Jobs"},
    "IRCTC": {"sector": "Internet & New Age", "industry": "Online Travel"},
    "ZENSARTECH": {"sector": "IT Services", "industry": "IT Consulting"},
    "ROUTE": {"sector": "Internet & New Age", "industry": "CPaaS"},
    "TANLA": {"sector": "Internet & New Age", "industry": "CPaaS"},
}

MAP_KEYS_UPPER = {k.strip().upper(): k for k in SECTOR_MAP.keys()}


def _fetch_all_company_symbols() -> list[str]:
    """Page through companies.symbol (uppercase for matching)."""
    page_size = 1000  # PostgREST hard-caps at 1000 rows per request
    page = 0
    symbols: list[str] = []
    while True:
        start = page * page_size
        end = start + page_size - 1
        try:
            res = (
                supabase.table("companies")
                .select("symbol")
                .range(start, end)
                .execute()
            )
        except Exception as e:
            print(f"Error fetching companies page {page}: {e}")
            sys.exit(1)
        rows = getattr(res, "data", None) or []
        if not rows:
            break
        for r in rows:
            s = str(r.get("symbol") or "").strip()
            if s:
                symbols.append(s)
        if len(rows) < page_size:
            break
        page += 1
    return symbols


def _update_company(symbol_db: str, payload: dict[str, Any]) -> bool:
    try:
        supabase.table("companies").update(payload).eq("symbol", symbol_db).execute()
        return True
    except Exception as e:
        print(f"  WARN update failed symbol={symbol_db!r}: {e}")
        return False


def main() -> None:
    print("Fetching companies…")
    db_symbols = _fetch_all_company_symbols()
    total = len(db_symbols)
    print(f"Found {total} companies in database.\n")

    mapped = 0
    others = 0
    errors = 0
    db_upper_set = {s.strip().upper() for s in db_symbols}
    in_map_missing_db = [k for k in SECTOR_MAP if k.strip().upper() not in db_upper_set]

    for i, symbol_db in enumerate(db_symbols, start=1):
        su = symbol_db.strip().upper()
        map_key = MAP_KEYS_UPPER.get(su)
        if map_key is not None:
            info = SECTOR_MAP[map_key]
            payload = {
                "sector": info["sector"],
                "industry": info.get("industry") or "",
            }
            if _update_company(symbol_db, payload):
                mapped += 1
            else:
                errors += 1
        else:
            payload = {"sector": "Others", "industry": ""}
            if _update_company(symbol_db, payload):
                others += 1
            else:
                errors += 1

        if i % 100 == 0 or i == total:
            print(f"  Progress: {i}/{total} …")

    print()
    print(f"Updated {mapped} companies with sector data")
    print(f"{others} companies set to Others")
    if errors:
        print(f"{errors} updates failed (see warnings above)")
    if in_map_missing_db:
        print(
            f"\nNote: {len(in_map_missing_db)} SECTOR_MAP symbols are not present in DB (skipped): "
            f"{', '.join(sorted(in_map_missing_db)[:20])}"
            + (" …" if len(in_map_missing_db) > 20 else ""),
        )


if __name__ == "__main__":
    main()
