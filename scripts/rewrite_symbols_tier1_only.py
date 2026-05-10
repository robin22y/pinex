"""
Rewrite scripts/symbols.py: tier1 symbols from scripts/data/custom_tier1_literal.txt,
empty tier2, ALL_SYMBOLS = tier1. COMPANY_META: prefer git HEAD COMPANY_META merge,
then Nifty CSV + EQUITY master, then curated name/sector fallback.
Preserves SCREENER_SYMBOL_MAP via build_mappings.
"""

from __future__ import annotations

import ast
import csv
import subprocess
from pathlib import Path

from build_symbols import assign_sector_from_nifty, guess_sector_equity_only, SECTOR_LIST as BASE_SECTOR_LIST

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
CUSTOM_TIER1 = ROOT / "data" / "custom_tier1_literal.txt"
NF_CSV = ROOT / "data" / "ind_nifty500list.csv"
EQ_CSV = ROOT / "data" / "EQUITY_L.csv"
OUT_PY = ROOT / "symbols.py"

SCREENER = """SCREENER_SYMBOL_MAP = {
  'TEJASNET': 'TEJASNET',
  'SYRMA': 'SYRMA',
  'APTUS': 'APTUS',
  # add exceptions here as discovered
}

"""

# Curated fallback when ticker remains as sole identifier (stale local CSV snapshots, new listings).
NAME_SECTOR_FALLBACK: dict[str, tuple[str, str]] = {
    "TATACONSUM": ("Tata Consumer Products Ltd.", "FMCG"),
    "CADILAH": ("Zydus Lifesciences Ltd.", "Pharma"),
    "AWL": ("AWL Ltd.", "FMCG"),
    "UNITEDSPIRITS": ("United Spirits Ltd.", "FMCG"),
    "WESTLIFE": ("Westlife Foodworld Ltd.", "Retail"),
    "ZOMATO": ("Zomato Ltd.", "Retail"),
    "NYKAA": ("FSN E-Commerce Ventures Ltd.", "Retail"),
    "POLICYBZR": ("PB Fintech Ltd.", "Insurance"),
    "PAYTM": ("One 97 Communications Ltd.", "Others"),
    "DELHIVERY": ("Delhivery Ltd.", "Logistics"),
    "IRCTC": ("Indian Railway Catering and Tourism Corp. Ltd.", "Others"),
    "GLAND": ("Gland Pharma Ltd.", "Pharma"),
    "BATA": ("Bata India Ltd.", "Others"),
    "MANYAVAR": ("Vedant Fashions Ltd.", "Retail"),
    "VEDANT": ("Vedant Ltd.", "Others"),
    "NIPPONLIFE": ("NIPPON LIFE INDIA ASSET MANAGEMENT LIMITED", "Wealth Management"),
    "STARHEALTH": ("Star Health and Allied Insurance Co. Ltd.", "Insurance"),
    "ICICIPRU": ("ICICI Prudential Life Insurance Ltd.", "Insurance"),
    "MAXFINSERV": ("Max Financial Services Ltd.", "Insurance"),
    "ABSLAMC": ("Aditya Birla Sun Life AMC Ltd.", "Wealth Management"),
    "APTUS": ("Aptus Value Housing Finance India Ltd.", "NBFC"),
    "HOMEFIRST": ("Home First Finance Ltd.", "NBFC"),
    "REPCO": ("Repco Home Finance Ltd.", "NBFC"),
    "SPANDANA": ("Spandana Sphoorty Finance Ltd.", "NBFC"),
    "UJJIVANSFB": ("Ujjivan Small Finance Bank Ltd.", "Banking"),
    "EQUITASBNK": ("Equitas Small Finance Bank Ltd.", "Banking"),
    "SURYODAY": ("Suryoday Small Finance Bank Ltd.", "Banking"),
    "ESAFSFB": ("ESAF Small Finance Bank Ltd.", "Banking"),
    "UTKARSHBNK": ("Utkarsh Small Finance Bank Ltd.", "Banking"),
    "CSBBANK": ("CSB Bank Ltd.", "Banking"),
    "POWF": ("POWF Capital Ltd.", "Others"),
    "IRFC": ("Indian Railway Finance Corp. Ltd.", "NBFC"),
    "NHAI": ("NH InvIT Trust", "Infrastructure"),
    "RVNL": ("Rail Vikas Nigam Ltd.", "Infrastructure"),
    "RAILTEL": ("RailTel Corporation Ltd.", "Telecom"),
    "MIDHANI": ("Mishra Dhatu Nigam Ltd.", "Defence"),
    "PARAS": ("Paras Defence and Space Technologies Ltd.", "Defence"),
    "TEJASNET": ("Tejas Networks Ltd.", "Telecom"),
    "SYRMA": ("Syrma SGS Technology Ltd.", "EMS Electronics"),
    "AMBER": ("Amber Enterprises India Ltd.", "Consumer Durables"),
    "KAYNES": ("Kaynes Technology India Ltd.", "EMS Electronics"),
    "AVALON": ("Avalon Technologies Ltd.", "EMS Electronics"),
    "IDEAFORGE": ("ideaForge Technology Ltd.", "Defence"),
    "ROUTE": ("Route Mobile Ltd.", "Telecom"),
    "MSTCLTD": ("MSTC Ltd.", "Others"),
    "COFORGE": ("Coforge Ltd.", "IT Services"),
    "LTIM": ("LTIMindtree Ltd.", "IT Services"),
    "KPITTECH": ("KPIT Technologies Ltd.", "IT Services"),
    "TATATECH": ("Tata Technologies Ltd.", "IT Services"),
    "BIRLASOFT": ("Birlasoft Ltd.", "IT Services"),
    "SONACOMS": ("Sona BLW Precision Forgings Ltd.", "Auto Ancillary"),
    "MOTHERSON": ("Samvardhana Motherson International Ltd.", "Auto Ancillary"),
    "BOSCH": ("Bosch Ltd.", "Auto Ancillary"),
    "MINDA": ("Minda Corporation Ltd.", "Auto Ancillary"),
    "UNOMINDA": ("Unominda Ltd.", "Auto Ancillary"),
    "CRAFTSMAN": ("Craftsman Automation Ltd.", "Auto Ancillary"),
    "AARTI": ("Aarti Industries Ltd.", "Chemicals"),
    "VINATI": ("Vinati Organics Ltd.", "Chemicals"),
    "FLUOROCHEM": ("Gujarat Fluorochemicals Ltd.", "Chemicals"),
    "CLEAN": ("Clean Science and Technology Ltd.", "Chemicals"),
    "JUBLINDS": ("Jubilant Ingrevia Ltd.", "Chemicals"),
    "THIRUMALCHM": ("Thirumalai Chemicals Ltd.", "Chemicals"),
    "TATVA": ("Tatva Industries Ltd.", "Pharma"),
    "ANURAS": ("Anupam Rasayan India Ltd.", "Chemicals"),
    "CPCL": ("Chennai Petroleum Corp. Ltd.", "Power"),
    "GUJSTATFIN": ("GSFC Financial Services Limited", "NBFC"),
    "HPCL": ("Hindustan Petroleum Corp. Ltd.", "Power"),
    "VAIBHAVGBL": ("Vaibhav Global Ltd.", "Retail"),
    "KALYAN": ("Kalyan Jewellers India Ltd.", "Retail"),
    "TRIBHOVANDAS": ("TBZ The Original Ltd.", "Retail"),
    "HAPPSTMNDS": ("Happiest Minds Technologies Ltd.", "IT Services"),
    "CAMS": ("Computer Age Management Services Ltd.", "Wealth Management"),
    "MCX": ("Multi Commodity Exchange of India Ltd.", "Others"),
    "NSDL": ("National Securities Depository Ltd.", "Others"),
    "ANGELONE": ("Angel Broking Ltd.", "Wealth Management"),
    "FIVESTAR": ("Five Star Business Finance Ltd.", "NBFC"),
    "ARMAN": ("Arman Financial Services Ltd.", "NBFC"),
    "SBFC": ("SBFC Finance Ltd.", "NBFC"),
    "LAURUS": ("Laurus Labs Ltd.", "Pharma"),
    "DIVIS": ("Divi's Laboratories Ltd.", "Pharma"),
    "SOLARA": ("Solara Active Pharma Sciences Ltd.", "Pharma"),
    "SEQUENT": ("Sequent Scientific Ltd.", "Pharma"),
    "STRIDES": ("Strides Pharma Science Ltd.", "Pharma"),
    "METROPOLIS": ("Metropolis Healthcare Ltd.", "Healthcare Hospitals"),
    "MAXHEALTH": ("Max Healthcare Institute Ltd.", "Healthcare Hospitals"),
    "KIMS": ("Krishna Institute of Medical Sciences Ltd.", "Healthcare Hospitals"),
    "NARAYANA": ("Narayana Hrudayalaya Ltd.", "Healthcare Hospitals"),
    "RAINBOW": ("Rainbow Children Medicare Ltd.", "Healthcare Hospitals"),
    "MEDANTA": ("Global Health Ltd.", "Healthcare Hospitals"),
    "DIVI": ("Divi's Laboratories Ltd.", "Pharma"),
    "PIRAMALENT": ("Piramal Enterprises Ltd.", "Pharma"),
    "INDIGOPNTS": ("Indigo Paints Ltd.", "FMCG"),
    "SHERWINWIL": ("Sherwin-Williams India Ltd.", "Others"),
    "AKZONOBEL": ("Akzo Nobel India Ltd.", "FMCG"),
    "DALBHARAT": ("Dalmia Bharat Ltd.", "Cement"),
    "PRISM": ("Prism Johnson Ltd.", "Cement"),
    "JSWINFRA": ("JSW Infrastructure Ltd.", "Infrastructure"),
    "MAN": ("Man Industries Ltd.", "Steel"),
    "GMRAIRPORT": ("GMR Airports Infrastructure Ltd.", "Infrastructure"),
    "FAG": ("Schaeffler India Ltd.", "Auto Ancillary"),
    "WAAREE": ("Waaree Energies Ltd.", "Renewable Energy"),
    "THDC": ("THDC India Ltd.", "Power"),
    "GREENKO": ("Greenko Group", "Renewable Energy"),
    "SPRNG": ("Spring Ltd.", "Others"),
    "NIIT": ("NIIT Ltd.", "IT Services"),
    "RATEGAIN": ("Rategain Travel Technologies Ltd.", "IT Services"),
    "ZAGGLE": ("Zaggle Prepaid Ocean Services Ltd.", "Others"),
    "NEWGEN": ("Newgen Software Technologies Ltd.", "IT Services"),
    "JAMNA": ("Jamna Auto Industries Ltd.", "Auto Ancillary"),
    "BALKRISHNA": ("Balkrishna Industries Ltd.", "Auto Ancillary"),
    "GOODYEAR": ("Goodyear India Ltd.", "Auto Ancillary"),
    "AEGASIND": ("Aegis Logistics Ltd.", "Power"),
    "PATANJALI": ("Patanjali Foods Ltd.", "FMCG"),
    "SENCO": ("Senco Gold Ltd.", "Retail"),
    "UGROCAP": ("UGRO Capital Ltd.", "NBFC"),
    "PAISALO": ("Paisalo Digital Ltd.", "NBFC"),
    "SUVENPHAR": ("Suven Pharmaceuticals Ltd.", "Pharma"),
    "KRSNAA": ("Krsnaa Diagnostics Ltd.", "Healthcare Hospitals"),
    "VIJAYADIAG": ("Vijaya Diagnostic Centre Ltd.", "Healthcare Hospitals"),
    "ESAB": ("ESAB India Ltd.", "Infrastructure"),
    "TITAGARH": ("Titagarh Rail Systems Ltd.", "Infrastructure"),
    "TEXRAIL": ("Texmaco Rail & Engineering Ltd.", "Infrastructure"),
    "NRB": ("NRB Industrial Bearings Ltd.", "Auto Ancillary"),
    "PRAJ": ("Praj Industries Ltd.", "Chemicals"),
    "JSPL": ("Jindal Steel & Power Ltd.", "Steel"),
    "NEEPCO": ("NEEPCO Ltd.", "Power"),
    "ACME": ("ACME Solar Holdings Ltd.", "Renewable Energy"),
}


def dedupe_preserve(seq: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for sym in seq:
        if sym and sym not in seen:
            seen.add(sym)
            out.append(sym)
    return out


def read_eq_names() -> dict[str, str]:
    out: dict[str, str] = {}
    with EQ_CSV.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            series = (row.get(" SERIES") or row.get("SERIES") or "").strip()
            if series != "EQ":
                continue
            sym = (row.get("SYMBOL") or "").strip()
            if sym and sym not in out:
                out[sym] = (row.get("NAME OF COMPANY") or "").strip()
    return out


def finalize_sector(sec: str, *, sector_list: list[str]) -> str:
    if sec in sector_list:
        return sec
    return "Others"


def load_previous_company_meta() -> dict[str, dict[str, object]]:
    try:
        proc = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "show", "HEAD:scripts/symbols.py"],
            capture_output=True,
            text=True,
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return {}
    ns: dict[str, object] = {}
    exec(compile(proc.stdout, "<previous_symbols.py>", "exec"), ns, ns)
    cm = ns.get("COMPANY_META")
    if not isinstance(cm, dict):
        return {}
    return {str(k): dict(v) for k, v in cm.items()}  # type: ignore[arg-type]


def load_custom_tier1() -> list[str]:
    raw = CUSTOM_TIER1.read_text(encoding="utf-8").strip()
    parsed = ast.literal_eval(raw)
    if not isinstance(parsed, list):
        raise SystemExit("custom_tier1_literal must decode to a list")
    return [str(sym).strip() for sym in parsed if str(sym).strip()]


def main() -> None:
    sector_list = [*BASE_SECTOR_LIST]
    if "Others" not in sector_list:
        sector_list.append("Others")

    tier1 = dedupe_preserve(load_custom_tier1())
    prev_meta = load_previous_company_meta()

    nifty_rows = list(csv.DictReader(NF_CSV.open(encoding="utf-8", newline="")))
    nifty_by_symbol: dict[str, dict[str, str]] = {}
    for row in nifty_rows:
        sym = (row.get("Symbol") or "").strip()
        if sym:
            nifty_by_symbol.setdefault(sym, row)

    eq_names = read_eq_names()

    company_meta: dict[str, dict[str, str | int]] = {}
    for sym in tier1:
        prev = prev_meta.get(sym)

        sector = "Others"
        name = ""

        if prev:
            pname = str(prev.get("name") or "").strip()
            if pname and pname != sym:
                name = pname
                psec = str(prev.get("sector") or "").strip() or "Others"
                sector = finalize_sector(psec, sector_list=sector_list)

        rr = nifty_by_symbol.get(sym)
        if rr and (not name or name == sym):
            n = (rr.get("Company Name") or "").strip()
            if n:
                name = n
                industry = (rr.get("Industry") or "").strip()
                sector = finalize_sector(
                    assign_sector_from_nifty(company=name, industry=industry),
                    sector_list=sector_list,
                )

        eq_name = eq_names.get(sym, "").strip()
        if (not name or name == sym) and eq_name:
            name = eq_name
            sector = finalize_sector(guess_sector_equity_only(name), sector_list=sector_list)

        if not name or name == sym:
            fb = NAME_SECTOR_FALLBACK.get(sym)
            if fb:
                name, sec_fb = fb
                sector = finalize_sector(sec_fb, sector_list=sector_list)

        if not name:
            name = sym

        sector = finalize_sector(sector, sector_list=sector_list)

        company_meta[sym] = {
            "name": name,
            "sector": sector,
            "bse_code": "",
            "exchange": "NSE",
            "tier": 1,
            "website": "",
        }

    tier2: list[str] = []
    all_symbols = list(tier1)

    parts: list[str] = [
        '"""Auto-generated NSE symbol tiers and company metadata."""\n',
        f"SECTOR_LIST = {sector_list!r}\n\n",
        SCREENER,
        f"TIER1_SYMBOLS = {tier1!r}\n\n",
        f"TIER2_SYMBOLS = {tier2!r}\n\n",
        f"ALL_SYMBOLS = {all_symbols!r}\n\n",
        f"COMPANY_META = {company_meta!r}\n",
    ]
    OUT_PY.write_text("".join(parts), encoding="utf-8")

    ticker_only = [s for s, m in company_meta.items() if m["name"] == s]
    print(
        f"Wrote {OUT_PY}: tier1={len(tier1)}, meta={len(company_meta)}, "
        f"name_equals_ticker={len(ticker_only)}",
    )


if __name__ == "__main__":
    main()
