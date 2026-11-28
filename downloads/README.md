# Indicator downloads

Compiled MT4 indicator files (.ex4) sold on the storefront live here.

## Files that belong here (exact names)

| File | Product | Price |
| --- | --- | --- |
| `Forex_Level_Radar_Pro_V.ex4` | Forex Level Radar Pro (FLR) | $149 |
| `FBPI_Main_SingleFile_V.ex4` | Forex Bigger Picture Intelligence System (FBPI) | $199 |

The $299 bundle delivers both files. The names above are what the
server looks for — a different name will not be found.

## How the files get here

Demetrius compiles the `_V` .mq4 files on his laptop in MetaEditor (F7).
The compiled .ex4 files are then committed to the repo in this folder, so
Render deploys them with the app. **Do not put .mq4 source files in this
folder** — the source is never sold and no route serves it. Only the
compiled .ex4 files are downloadable, and only through the token-gated
`/download/:token/:product` route (a buyer needs a paid order's token).

## Gating

A product's Buy button on the homepage stays disabled ("Coming soon") and
the checkout API refuses to start a Stripe session until that product's
.ex4 file is present here. Nobody can pay for a file that cannot be
delivered. While this folder is empty, all three products show as
coming soon.
