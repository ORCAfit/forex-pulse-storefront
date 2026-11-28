# Indicator downloads

Compiled MT4 indicator **zip packages** sold on the storefront live here.
Each purchase downloads a zip — never a bare .ex4 file.

## Packages that belong here (exact names)

| File | Product | Price |
| --- | --- | --- |
| `Forex_Level_Radar_Pro.zip` | Forex Level Radar Pro (FLR) | $149 |
| `FBPI_Main_SingleFile.zip` | Forex Bigger Picture Intelligence System (FBPI) | $199 |

The $299 bundle delivers both zips. The names above are what the
server looks for — a different name will not be found.

## What is inside each zip

**Forex_Level_Radar_Pro.zip**
- `Forex_Level_Radar_Pro_V.ex4` — the compiled indicator
- `docs/` — all 8 documents (including `Installation_Guide.md`)
- `presets/` — all 3 presets (`FLR_Standard.set`, `FLR_Conservative.set`, `FLR_Aggressive.set`)
- `Sample_Scoreboard.csv` + `Sample_Scoreboard.README.md`

**FBPI_Main_SingleFile.zip**
- `FBPI_Main_SingleFile_V.ex4` — the compiled indicator (single-file build)
- `docs/` — all 11 documents (including `Installation_Guide.md`)
- `presets/` — all 3 presets (`FBPI_Standard.set`, `FBPI_Conservative.set`, `FBPI_Aggressive.set`)
- `Sample_Scoreboard.csv` + `Sample_Historical_Statistics.csv`

Full layout and build commands: `PACKAGING.md` at the storefront root.

## How the packages get here

Demetrius compiles the `_V` .mq4 files on his laptop in MetaEditor (F7).
The compiled .ex4 files are then zipped with the documents, presets and
sample files by `scripts/build-indicator-packages.py` (see PACKAGING.md),
and the two zips are committed to the repo in this folder, so Render
deploys them with the app.

**Do not put .mq4 source files in this folder** — the source is never
sold and no route serves it. Only the two zip packages are
downloadable, and only through the token-gated
`/download/:token/:product` route (a buyer needs a paid order's token).
The build script refuses to package any .mq4 file.

## Gating

A product's Buy button on the homepage stays disabled ("Coming soon")
and the checkout API refuses to start a Stripe session until that
product's **zip** is present here. Nobody can pay for a package that
cannot be delivered. While this folder holds no zips, all three
products show as coming soon.
