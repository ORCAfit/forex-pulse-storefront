# Indicator packaging — build manifest

Each indicator product downloads as a **zip package** from `downloads/`.
The storefront gates on the zip being present: no zip, no Buy button,
no checkout. The `.mq4` source is never included in any package.

## Zip filenames (exact)

| Zip | Product | Price |
| --- | --- | --- |
| `Forex_Level_Radar_Pro.zip` | Forex Level Radar Pro (FLR-MT4-001) | $149 |
| `FBPI_Main_SingleFile.zip` | Forex Bigger Picture Intelligence System (FBPI-MT4-001) | $199 |

The $299 bundle delivers both zips (one download link per zip).

## Internal layout

**`Forex_Level_Radar_Pro.zip`** — 14 entries
```
Forex_Level_Radar_Pro_V.ex4
Sample_Scoreboard.csv
Sample_Scoreboard.README.md
docs/Backtesting_Protocol.md
docs/Installation_Guide.md
docs/Probability_Methodology.md
docs/Source_Code_Documentation.md
docs/Technical_Architecture.md
docs/Technical_Specification.md
docs/Test_Report.md
docs/User_Manual.md
presets/FLR_Standard.set
presets/FLR_Conservative.set
presets/FLR_Aggressive.set
```

**`FBPI_Main_SingleFile.zip`** — 17 entries
```
FBPI_Main_SingleFile_V.ex4
Sample_Scoreboard.csv
Sample_Historical_Statistics.csv
docs/Data_Source_Register.md
docs/Historical_Testing_Protocol.md
docs/Installation_Guide.md
docs/Market_Structure_Methodology.md
docs/Probability_Methodology.md
docs/Risk_Management_Guide.md
docs/Session_Configuration_Guide.md
docs/Technical_Architecture.md
docs/Test_Report.md
docs/User_Manual.md
docs/Volume_Profile_Methodology.md
presets/FBPI_Standard.set
presets/FBPI_Conservative.set
presets/FBPI_Aggressive.set
```

No `.mq4` file appears in either zip — the build script aborts if one
is found in the staging area.

## How to build the real zips (once the .ex4 files arrive)

1. Compile the two `_V` .mq4 files on the laptop in MetaEditor (F7).
2. Place the compiled files in `downloads/`:
   - `downloads/Forex_Level_Radar_Pro_V.ex4`
   - `downloads/FBPI_Main_SingleFile_V.ex4`
3. From the storefront root, run:
   ```
   python3 scripts/build-indicator-packages.py
   ```
   This reads the .ex4 files from `downloads/`, copies the docs,
   presets and sample files from the two project folders
   (`~/workspace/projects/forex-level-radar-pro/` and
   `~/workspace/projects/forex-bigger-picture-intelligence/`), writes
   both zips into `downloads/`, and verifies each zip's contents
   (expected file list, no `.mq4` anywhere). It refuses to run if an
   .ex4 is missing.
   - Build one package only: `python3 scripts/build-indicator-packages.py --flr-only`
     or `--fbpi-only`.
   - Rebuild over existing zips: add `--force`.
4. Commit the two zips to `downloads/` (they are not gitignored) and
   push — Render deploys them with the app and the Buy buttons switch
   on by themselves. The loose `.ex4` files can be deleted from
   `downloads/` afterwards; the zips are the only files the server
   looks for.
5. Sanity-check a built zip before committing:
   ```
   unzip -l downloads/Forex_Level_Radar_Pro.zip
   unzip -l downloads/FBPI_Main_SingleFile.zip
   ```
   Neither listing may contain `.mq4`.

## Buyer install steps (also shown on the download page and in the email)

1. Unzip the package, then copy the `.ex4` file into MT4
   `MQL4/Indicators`.
2. Copy the `.set` preset files into MT4 `MQL4/Presets`. In MT4, attach
   the indicator to a chart, click **Load** in the inputs window and
   pick a preset (Standard is a good start). Full steps are in the
   `Installation_Guide.md` inside the package.
