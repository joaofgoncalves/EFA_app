# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project overview

This is a **Google Earth Engine (GEE) Code Editor application** — a single JavaScript file that runs entirely in the browser at code.earthengine.google.com. It computes Ecosystem Functional Attributes (EFAs) from satellite image time series and exports annual per-pixel statistics to Google Drive.

**No build tools, no tests, no Node.js.** The only "run" command is: paste `EFA_Calculator_App.js` into the GEE Code Editor and click Run.

---

## File roles

| File / Folder | Role |
|---|---|
| `EFA_Calculator_App.js` | **The app.** All production code. Do not break this into modules — GEE Code Editor runs a single script. |
| `TS_SupportScripts/Landsat.js` | Reference implementations of Landsat VI and TCT functions (mission-specific). Read this before adding any Landsat logic. |
| `TS_SeverusCodebase/SeverusPT/DataPreparation/HarmonizedLandsatCollections_v2` | Reference for multi-mission Landsat harmonization (LT5/LT7/LT8, C02/T1_L2, `etmToOli` coefficients). |
| `TS_SeverusCodebase/SeverusPT/DataPreparation/HarmonizedLandsatCollections_TCT_v1` | Reference for applying mission-specific TCT functions per-sensor before merging collections. |
| `TS_SeverusCodebase/SeverusPT/DataPreparation/HarmonizedLandsatCollections_LST_v1` | Reference for extracting LST from Landsat thermal bands (`ST_B10` for LT8, `ST_B6` for LT5/LT7). |
| `TS_SupportScripts/MODIS.js`, `Sentinel2.js` | Reference implementations for MODIS and Sentinel-2 spectral indices. |
| All other folders | Supporting scripts and experiments — not used in the app. |

---

## App architecture (`EFA_Calculator_App.js`)

The file is structured in 10 clearly labelled sections:

| Section | Content |
|---|---|
| 1 | QA mask functions per product (`maskQA_MOD09A1`, `maskQA_MOD11_Day`, etc.) + DOY/circular helpers |
| 2 | Spectral index compute functions (`MOD09A1_SpectralIndices`, `MOD09A1_TCT`, `MOD09A1_burnIndices`, etc.) |
| 3 | BRDF/Albedo functions (`bsAlbedo`, `wsAlbedo`, `computeAllAlbedo_MCD43A1`) |
| 4 | **`PRODUCTS` registry** — the central config object |
| 5 | Statistics engine (`computeStatistic` switch, `viTSdateOfMax/Min`, `gapFillTemporalReducer`) |
| 6 | Collection loading pipeline (`loadAndProcessCollection`, `createExportTask`, `getDefaultVisParams`) |
| 7 | UI widget definitions |
| 8 | Main panel assembly |
| 9 | Event handlers (product change, AOI drawing, calculate button) |
| 10 | Map initialization |

### The `PRODUCTS` registry (Section 4)

Everything data-source-specific lives here. Adding a new satellite product means adding one entry:

```js
'Product Label (res, cadence)': {
  geeId: 'GEE_COLLECTION_ID',
  resolution: 30,                // meters, auto-filled in the Scale input
  temporal: '16-day',            // or 'Daily', '8-day', '4-day'
  qaMask: maskFunctionOrNull,    // product-level QA; null if per-variable
  variables: {
    'VariableName': {
      compute: computeFn,        // fn(img) → single-band image, OR
      band: 'band_name',         // band to select after compute()
      // --- OR direct band selection path: ---
      // band: 'RAW_BAND', scale: 0.0001,
      // --- optional per-variable QA override: ---
      // qaMask: maskFnForThisVar
    }
  }
}
```

There are two routing paths in `loadAndProcessCollection`:
- **compute path**: `varConfig.compute` exists → call `col.map(varConfig.compute).select([varConfig.band])`
- **scale path**: no `compute` → `col.map(img => img.select(band).toFloat().multiply(scale))`

### Product → variable → checkbox chain

When the product dropdown changes (`productSelect.onChange`), `varsPanel` is cleared and rebuilt from `PRODUCTS[key].variables`. The `scaleInput` is auto-set to `product.resolution`. This is the only place where the variable checkbox list is constructed — there is no static variable list.

### Statistics engine (Section 5)

`computeStatistic(yearCol, statName, doyMaxImage)` is a switch over `statName`. To add a new statistic: add it to `STAT_CATEGORIES` (Section 5), add a `case` in `computeStatistic`, and the UI checkbox appears automatically.

`Springness` and `Winterness` depend on `doyMaxImage` being pre-computed; the export loop detects this via `needsDoyMax` and caches `viTSdateOfMax` per variable × year.

---

## Landsat harmonization — reference patterns

### Band naming convention (used in Landsat.js TCT functions)

All TCT and VI functions in `Landsat.js` expect **renamed bands**: `Blue`, `Green`, `Red`, `NIR`, `SWIR1`, `SWIR2`. The harmonization pipeline renames raw GEE band names before applying any index function.

| Sensor | Raw optical bands | Raw thermal |
|---|---|---|
| LT8 (OLI) | `SR_B2,3,4,5,6,7` → `Blue,Green,Red,NIR,SWIR1,SWIR2` | `ST_B10` → `LST` |
| LT7 (ETM+) | `SR_B1,2,3,4,5,7` → same | `ST_B6` → `LST` |
| LT5 (TM) | `SR_B1,2,3,4,5,7` → same | `ST_B6` → `LST` |

Scaling: `SR_B* × 0.0000275 − 0.2` (optical), `ST_B* × 0.00341802 + 149.0` (thermal, Kelvin).

### ETM+→OLI harmonization coefficients

LT5 and LT7 bands are cross-calibrated to OLI equivalents **before** computing indices or TCT. The coefficients object is:

```js
var coefficients = {
  itcps: ee.Image.constant([0.0003, 0.0088, 0.0061, 0.0412, 0.0254, 0.0172]),
  slopes: ee.Image.constant([0.8474, 0.8483, 0.9047, 0.8462, 0.8937, 0.9071])
};
// Applied as: img.multiply(slopes).add(itcps)  (bands: Blue,Green,Red,NIR,SWIR1,SWIR2)
```

**Important**: TCT must be computed **before** the `etmToOli` harmonization step when using mission-specific TCT coefficients (see `HarmonizedLandsatCollections_TCT_v1`). TCT after harmonization should use LT8 coefficients.

### Mission-specific TCT functions (from `Landsat.js`)

Functions follow the naming pattern `lt{5|7|8}_tct{b|g|w}(image)`:
- Returns a single-band image renamed `TCTB`, `TCTG`, or `TCTW`
- Expects renamed bands (`Blue`, `Green`, `Red`, `NIR`, `SWIR1`, `SWIR2`)
- LT5: Crist (1985) coefficients; LT7: Huang et al. (2002); LT8: Baig et al. (2014)

### Cloud masking for Landsat (C02/T1_L2)

`fmask` uses `QA_PIXEL` bits: bit 3 = cloud shadow, bit 5 = cloud.

```js
function fmask(img) {
  var qa = img.select('pixel_qa');  // renamed from QA_PIXEL
  var mask = qa.bitwiseAnd(1 << 3).eq(0).and(qa.bitwiseAnd(1 << 5).eq(0));
  return img.updateMask(mask);
}
```

### Landsat LST

LST is retrieved directly from the Surface Temperature product band (already a physical temperature in Kelvin after scaling). Subtract 273.15 for °C. There is **no emissivity correction needed** — the C02 `ST_B*` bands are fully processed LST, not raw radiance. No mission-specific adjustment is needed since all three sensors provide independently calibrated `ST_B` values.

---

## EFA variables available for Landsat

All the following can be computed from the harmonized Blue/Green/Red/NIR/SWIR1/SWIR2 bands:

| Variable | Formula / notes |
|---|---|
| NDVI | (NIR−Red)/(NIR+Red) |
| EVI | 2.5×(NIR−Red)/(NIR+6×Red−7.5×Blue+1) |
| SAVI | (1+L)×(NIR−Red)/(NIR+Red+L), L=0.5 |
| NDWI | (NIR−SWIR1)/(NIR+SWIR1) — Gao variant |
| NBR | (NIR−SWIR2)/(NIR+SWIR2) |
| TCT_Brightness | Mission-specific coefficients |
| TCT_Greenness | Mission-specific coefficients |
| TCT_Wetness | Mission-specific coefficients |
| LST | `ST_B10` (LT8) / `ST_B6` (LT5, LT7), scaled to K |

---

## Scientific grounding

EFAs are annualized per-pixel statistics characterizing ecosystem functional state:
- **Cabello et al. (2012)** — original EFA framework
- **Alcaraz-Segura et al. (2006)** — EFA application
- **Paruelo et al. (2001)** — ecosystem functional types

Phenology statistics (DOY_Max, Springness, Winterness) are circular: DOY is converted to `sin(2π×DOY/365)` and `cos(2π×DOY/365)` before computing means or spatial analysis.

---

## GEE coding constraints

- No `.getInfo()` in the main flow — use `.evaluate()` with callbacks where needed
- `.filterDate()`, `.filterBounds()`, `.select()` early in every pipeline
- All per-pixel computation uses server-side `ee.*`
- `Export.image.toDrive()` for all outputs; one call per year × variable × statistic combination
- Export filename convention: `{product}_{variable}_{statistic}_{year}[_suffix]`
- No Python/geemap patterns — JavaScript API only
