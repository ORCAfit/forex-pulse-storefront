#!/usr/bin/env python3
"""Build the indicator zip packages for the Forex Pulse storefront.

Reads the compiled .ex4 files from downloads/ (Demetrius compiles them
in MetaEditor on his laptop) and zips each one with its documents,
presets and sample files from the project folders. Writes both zips
into downloads/ and verifies their contents.

Usage (from the storefront root):
    python3 scripts/build-indicator-packages.py [--flr-only | --fbpi-only] [--force]

Rules enforced here:
  - The .ex4 for a package must already be in downloads/; otherwise the
    script stops with a clear message instead of building a package
    without its indicator.
  - NO .mq4 source file is ever put in a zip. The staging area is
    scanned for *.mq4 before zipping and the finished zip is verified
    the same way; any hit aborts the build.
  - The finished zip is checked against the exact expected file list
    (see PACKAGING.md).
"""
import argparse
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

STOREFRONT = Path(__file__).resolve().parent.parent
DOWNLOADS = STOREFRONT / "downloads"
PROJECTS = Path.home() / "workspace" / "projects"

PACKAGES = {
    "flr": {
        "zip_name": "Forex_Level_Radar_Pro.zip",
        "ex4": "Forex_Level_Radar_Pro_V.ex4",
        "project": PROJECTS / "forex-level-radar-pro",
        "docs": [
            "Backtesting_Protocol.md",
            "Installation_Guide.md",
            "Probability_Methodology.md",
            "Source_Code_Documentation.md",
            "Technical_Architecture.md",
            "Technical_Specification.md",
            "Test_Report.md",
            "User_Manual.md",
        ],
        "presets": ["FLR_Standard.set", "FLR_Conservative.set", "FLR_Aggressive.set"],
        "files": ["Sample_Scoreboard.csv", "Sample_Scoreboard.README.md"],
    },
    "fbpi": {
        "zip_name": "FBPI_Main_SingleFile.zip",
        "ex4": "FBPI_Main_SingleFile_V.ex4",
        "project": PROJECTS / "forex-bigger-picture-intelligence",
        "docs": [
            "Data_Source_Register.md",
            "Historical_Testing_Protocol.md",
            "Installation_Guide.md",
            "Market_Structure_Methodology.md",
            "Probability_Methodology.md",
            "Risk_Management_Guide.md",
            "Session_Configuration_Guide.md",
            "Technical_Architecture.md",
            "Test_Report.md",
            "User_Manual.md",
            "Volume_Profile_Methodology.md",
        ],
        "presets": ["FBPI_Standard.set", "FBPI_Conservative.set", "FBPI_Aggressive.set"],
        "files": ["Sample_Scoreboard.csv", "Sample_Historical_Statistics.csv"],
    },
}


def expected_entries(spec):
    entries = [spec["ex4"], *spec["files"]]
    entries += [f"docs/{d}" for d in spec["docs"]]
    entries += [f"presets/{p}" for p in spec["presets"]]
    return sorted(entries)


def build_one(key, spec, force):
    zip_path = DOWNLOADS / spec["zip_name"]
    if zip_path.exists() and not force:
        print(f"SKIP {spec['zip_name']}: already exists (use --force to rebuild)")
        return True

    ex4_path = DOWNLOADS / spec["ex4"]
    if not ex4_path.is_file():
        print(f"ERROR: {spec['ex4']} is not in downloads/ yet — compile it in "
              f"MetaEditor (F7) and place it there first.")
        return False

    project = spec["project"]
    missing = []
    sources = [(ex4_path, spec["ex4"])]
    for name in spec["files"]:
        src = project / name
        if not src.is_file():
            missing.append(str(src))
        sources.append((src, name))
    for name in spec["docs"]:
        src = project / "docs" / name
        if not src.is_file():
            missing.append(str(src))
        sources.append((src, f"docs/{name}"))
    for name in spec["presets"]:
        src = project / "presets" / name
        if not src.is_file():
            missing.append(str(src))
        sources.append((src, f"presets/{name}"))
    if missing:
        print("ERROR: missing source files:")
        for m in missing:
            print(f"  {m}")
        return False

    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp)
        for src, arc in sources:
            dest = stage / arc
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dest)
        # Guard: no .mq4 source may reach a package, ever.
        mq4 = sorted(p for p in stage.rglob("*.mq4"))
        if mq4:
            print("ERROR: .mq4 source found in staging area — refusing to package:")
            for p in mq4:
                print(f"  {p}")
            return False
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for src, arc in sources:
                zf.write(stage / arc, arc)

    # Verify the finished zip: exact file list, no .mq4 anywhere.
    with zipfile.ZipFile(zip_path) as zf:
        names = sorted(zf.namelist())
    if names != expected_entries(spec):
        print(f"ERROR: {spec['zip_name']} contents do not match the manifest.")
        print(f"  expected: {expected_entries(spec)}")
        print(f"  actual:   {names}")
        return False
    if any(n.lower().endswith(".mq4") for n in names):
        print(f"ERROR: {spec['zip_name']} contains a .mq4 file — refusing to keep it.")
        zip_path.unlink(missing_ok=True)
        return False
    print(f"OK {spec['zip_name']}: {len(names)} entries, no .mq4")
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--flr-only", action="store_true")
    ap.add_argument("--fbpi-only", action="store_true")
    ap.add_argument("--force", action="store_true", help="rebuild over existing zips")
    args = ap.parse_args()
    keys = list(PACKAGES)
    if args.flr_only:
        keys = ["flr"]
    if args.fbpi_only:
        keys = ["fbpi"]
    ok = True
    for key in keys:
        if not build_one(key, PACKAGES[key], args.force):
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
