# CLAUDE.md — GEE Ecosystem Functional Attributes App

## Project overview

You are an expert in the Google Earth Engine (GEE) geospatial cloud computing platform, with deep knowledge of its JavaScript API. This project implements a GEE Code Editor application for dense satellite image time series analysis, focused on computing Ecosystem Functional Attributes (EFAs) from MODIS products.

EFAs are annualized, per-pixel statistics that quantify ecologically meaningful aspects of annual spectral or biophysical variable time series — including their central tendency, variability, and phenological timing. These statistics support monitoring of land surface functional states across ecosystems.

---

## Platform and language

- The app is contained in file EFA_Calculator_App.js
- All the remaining folders and files beyond the main app file (EFA_Calculator_App.js) are just to support some parts of the implementation but not meant to be directly used or invoked

- **Environment**: Google Earth Engine Code Editor (JavaScript)
- **API**: GEE JavaScript API (`ee.*` namespace, `ui.*` namespace for GUI)
- **Target runtime**: Browser-based GEE Code Editor at code.earthengine.google.com
- **No Node.js, no Python, no external dependencies** — all code must run natively in the GEE Code Editor

---

## Priority MODIS products

The following MODIS products are the primary data sources. Each product determines which spectral variables and dimensions are available.

| Product     | Resolution | Primary layers / uses                          |
|-------------|------------|------------------------------------------------|
| MOD09Q1     | 250 m      | SR bands 1–2; NDVI, EVI2, NDWI, brightness     |
| MOD09A1     | 500 m      | SR bands 1–7; all spectral indices, TCT        |
| MOD11A1     | 1 km       | LST day/night (daily)                          |
| MOD11A2     | 1 km       | LST day/night (8-day)                          |
| MOD13Q1     | 250 m      | NDVI, EVI (pre-computed VI product)            |
| MOD17A2H    | 500 m      | GPP (gross primary production)                 |
| MCD43A1     | 500 m      | BRDF model parameters; broadband albedo, NBAR  |

When a product is selected, only the variables and indices derivable from that product's available bands should be enabled in the GUI. Enforce this constraint explicitly in code.

---

## Spectral variables and biophysical dimensions

Implement the following dimensions per product where applicable. Define each as a named function that takes an image and returns a single-band image with a consistent band name.

### Vegetation indices
- **NDVI** — Normalized Difference Vegetation Index
- **EVI** — Enhanced Vegetation Index (2-band variant for MOD09Q1)
- **SAVI** — Soil-Adjusted Vegetation Index
- **NDWI** — Normalized Difference Water Index (Gao: NIR/SWIR; McFeeters: Green/NIR)
- **LSWI** — Land Surface Water Index

### Productivity
- **GPP** — Gross Primary Production (MOD17A2H)
- **fPAR** — Fraction of absorbed photosynthetically active radiation (where available)

### Land surface temperature
- **LST_Day** — Daytime land surface temperature (K → °C)
- **LST_Night** — Nighttime land surface temperature
- **LST_Delta** — Diurnal temperature range (Day − Night)

### Albedo and reflectance
- **Albedo_BSA** — Black-sky albedo (shortwave broadband, MCD43A1)
- **Albedo_WSA** — White-sky albedo
- **Surface brightness** — Mean of visible bands

### Tasseled Cap Transforms (TCT)
- **TC_Brightness**
- **TC_Greenness**
- **TC_Wetness**

Compute TCT from MOD09A1 NBAR surface reflectance using published coefficients.

---

## Annual EFA statistics

All statistics are computed per pixel over the annual time series (all composites within the selected calendar year). Implement each as a named reducer or mapping function over an `ee.ImageCollection`.

### Centrality
- `mean` — arithmetic mean
- `median` — 50th percentile
- `p05` — 5th percentile
- `p95` — 95th percentile
- `min` / `max`

### Dispersion
- `iqr` — interquartile range (p95 − p05)
- `std` — standard deviation
- `mad` — median absolute deviation
- `cv` — coefficient of variation (std / mean), masked where mean ≈ 0
- `range` — max − min

### Phenology (circular / DOY statistics)
- `doy_max` — day of year of maximum value
- `doy_min` — day of year of minimum value
- `doy_p05` — day of year when cumulative distribution reaches 5th percentile
- `doy_p95` — day of year when cumulative distribution reaches 95th percentile

**Important**: DOY statistics are circular. Implement trigonometric linearization for DOY values before computing mean or dispersion statistics on them:
- Convert DOY to angle: `θ = 2π × DOY / 365`
- Compute `sin(θ)` and `cos(θ)` component images
- Derive circular mean as `atan2(mean_sin, mean_cos)` and convert back to DOY
- Circular standard deviation: `sqrt(-2 × ln(R))` where `R` is the mean resultant length

### Distributional shape
- `skewness` — (use `ee.Reducer.skew()` or implement manually)
- `kurtosis` — (use `ee.Reducer.kurtosis()` or implement manually)

---

## GUI specification

Build the full GUI using `ui.*` components. The interface must include:

### Panels and layout
- A main side panel (left or right) containing all controls
- A map panel occupying the remaining area
- A results/status panel showing export job status and log messages

### Controls

| Control              | Type                      | Notes                                                     |
|----------------------|---------------------------|-----------------------------------------------------------|
| AOI selector         | Draw on map + geometry input | Support drawn rectangle, polygon, or uploaded asset   |
| Year selector        | Dropdown (`ui.Select`)    | Range: 2000–present (auto-detect available years)         |
| MODIS product        | Dropdown (`ui.Select`)    | Selecting product updates available variables             |
| Target CRS           | Dropdown + text input     | Common options: EPSG:4326, EPSG:32629, custom EPSG        |
| Variable toggles     | Checkboxes (`ui.Checkbox`)| Only show variables valid for selected product            |
| Statistic toggles    | Checkboxes (`ui.Checkbox`)| Grouped by category: centrality / dispersion / phenology  |
| Preview map button   | `ui.Button`               | Visualize a selected variable × statistic on the map      |
| Calculate & export   | `ui.Button`               | Submit one export task per selected combination           |
| Export folder name   | `ui.Textbox`              | Google Drive destination folder                           |
| Clear AOI button     | `ui.Button`               |                                                           |

### Product → variable dependency
Implement a `productConfig` object that maps each product ID to its available variables. When the product selector changes, rebuild the variable checkbox panel to show only valid options and grey out or hide invalid ones.

---

## Export behavior

- Each export task targets Google Drive via `Export.image.toDrive()`
- One task is created per combination of: `year × variable × statistic`
- Filename convention: `{product}_{variable}_{stat}_{year}_EPSG{code}`
- Export at native product resolution unless overridden
- CRS and CRS transform derived from the selected product's native grid or the user-specified CRS
- All exported images are single-band Float32 unless otherwise noted
- Add a confirmation dialog before submitting a large batch (> 10 tasks)

---

## Code architecture


### Key patterns to follow

- Use `ee.Dictionary` and `ee.List` for config-driven logic where possible
- Avoid `.getInfo()` calls in the main flow — use client-side callbacks and `.evaluate()` only where necessary
- All per-pixel computation must use server-side `ee.*` operations
- Use `.aside(print)` during development; remove before final version
- Helper functions and borrowed code from the existing codebase are temporary scaffolding — document them clearly and refactor into the final structure before release

---

## Scientific grounding

### EFA concept

Ecosystem Functional Attributes (EFAs) are derived from the concept of remote sensing-based functional diversity and ecosystem functioning monitoring, as developed in Cabello et al. (2012) and subsequent literature. Key principles:

- EFAs describe the *functional state* of ecosystems through annual summaries of spectral and biophysical time series
- They capture both the *magnitude* (centrality, extremes) and *temporal dynamics* (phenology, variability) of ecosystem activity
- They are spatially explicit, spatially continuous, and annually repeatable — suitable for long-term monitoring and change detection

### Recommended literature to consult

- Cabello et al. (2012) — original EFA framework
- Pettorelli et al. (2005) — NDVI and the dynamic world
- Running et al. (2004) — global GPP from MODIS
- Jetz et al. (2016) — essential biodiversity variables and remote sensing
- Fisher et al. (2017) — vegetation phenology from remote sensing
- Liang (2000) — broadband albedo conversion coefficients

### Variables to investigate further

- Solar-induced fluorescence (SIF) as a productivity proxy
- FAPAR from MODIS LAI/FPAR product (MOD15A2H)
- Fractional cover decomposition
- Burn severity / disturbance indices (NBR, dNBR)

---

## Constraints and best practices

- All GEE API calls must be valid for the JavaScript Code Editor — no Python `geemap` patterns
- Use `.filterDate()`, `.filterBounds()`, and `.select()` early in collection pipelines to minimize computation
- Mask clouds and poor-quality observations using each product's QA/QC band before computing statistics
- For MOD11: mask LST where QC bits indicate poor retrieval
- For MOD09: mask using the `state_1km` or `sur_refl_state_500m` QA band
- Do not hardcode scale factors — apply them from the product metadata where possible
- Output images must be inspectable on the map (add a default visualization layer on preview)
- The app must run end-to-end without errors in the GEE Code Editor on first execution

---
