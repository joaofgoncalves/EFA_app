# EFA Calculator App

`EFA_Calculator_App.js` is a Google Earth Engine Code Editor application for calculating annual Ecosystem Functional Attributes (EFAs) from satellite image time series. It creates one export task per selected year, variable, and annual statistic, and writes the result as a single-band GeoTIFF to Google Drive.

The app is designed for two main use cases:

- Run ready-made EFA calculations from supported MODIS/MCD, Landsat, VIIRS SNPP, Sentinel-1 C-band SAR, PALSAR-2 L-band SAR, Sentinel-2, and Sentinel-3 OLCI products.
- Extend the script with your own variables, indices, statistics, or products by editing the central registries in the app.

There is no build system. Paste or open `EFA_Calculator_App.js` in the Earth Engine Code Editor, click **Run**, configure the side panel, then start the generated export tasks from the Earth Engine **Tasks** tab.

## Table of contents

- [What the app calculates](#what-the-app-calculates)
- [Quick start workflow](#quick-start-workflow)
- [App inputs and parameters](#app-inputs-and-parameters)
- [Area Of Interest options](#area-of-interest-options)
  - [Draw on map](#draw-on-map)
  - [GEE asset](#gee-asset)
- [Available products](#available-products)
  - [MODIS and MCD products](#modis-and-mcd-products)
    - [MODIS Variable Notes](#modis-variable-notes)
  - [Landsat products](#landsat-products)
    - [Landsat Harmonized (multi-mission)](#landsat-harmonized-multi-mission)
    - [Landsat Harmonized processing](#landsat-harmonized-processing)
    - [Individual Landsat mission products](#individual-landsat-mission-products)
    - [HLS S30 Sentinel-2 product](#hls-s30-sentinel-2-product)
  - [Sentinel-2 product](#sentinel-2-product)
    - [Sentinel-2 processing](#sentinel-2-processing)
    - [Sentinel-2 export resolution per variable](#sentinel-2-export-resolution-per-variable)
  - [Sentinel-3 OLCI product](#sentinel-3-olci-product)
    - [Sentinel-3 data type note](#sentinel-3-data-type-note)
    - [Sentinel-3 processing](#sentinel-3-processing)
    - [Sentinel-3 variables](#sentinel-3-variables)
  - [Sentinel-1 SAR product](#sentinel-1-sar-product)
    - [Sentinel-1 SAR variables](#sentinel-1-sar-variables)
    - [Sentinel-1 SAR processing](#sentinel-1-sar-processing)
    - [Known limitations for Sentinel-1](#known-limitations-for-sentinel-1)
  - [PALSAR-2 ScanSAR L2.2 product](#palsar-2-scansar-l22-product)
    - [PALSAR-2 variables](#palsar-2-variables)
    - [PALSAR-2 processing](#palsar-2-processing)
    - [Known limitations for PALSAR-2](#known-limitations-for-palsar-2)
  - [VIIRS SNPP products](#viirs-snpp-products)
    - [VIIRS band topology and spectral notes](#viirs-band-topology-and-spectral-notes)
    - [VIIRS variable notes](#viirs-variable-notes)
    - [VIIRS product details](#viirs-product-details)
- [Annual aggregation functions](#annual-aggregation-functions)
- [QA And cloud masking](#qa-and-cloud-masking)
- [Temporal gap filling](#temporal-gap-filling)
  - [Gap-fill options](#gap-fill-options)
- [Time-series smoothing](#time-series-smoothing)
  - [Whittaker smoother](#whittaker-smoother)
  - [Moving-window smoother](#moving-window-smoother)
  - [Harmonic smoother](#harmonic-smoother)
  - [Edge buffer months](#edge-buffer-months)
- [Specific-months filter](#specific-months-filter)
  - [Within-year and wrap intervals](#within-year-and-wrap-intervals)
  - [Interaction with phenology stats](#interaction-with-phenology-stats)
  - [Interaction with gap fill and smoothing](#interaction-with-gap-fill-and-smoothing)
- [Export options](#export-options)
  - [Export Region, CRS, Scale, And Folder](#export-region-crs-scale-and-folder)
  - [Filename pattern](#filename-pattern)
  - [Float32 encoding](#float32-encoding)
  - [Compact integer encoding](#compact-integer-encoding)
- [Processing order](#processing-order)
- [Extending the app with your own variables](#extending-the-app-with-your-own-variables)
  - [Add a direct catalog band variable](#add-a-direct-catalog-band-variable)
  - [Add a computed MODIS variable](#add-a-computed-modis-variable)
  - [Add a Landsat reflectance index](#add-a-landsat-reflectance-index)
  - [Add a Landsat Tasseled Cap-like variable](#add-a-landsat-tasseled-cap-like-variable)
- [Adding a new product](#adding-a-new-product)
- [Adding a new annual statistic](#adding-a-new-annual-statistic)
- [Practical guidance](#practical-guidance)
- [Code map](#code-map)
- [References mentioned in the app](#references-mentioned-in-the-app)

## What the app calculates

EFAs summarize the annual behavior of a per-pixel time series. The app first loads a satellite product, masks cloudy observations when requested, converts the selected variable into a single-band image collection, optionally fills temporal gaps, and then aggregates each year into annual rasters.

The selected annual statistics can be interpreted as broad EFA dimensions:

| EFA dimension | App statistics | Typical interpretation |
| --- | --- | --- |
| Magnitude | `Mean`, `Median`, `P05`, `P95`, `Min`, `Max`, `CumSum` | Overall level of productivity, temperature, albedo, moisture, or another selected variable. |
| Seasonality / variability | `StdDev`, `IQR`, `MAD`, `CV`, `Amplitude` | Strength and spread of intra-annual variation. |
| Phenology | `DOY_Max`, `DOY_Min`, `Springness`, `Winterness`, `GSL` | Timing of annual maximum/minimum and length or timing proxies for seasonal activity. |

Not every statistic is equally meaningful for every variable. For example, the cumulative sum (`CumSum`) is useful for variables such as GPP or ET, but a cumulative LST value is usually a numerical summary rather than a physical annual energy quantity. Choose variable-statistic pairs that match the ecological question.

## Quick start workflow

1. Open `EFA_Calculator_App.js` in the Google Earth Engine Code Editor.
2. Click **Run**.
3. Define an area of interest using either **Draw on Map** or **GEE Asset**.
4. Select a mission family (MODIS, Landsat, VIIRS, Sentinel-2, Sentinel-3, Sentinel-1, or PALSAR-2) from the mission buttons — the selector is split into an **Optical** row (MODIS, Landsat, VIIRS, Sentinel-2, Sentinel-3) and a **SAR** row (Sentinel-1, PALSAR-2) — then choose a specific product from the dropdown.
5. Select one or more years.
6. Select one or more variables.
7. Select one or more annual statistics.
8. Set export options: CRS, scale (i.e., spatial resolution), Google Drive folder, maximum number of pixels, and raster bit depth/encoding.
9. Leave the QA/cloud mask enabled unless you have a specific reason to inspect unmasked MODIS or VIIRS values.
10. Optionally enable temporal gap filling and/or one of the time-series smoothers.
11. Click **CALCULATE & EXPORT**.
12. Check the preview layer added to the map.
13. Open the Earth Engine **Tasks** tab and start the generated export tasks.

The number of tasks is:

```text
number of selected years x number of selected variables x number of selected statistics
```

Large year ranges, daily products, large AOIs, Landsat exports, or many variables can create many slow tasks. Start with a small AOI and a few statistics when testing a workflow.

## App inputs and parameters

| Panel option | Default | Meaning |
| --- | --- | --- |
| Area of Interest | Draw on Map | Either draw a rectangle/polygon or load a FeatureCollection asset. Multiple drawn geometries are combined. |
| Mission | None | Filters the product dropdown to the selected mission family. |
| Satellite Product | None | Product registry entry to use. Selecting a product rebuilds the variable list and updates the default scale. |
| Year(s) | None | Years from 1982 through 2026 are available in the UI. Data availability depends on each satellite product. |
| Year range button | Product-specific | Convenience button that checks the relevant data years for the selected product. Landsat Harmonized offers multiple range buttons (all years, LT5 era, LT7 era, LT8 era). |
| Variables / Dimensions | None | Single-band variables calculated from the selected product. |
| Annual Statistics | None | Annual aggregation functions applied to each variable-year collection. |
| CRS | `EPSG:4326` | Export projection. Change if you need a projected CRS for distance/area consistency. |
| Scale (m) | Product resolution | Export pixel size in meters. It is auto-filled from the product but can be overridden. |
| Drive folder | `GEE_EFA` | Google Drive folder used by `Export.image.toDrive`. |
| Max pixels | `1e9` | Earth Engine export `maxPixels`. Increase only when necessary. |
| Encoding | `Float32 (original)` | Output numeric encoding: original float values or compact integer values. |
| Apply QA / Cloud Mask | On | Applies MODIS and VIIRS product QA masks. Landsat fmask, HLS Fmask, Sentinel-2 SCL, and Sentinel-3 QA are always applied in their respective pipelines. |
| Apply Temporal Gap Fill | Off | Fills masked pixels from neighboring dates before annual statistics are computed. |
| Apply Whittaker Smoother | Off | Penalized least-squares smoother applied to the time series before annual aggregation. |
| Apply Moving-Window Smoother | Off | Replaces each observation with the median or mean of its temporal neighbors. |
| Apply Harmonic Smoother | Off | Fits a Fourier model to the time series and replaces each observation with the modelled value. |
| Buffer months | 3 (6 for Harmonic) | Extra months loaded before Jan 1 and after Dec 31 to reduce smoother edge effects. Stripped before annual aggregation. |

## Area Of Interest options

### Draw on map

Use **Rectangle** or **Polygon** to digitize an AOI. The app stores the geometry in a map drawing layer named `AOI`. Use **Clear** to remove it and **Hide AOI** / **Show AOI** to toggle display.

If more than one geometry exists in the drawing layer, the app converts the geometries to a FeatureCollection and uses their combined geometry.

### GEE asset

Choose **GEE Asset**, enter a FeatureCollection path such as:

```text
users/name/asset
projects/project-name/assets/asset-name
```

Then click **Load Asset**. The app uses `ee.FeatureCollection(path).geometry()` as the export region and processing bounds.

## Available products

The app currently exposes 31 product choices organized into seven mission families: 9 MODIS/MCD products, 6 Landsat products (harmonized multi-mission plus individual missions), 1 HLS S30 product, 6 VIIRS SNPP products, 1 Sentinel-2 SR product, 1 Sentinel-3 OLCI product, 1 Sentinel-1 C-band SAR product, and 1 PALSAR-2 L-band SAR product. The UI groups products by mission family and splits the mission buttons into two rows — **Optical** (MODIS, Landsat, VIIRS, Sentinel-2, Sentinel-3) and **SAR** (Sentinel-1, PALSAR-2). Selecting a mission button filters the product dropdown to that family.

### MODIS and MCD products

| Product in UI | Earth Engine collection | Resolution | Cadence | Exposed variables |
| --- | --- | --- | --- | --- |
| `MOD09Q1 (250m, 8-day)` | `MODIS/061/MOD09Q1` | 250 m | 8-day | `NDVI` |
| `MOD09A1 (500m, 8-day)` | `MODIS/061/MOD09A1` | 500 m | 8-day | `NDVI`, `EVI`, `SAVI`, `MSAVI`, `NDWI`, `NBR`, `TCT_Brightness`, `TCT_Greenness`, `TCT_Wetness` |
| `MOD11A1 (1km, Daily)` | `MODIS/061/MOD11A1` | 1000 m | Daily | `LST_Day`, `LST_Night` |
| `MOD11A2 (1km, 8-day)` | `MODIS/061/MOD11A2` | 1000 m | 8-day | `LST_Day`, `LST_Night` |
| `MOD13Q1 (250m, 16-day)` | `MODIS/061/MOD13Q1` | 250 m | 16-day | `NDVI`, `EVI` |
| `MOD17A2H (500m, 8-day)` | `MODIS/061/MOD17A2H` | 500 m | 8-day | `GPP`, `PsnNet` |
| `MCD43A1 (500m, Daily)` | `MODIS/061/MCD43A1` | 500 m | Daily | `WSA_vis`, `WSA_nir`, `WSA_shortwave`, `BSA_vis`, `BSA_nir`, `BSA_shortwave`, `Avg_Albedo` |
| `MOD16A2 (500m, 8-day)` | `MODIS/061/MOD16A2` | 500 m | 8-day | `ET` |
| `MCD15A3H (500m, 4-day)` | `MODIS/061/MCD15A3H` | 500 m | 4-day | `LAI`, `FPAR` |

#### MODIS Variable Notes

| Variable group | Products | Implementation notes |
| --- | --- | --- |
| Vegetation indices | `MOD09Q1`, `MOD09A1`, `MOD13Q1` | `MOD09Q1` NDVI is calculated from Red/NIR. `MOD09A1` computes indices from surface reflectance bands. `MOD13Q1` uses catalog NDVI/EVI bands scaled by `0.0001`. |
| `NDVI` | MODIS and Landsat | `(NIR - Red) / (NIR + Red)`. |
| `EVI` | `MOD09A1`, `MOD13Q1`, Landsat | `2.5 * (NIR - Red) / (NIR + 6 * Red - 7.5 * Blue + 1)`. `MOD13Q1` uses the catalog EVI band. |
| `SAVI` | `MOD09A1`, Landsat | `1.5 * (NIR - Red) / (NIR + Red + 0.5)`. |
| `MSAVI` | `MOD09A1` | Modified soil-adjusted vegetation index from Red/NIR. |
| `NDWI` | `MOD09A1`, Landsat | Gao-style NIR/SWIR moisture index. MODIS uses `sur_refl_b06`; Landsat uses `SWIR1`. |
| `NBR` | `MOD09A1`, Landsat | `(NIR - SWIR2) / (NIR + SWIR2)`. In `MOD09A1`, SWIR2 is `sur_refl_b07`. |
| Tasseled Cap | `MOD09A1` | Brightness, greenness, and wetness are calculated with MODIS coefficients from Lobser and Cohen (2007). |
| LST | `MOD11A1`, `MOD11A2` | Catalog LST bands are multiplied by `0.02`. These MODIS LST outputs remain in Kelvin. |
| GPP and PsnNet | `MOD17A2H` | Catalog bands are multiplied by `0.0001`. |
| Albedo | `MCD43A1` | BRDF parameters are scaled by `0.001`. White-sky albedo is diffuse albedo. Black-sky albedo uses a fixed solar zenith angle of 30 degrees. `Avg_Albedo` is the mean of the six WSA/BSA visible, NIR, and shortwave bands. |
| ET | `MOD16A2` | Catalog ET band is multiplied by `0.1`. |
| LAI and FPAR | `MCD15A3H` | LAI is multiplied by `0.1`; FPAR is multiplied by `0.01`. |

The code also computes `CSI` and `MIRBI` inside `MOD09A1_burnIndices`, but the current UI registry exposes only `NBR` from that function. You can expose those bands by adding variable entries in the `PRODUCTS` registry.

### Landsat products

The app offers seven Landsat-family product options: one multi-mission harmonized product, five individual-mission products, and the HLS S30 Sentinel-2 product (cross-calibrated to Landsat 8 OLI). All Landsat-family products use Collection 2 Tier 1 Level 2 data.

#### Landsat Harmonized (multi-mission)

| Product in UI | Earth Engine collections | Resolution | Cadence used by app | Exposed variables |
| --- | --- | --- | --- | --- |
| `Landsat Harmonized (30m, LT5/7/8)` | `LANDSAT/LT05/C02/T1_L2`, `LANDSAT/LE07/C02/T1_L2`, `LANDSAT/LC08/C02/T1_L2` | 30 m | Scene based; `16-day` is used as the nominal gap-fill cadence | `NDVI`, `EVI`, `SAVI`, `NBR`, `NDWI`, `TCT_Brightness`, `TCT_Greenness`, `TCT_Wetness`, `LST` |

The harmonized product merges LT5, LT7, and LT8 into a single time series with cross-sensor reflectance harmonization. It provides convenience year-range buttons: **All Landsat (1984+)**, **LT5 era (1984–2012)**, **LT7 era (1999–2023)**, and **LT8 era (2013+)**.

| Mission | Sensor | Approximate period represented | Notes |
| --- | --- | --- | --- |
| Landsat 5 | TM | 1984-2012 | Collection 2, Tier 1, Level 2. |
| Landsat 7 | ETM+ | 1999–2023 | Collection 2, Tier 1, Level 2. SLC-off gaps after 2003 may remain unless nearby scenes can fill them. |
| Landsat 8 | OLI/TIRS | 2013 onward | Collection 2, Tier 1, Level 2. |

#### Landsat Harmonized processing

The Landsat product is not a single catalog collection. The app builds it each time a Landsat variable is requested:

1. Load LT5, LT7, and LT8 Collection 2 Tier 1 Level 2 scenes for the AOI and date range.
2. Apply official Collection 2 scale factors:
   - Optical SR bands: `SR_B* * 0.0000275 - 0.2`
   - Surface temperature bands: `ST_B* * 0.00341802 + 149.0`
3. Rename bands to a common schema:
   - LT8: `SR_B2,B3,B4,B5,B6,B7` → `Blue,Green,Red,NIR,SWIR1,SWIR2`
   - LT5/LT7: `SR_B1,B2,B3,B4,B5,B7` → `Blue,Green,Red,NIR,SWIR1,SWIR2`
   - LT8 thermal: `ST_B10` → `LST_K`
   - LT5/LT7 thermal: `ST_B6` → `LST_K`
4. Apply Landsat fmask using `QA_PIXEL` cloud shadow bit 3 and cloud bit 5.
5. Route the variable:
   - Reflectance indices (`NDVI`, `EVI`, `SAVI`, `NBR`, `NDWI`): LT5/LT7 are harmonized to OLI-like reflectance using Roy et al. (2016) coefficients before the index is calculated. LT8 is already OLI.
   - Tasseled Cap (`TCT_Brightness`, `TCT_Greenness`, `TCT_Wetness`): mission-specific coefficients are applied before cross-sensor harmonization. LT5 uses Crist (1985), LT7 uses Huang et al. (2002), and LT8 uses Baig et al. (2014).
   - `LST`: `LST_K` is converted to Celsius by subtracting `273.15`.
6. Merge the mission collections and sort by `system:time_start`.

For Landsat, the **Apply QA / Cloud Mask** checkbox does not disable fmask. Cloud and cloud-shadow masking is always applied inside the Landsat pipeline.

#### Individual Landsat mission products

| Product in UI | Earth Engine collection | Period | Sensor | Exposed variables |
| --- | --- | --- | --- | --- |
| `Landsat 4 TM (30m, 1982–1993)` | `LANDSAT/LT04/C02/T1_L2` | 1982–1993 | TM | `NDVI`, `EVI`, `SAVI`, `NBR`, `NDWI`, `TCT_Brightness`, `TCT_Greenness`, `TCT_Wetness`, `LST` |
| `Landsat 5 TM (30m, 1984–2012)` | `LANDSAT/LT05/C02/T1_L2` | 1984–2012 | TM | `NDVI`, `EVI`, `SAVI`, `NBR`, `NDWI`, `TCT_Brightness`, `TCT_Greenness`, `TCT_Wetness`, `LST` |
| `Landsat 7 ETM+ (30m, 1999–2024)` | `LANDSAT/LE07/C02/T1_L2` | 1999–2024 | ETM+ | `NDVI`, `EVI`, `SAVI`, `NBR`, `NDWI`, `TCT_Brightness`, `TCT_Greenness`, `TCT_Wetness`, `LST` |
| `Landsat 8 OLI (30m, 2013+)` | `LANDSAT/LC08/C02/T1_L2` | 2013+ | OLI/TIRS | `NDVI`, `EVI`, `SAVI`, `NBR`, `NDWI`, `TCT_Brightness`, `TCT_Greenness`, `TCT_Wetness`, `LST` |
| `Landsat 9 OLI-2 (30m, 2021+)` | `LANDSAT/LC09/C02/T1_L2` | 2021+ | OLI-2/TIRS-2 | `NDVI`, `EVI`, `SAVI`, `NBR`, `NDWI`, `TCT_Brightness`, `TCT_Greenness`, `TCT_Wetness`, `LST` |

Individual mission products use the `landsat_single` pipeline branch. The key differences from the harmonized product:

- **Single collection only**: no merging of multiple missions; no cross-sensor reflectance harmonization (Roy et al. coefficients are not applied).
- **Spectral indices are computed on native reflectance** for the selected mission.
- **Mission-specific TCT coefficients** apply in the same way as the harmonized pipeline (LT4/LT5: Crist (1985); LT7: Huang et al. (2002); LT8/LT9: Baig et al. (2014)).
- **fmask is always applied** using `QA_PIXEL` cloud shadow bit 3 and cloud bit 5.
- **Landsat 7 note**: SLC-off scan-line gaps are present from May 2003 onward and will produce striped or reduced-coverage annual statistics from that date.
- **Landsat 9 note**: Baig et al. (2014) OLI coefficients are applied to OLI-2, which shares nearly identical spectral characteristics.

Use individual mission products when you need a single-sensor time series or when you are studying a period where only one mission was active. Use the harmonized product when maximizing temporal density across the full Landsat record is the goal.

#### HLS S30 Sentinel-2 product

| Product in UI | Earth Engine collection | Resolution | Cadence | Exposed variables |
| --- | --- | --- | --- | --- |
| `HLS S30 Sentinel-2 (30m, daily)` | `NASA/HLS/HLSS30/v002` | 30 m | Daily (near-daily from combined S2A+S2B) | `NDVI`, `EVI`, `SAVI`, `NBR`, `NDWI`, `TCT_Brightness`, `TCT_Greenness`, `TCT_Wetness` |

The HLS S30 product is part of NASA's Harmonized Landsat Sentinel-2 (HLS) project. It provides surface reflectance from Sentinel-2 MSI cross-calibrated to the Landsat 8 OLI radiometric scale, enabling consistent combined analysis with Landsat. S2A data starts 2015-11-28; select 2016+ for full-year annual statistics.

HLS S30 processing:

1. Load `NASA/HLS/HLSS30/v002` for the AOI and date range.
2. Apply Fmask cloud masking: bit 1 (cloud), bit 2 (adjacent to cloud/shadow), and bit 3 (cloud shadow) are masked.
3. Scale surface reflectance bands (same formula as Landsat C02): `B* * 0.0001`.
4. Rename bands to the common spectral schema, using **B8A (865 nm narrow NIR)** rather than B08 (842 nm broad NIR) to match Landsat Band 5:
   - `B2 → Blue`, `B3 → Green`, `B4 → Red`, `B8A → NIR`, `B11 → SWIR1`, `B12 → SWIR2`
5. Route the variable using the same `LT_INDEX_FNS` and `LT8_TCT_*` functions as the Landsat pipeline.

`LST` is not available for HLS S30 (no thermal band in MSI).

TCT uses **Baig et al. (2014) OLI coefficients** as recommended by NASA for the HLS product because the surface reflectance is cross-calibrated to the OLI radiometric scale.

### Sentinel-2 product

| Product in UI | Earth Engine collection | Resolution | Cadence used by app | Exposed variables |
| --- | --- | --- | --- | --- |
| `Sentinel-2 SR (10/20m, 5-day)` | `COPERNICUS/S2_SR_HARMONIZED` | 10 m (NDVI, EVI, SAVI) / 20 m (NDWI, NBR, TCT) | 5-day nominal | `NDVI`, `EVI`, `SAVI`, `NDWI`, `NBR`, `TCT_Brightness`, `TCT_Greenness`, `TCT_Wetness` |

| Mission | Sensor | Period |
| --- | --- | --- |
| Sentinel-2A | MSI | Level-1C from 2015-06-23; Level-2A SR (harmonized) from 2017-03-28 |
| Sentinel-2B | MSI | Level-2A SR (harmonized) from 2017-03-28 |

#### Sentinel-2 processing

The Sentinel-2 product uses the `COPERNICUS/S2_SR_HARMONIZED` collection, which normalizes the reflectance quantification value across processing baseline versions for long-term time series consistency.

1. Load `COPERNICUS/S2_SR_HARMONIZED` for the AOI and date range.
2. Apply SCL cloud masking: removes cloud shadow (SCL = 3), medium-probability cloud (SCL = 8), high-probability cloud (SCL = 9), and thin cirrus (SCL = 10).
3. Apply scale factor: multiply reflectance bands by `0.0001`.
4. Rename six core bands to the common schema used across all spectral pipelines:
   - `B2 → Blue`, `B3 → Green`, `B4 → Red`, `B8 → NIR`, `B11 → SWIR1`, `B12 → SWIR2`
5. Route the variable:
   - Reflectance indices (`NDVI`, `EVI`, `SAVI`, `NDWI`, `NBR`): computed from renamed SR bands.
   - Tasseled Cap (`TCT_Brightness`, `TCT_Greenness`, `TCT_Wetness`): Shi & Xu (2019) 6-band PCP-derived coefficients, aligned to the Landsat 8 OLI TCT space.
6. Sort by `system:time_start`.

`LST` is not available for Sentinel-2 (no thermal band in MSI).

#### Sentinel-2 export resolution per variable

The export scale is set automatically per variable. The Scale field in the UI shows the product default (20 m) but is overridden per variable during export task creation.

| Variable | Limiting band(s) | Native resolution | Export scale |
| --- | --- | --- | --- |
| `NDVI` | B4 (Red), B8 (NIR) | 10 m | 10 m |
| `EVI` | B2 (Blue), B4 (Red), B8 (NIR) | 10 m | 10 m |
| `SAVI` | B4 (Red), B8 (NIR) | 10 m | 10 m |
| `NDWI` | B8 (NIR), B11 (SWIR1) | 20 m (B11) | 20 m |
| `NBR` | B8 (NIR), B12 (SWIR2) | 20 m (B12) | 20 m |
| `TCT_Brightness`, `TCT_Greenness`, `TCT_Wetness` | B11, B12 (SWIR) | 20 m | 20 m |

For Sentinel-2, the **Apply QA / Cloud Mask** checkbox does not disable SCL masking. Cloud, cloud shadow, and cirrus masking are always applied inside the Sentinel-2 pipeline.

### Sentinel-3 OLCI product

| Product in UI | Earth Engine collection | Resolution | Cadence | Exposed variables |
| --- | --- | --- | --- | --- |
| `Sentinel-3 OLCI (300m, ~2-day)` | `COPERNICUS/S3/OLCI` | 300 m | ~1–2 days (S3A + S3B combined) | `NDVI`, `OTCI`, `NDWI` |

| Mission | Sensor | Period |
| --- | --- | --- |
| Sentinel-3A | OLCI | 2016-10-18 to present |
| Sentinel-3B | OLCI | 2018-04-26 to present |

Sentinel-3 OLCI provides near-daily global coverage at 300 m, making it well suited for monitoring large-area vegetation dynamics at temporal resolutions comparable to MODIS but with the unique advantage of red-edge bands for chlorophyll estimation.

#### Sentinel-3 data type note

The GEE collection `COPERNICUS/S3/OLCI` serves **Level-1 EFR TOA radiances**, not surface reflectance. This means:

- Per-band scale factors differ (each band has its own radiance-to-reflectance scale factor applied in the pipeline before index computation).
- Results are computed from TOA radiances, so atmospheric effects are not corrected. This is the standard source used by the official ESA OTCI product.
- No Tasseled Cap is offered: no published TCT coefficients exist for OLCI in the literature.

#### Sentinel-3 processing

1. Load `COPERNICUS/S3/OLCI` for the AOI and date range.
2. Apply QA masking: removes invalid pixels (quality flag bit 25) and saturated pixels in the five bands used for index computation (Oa06, Oa08, Oa10, Oa11, Oa17).
3. Apply per-band scale factors to convert raw DN to physical radiance values:
   - `Oa06 (Green, 560 nm)` × 0.0123538
   - `Oa08 (Red, 665 nm)` × 0.00876539
   - `Oa10 (681 nm, red-edge 1)` × 0.00773378
   - `Oa11 (709 nm, red-edge 2)` × 0.00675523
   - `Oa17 (NIR, 865 nm)` × 0.00493004
4. Compute the selected variable from the scaled radiances.
5. Sort by `system:time_start`.

QA masking is always applied for Sentinel-3 and cannot be disabled via the **Apply QA / Cloud Mask** checkbox.

#### Sentinel-3 variables

| Variable | Formula / bands used | Notes |
| --- | --- | --- |
| `NDVI` | `(Oa17 − Oa08) / (Oa17 + Oa08)` | NIR (865 nm) vs Red (665 nm). Comparable to MODIS/Landsat NDVI. |
| `OTCI` | `(Oa11 − Oa10) / (Oa10 − Oa08)` | OLCI Terrestrial Chlorophyll Index (Dash & Curran 2004). Exploits the three unique red-edge bands at 665, 681, and 709 nm. Proxy for canopy chlorophyll content. Typical range 0–7 for vegetation. |
| `NDWI` | `(Oa06 − Oa17) / (Oa06 + Oa17)` | McFeeters (1996) variant using Green (560 nm) and NIR (865 nm). Sensitive to open water and vegetation water content. |

OTCI is the main value-added variable unique to OLCI; it cannot be computed from MODIS, Landsat, or Sentinel-2 because it requires the specific red-edge bands at 681 and 709 nm. For compact integer export, OTCI values can exceed the Int16 range and are exported as `Int32 × 10000`.

### Sentinel-1 SAR product

> **Experimental.** SAR-derived EFAs capture radar backscatter dynamics and structural vegetation indices. They are complementary to optical EFAs and especially valuable in persistently cloud-covered regions or for tracking canopy structure and moisture dynamics.

| Product in UI | Earth Engine collection | Resolution | Cadence | Exposed variables |
| --- | --- | --- | --- | --- |
| `Sentinel-1 SAR (10m, ~12-day)` | `COPERNICUS/S1_GRD` | 10 m | ~12 days (S1A alone) / ~6 days (S1A+S1B or S1A+S1C) | `VV`, `VH`, `VV_minus_VH`, `CR`, `IR`, `DpRVI`, `DpRVIc`, `RFDI` |

| Mission | Sensor | Approximate period |
| --- | --- | --- |
| Sentinel-1A | C-band SAR | 2014-10-03 to present |
| Sentinel-1B | C-band SAR | 2016-04-25 to 2021-12-23 (end of life) |
| Sentinel-1C | C-band SAR | 2023-12-05 to present |

Select years 2015 or later to ensure complete calendar-year coverage. Selecting 2014 returns only the Oct–Dec 2014 portion of that year, which will produce annual statistics based on three months of data.

#### Sentinel-1 SAR variables

All variables are derived from Interferometric Wide (IW) swath mode, GRDH imagery filtered to dual-pol VV+VH acquisitions.

| Variable | Formula | Units | Typical range | Notes |
| --- | --- | --- | --- | --- |
| `VV` | VV band direct | dB | −20 to 0 | Co-pol backscatter. Higher over rough surfaces and urban areas. |
| `VH` | VH band direct | dB | −28 to −5 | Cross-pol backscatter. Sensitive to vegetation volume scattering. |
| `VV_minus_VH` | VV_dB − VH_dB | dB | 3–25 | Equivalent to 10·log₁₀(VV/VH) in linear. Higher over bare soil and open land. |
| `CR` | VH_lin / VV_lin | dimensionless linear | 0.01–0.5 | Cross Ratio. Higher with increased canopy volume scattering. |
| `IR` | VV_lin / VH_lin | dimensionless linear | 2–100+ | Inverse Ratio. Inverse of CR. Large over bare or smooth surfaces. |
| `DpRVI` | 4q / (1+q)², q = VH_lin/VV_lin | 0–1 | 0–0.8 | Dual-pol Radar Vegetation Index (Mandal et al. 2020). Increases with vegetation density and structure. |
| `DpRVIc` | DpRVI × (1 − DOP); DOP = \|VV_lin−VH_lin\| / (VV_lin+VH_lin) | 0–1 | 0–0.7 | DpRVI corrected by Degree of Polarization. Equivalent to 8q²/(1+q)³. Penalises high polarimetric contrast. |
| `RFDI` | (VV_lin − VH_lin) / (VV_lin + VH_lin) | −1 to 1 | −0.3–0.7 | Radar Forest Degradation Index (Mitchard et al. 2012). Higher values indicate surface-dominated scattering; lower values indicate intact forest canopy. |

`VV` and `VH` are stored in **dB** in the GEE collection and are exported in dB. `CR`, `IR`, `DpRVI`, `DpRVIc`, and `RFDI` are computed in linear (power) units before being exported as dimensionless values.

#### Sentinel-1 SAR processing

1. Load `COPERNICUS/S1_GRD` for the AOI and date range.
2. Filter to `instrumentMode = IW` and `transmitterReceiverPolarisation` containing both `VV` and `VH`.
3. Ascending and descending orbits are both included; for most EFA applications (annual statistics) the mixing is acceptable. If orbit-specific analysis is required, filter manually in the PRODUCTS registry.
4. Compute the selected variable:
   - `VV`, `VH`: direct band selection; values are already in dB.
   - `VV_minus_VH`: dB difference VV_dB − VH_dB; remains in dB.
   - `CR`, `IR`, `DpRVI`, `DpRVIc`, `RFDI`: convert VV and VH from dB to linear power (`10^(dB/10)`), then apply the index formula.
5. Sort by `system:time_start`.
6. No spatial speckle filtering is applied. For annual EFA statistics, temporal averaging through `Mean`, `Median`, or percentile aggregation handles most speckle. For single-image inspection, speckle can be significant.

**No cloud masking and no temporal gap filling** are applied for Sentinel-1. SAR is cloud-penetrating and operates in all weather conditions. The **Apply QA / Cloud Mask** and **Apply Temporal Gap Fill** controls are automatically disabled in the UI when the Sentinel-1 SAR product is selected.

#### Known limitations for Sentinel-1

- Topographic effects on backscatter are not corrected. In mountainous terrain, steep slopes facing toward or away from the sensor can cause significant backscatter anomalies that are unrelated to surface type.
- Mixing ascending and descending orbit passes introduces small systematic differences in backscatter over sloped terrain due to different incidence angles. For annual aggregation over flat or gently rolling terrain this effect is minor.
- Pre-2015 years will return partial-year data or empty collections.

### PALSAR-2 ScanSAR L2.2 product

> **Experimental.** JAXA's ALOS-2 PALSAR-2 is an **L-band** dual-pol SAR (HH+HV). Compared to Sentinel-1 C-band, L-band penetrates deeper into vegetation canopies and responds more strongly to woody biomass, making it especially useful for forest structure, biomass gradients (up to saturation around 100–150 Mg/ha), degradation/recovery trajectories, and savanna woody-cover change. The L2.2 product is provided as a terrain-flattened, orthorectified γ⁰ NRB/CEOS-ARD composite.

| Product in UI | Earth Engine collection | Resolution | Cadence | Exposed variables |
| --- | --- | --- | --- | --- |
| `PALSAR-2 ScanSAR L2.2 (25m, ~14-day)` | `JAXA/ALOS/PALSAR-2/Level2_2/ScanSAR` | 25 m | ~14 days (ScanSAR) | `HH`, `HV`, `HH_minus_HV`, `RFDI`, `DpRVIc`, `RVI_dp` |

| Mission | Sensor | Approximate period |
| --- | --- | --- |
| ALOS-2 PALSAR-2 | L-band SAR (1.27 GHz) | 2014-08-04 to present |

Select years 2015 or later to ensure complete calendar-year coverage. Selecting 2014 returns only the Aug–Dec portion of that year.

#### PALSAR-2 variables

The L2.2 product provides HH and HV as **16-bit amplitude digital numbers** (not dB, not γ⁰), plus a local incidence angle (`LIN`, deg × 0.01) and a quality bitmask (`MSK`). The app converts DN to γ⁰ via the official relation:

```
γ⁰_dB  = 20·log₁₀(DN) − 83
γ⁰_lin = 10^(γ⁰_dB / 10)
```

All ratio / normalized-difference / vegetation indices are computed in **γ⁰ linear** (or equivalently on `DN²`, since the −83 dB offset cancels). dB subtractions such as `HH_dB − HV_dB` are valid log-ratios and stay in dB. Mixing dB with linear-space formulas is never done.

An unconditional `MSK == 1` (valid-pixel) filter is applied inside every index function, masking out layover, shadow, ocean, and invalid pixels. `LIN` is not exposed as an EFA variable — it is a geometry covariate, not a physical quantity of ecological interest.

| Variable | Formula | Units | Typical range | Notes |
| --- | --- | --- | --- | --- |
| `HH` | `20·log₁₀(DN_HH) − 83` | dB | −20 to 0 | Co-pol backscatter. Surface + double-bounce scattering + contribution from woody structure under the canopy at L-band. |
| `HV` | `20·log₁₀(DN_HV) − 83` | dB | −25 to −5 | Cross-pol backscatter. Volume scattering from the canopy; the single most informative channel for woody cover and biomass below saturation. |
| `HH_minus_HV` | `HH_dB − HV_dB` | dB | 2 to 15 | Polarimetric log-ratio (= 10·log₁₀(HH_lin/HV_lin)). Higher over surface-dominated scattering. |
| `RFDI` | `(HH_lin − HV_lin) / (HH_lin + HV_lin)` | dimensionless | −0.3 to 0.5 | Radar Forest Degradation Index (Mitchard et al. 2012). Lower over intact forest, higher over degraded / open land. |
| `DpRVIc` | `q(q+3) / (q+1)²`, `q = HV_lin/HH_lin` | 0–1 | 0–0.9 | Intensity-only dual-pol radar vegetation index variant; proxy for scattering complexity/randomness. |
| `RVI_dp` | `4·HV_lin / (HH_lin + HV_lin)` | 0 to ~1.3 | 0–1 | Dual-pol RVI approximation. **Use with caution**: heuristic derivative of the full-pol RVI, informative but not a fundamental dual-pol index. |

`HH`, `HV`, and `HH_minus_HV` are exported in dB; `RFDI`, `DpRVIc`, and `RVI_dp` are exported as dimensionless quantities computed in linear space.

**Deliberately excluded** because the L2.2 product provides only HH, HV amplitude (no VV, no phase, no complex C₂ matrix): the canonical `DpRVI` (Mandal et al. 2020, which requires the complex 2×2 covariance matrix), Freeman–Durden decomposition, Cloude–Pottier entropy/alpha, coherence, full-pol RVI, and PRVI. Texture layers (GLCM) are also out of scope for this per-pixel annual-EFA app.

#### PALSAR-2 processing

1. Load `JAXA/ALOS/PALSAR-2/Level2_2/ScanSAR` for the AOI and date range. No additional catalog-level filters are applied.
2. For each image, apply `MSK == 1` to retain only valid terrestrial pixels.
3. Compute the selected variable:
   - `HH`, `HV`, `HH_minus_HV`: compute γ⁰ in dB (`20·log₁₀(DN) − 83`); dB log-ratio for `HH_minus_HV`.
   - `RFDI`, `DpRVIc`, `RVI_dp`: convert to γ⁰ linear first, then apply the index formula.
4. Sort by `system:time_start`.
5. No spatial speckle filtering is applied. Annual aggregation (`Mean`, `Median`, percentiles) handles most speckle; for single-image inspection, speckle can be significant.

**No cloud masking, no temporal gap filling, and no smoothers** are applied for PALSAR-2. SAR is cloud-penetrating and operates in all weather conditions. The **Apply QA / Cloud Mask**, **Apply Temporal Gap Fill**, and smoother controls are automatically disabled in the UI when PALSAR-2 is selected.

#### Known limitations for PALSAR-2

- **L2.2 is intensity-only** — no VV/VH, no complex/phase information. Full-polarimetric products (DpRVI canonical, Freeman–Durden, Cloude–Pottier, coherence) are not computable from this collection.
- **HV biomass saturation**: HV-based biomass relationships saturate globally around 100–150 Mg/ha. For dense tropical forests, treat PALSAR-2 indices as relative gradient and change detectors rather than absolute biomass estimators without external calibration.
- **Processing version discontinuities**: JAXA updated the L2.2 processor for acquisitions from July 2024 onward (new reference DEM, improved terrain corrections, reduced inter-scan discontinuities). When searching for subtle trends or small anomalies, verify properties such as `DataAccess_SoftwareVersion`, `DataAccess_ProcessingTime`, `PassDirection`, and `BeamID` rather than assuming perfect homogeneity across the archive.
- **ScanSAR resolution**: nominal 25 m pixel but effectively a medium-resolution product; small perturbations (< 1 ha) may be omitted at the native pixel.
- **Temporal sampling**: ScanSAR revisit is roughly every 14 days but gaps can be longer in some regions; annual statistics are more robust than single-date inspection.
- Pre-2015 years return partial-year data.

### VIIRS SNPP products

The Visible Infrared Imaging Radiometer Suite (VIIRS) on the Suomi NPP satellite provides MODIS-continuity land products from 2012 onward. All VIIRS products are available from 2012+ and use the same MODIS-style pipeline branch in the app. No Tasseled Cap is offered for VIIRS: published TCT coefficients (Zhang et al. 2016, Zheng et al. 2017) were calibrated on the native 750 m M-band reflectance and do not directly apply to the 500 m gridded composites in these products.

| Product in UI | Earth Engine collection | Resolution | Cadence | Exposed variables |
| --- | --- | --- | --- | --- |
| `VNP13A1 (500m, 16-day)` | `NASA/VIIRS/002/VNP13A1` | 500 m | 16-day | `NDVI`, `EVI`, `EVI2`, `SAVI`, `MSAVI`, `NDWI`, `NBR` |
| `VNP09GA (1km, Daily)` | `NASA/VIIRS/002/VNP09GA` | 1000 m | Daily | `NDVI`, `EVI`, `EVI2`, `SAVI`, `MSAVI`, `NDWI`, `NBR`, `Albedo_SW` |
| `VNP09H1 (500m, 8-day)` | `NASA/VIIRS/002/VNP09H1` | 500 m | 8-day | `NDVI`, `NDWI`, `SAVI`, `MSAVI` |
| `VNP43IA4 (500m, Daily)` | `NASA/VIIRS/002/VNP43IA4` | 500 m | Daily | `NDVI`, `NDWI`, `SAVI`, `MSAVI` |
| `VNP15A2H (500m, 8-day)` | `NASA/VIIRS/002/VNP15A2H` | 500 m | 8-day | `LAI`, `FPAR` |
| `VNP21A1D (1km, Daily)` | `NASA/VIIRS/002/VNP21A1D` | 1000 m | Daily | `LST_Day` |

#### VIIRS band topology and spectral notes

VIIRS provides two types of imagery bands at different resolutions:

- **M-bands (1 km native, gridded to 1 km or 500 m)**: M3=Blue (488 nm), M4=Green (555 nm), M5=Red (672 nm), M7=NIR (865 nm), M8=SWIR1 (1240 nm), M10=SWIR2 (1610 nm), M11=SWIR3 (2250 nm). The 7-band M-band topology closely mirrors MODIS bands 1–7.
- **I-bands (500 m native)**: I1=Red (640 nm), I2=NIR (865 nm), I3=SWIR (1610 nm). Three bands only; no Blue band, no 2.1 µm SWIR3.

GEE Collection V002 for all VIIRS products serves reflectance and VI bands already in decimal form (scale factor pre-applied). Do **not** apply an additional `1e-4` multiplier.

#### VIIRS variable notes

| Variable | Products | Notes |
| --- | --- | --- |
| `NDVI` | All VIIRS SR/VI products | `(NIR − Red) / (NIR + Red)`. |
| `EVI` | `VNP13A1`, `VNP09GA` | `2.5 × (NIR − Red) / (NIR + 6×Red − 7.5×Blue + 1)`. Requires M-band Blue. Not available for I-band-only products. |
| `EVI2` | `VNP13A1`, `VNP09GA` | `2.5 × (NIR − Red) / (NIR + 2.4×Red + 1)`. Blue-free, soil-adjusted EVI surrogate (Jiang et al. 2008). Provided alongside EVI for products with M-bands; serves as the EVI proxy for contexts where Blue is unavailable. |
| `SAVI` | All VIIRS SR products | `1.5 × (NIR − Red) / (NIR + Red + 0.5)`. |
| `MSAVI` | All VIIRS SR products | Modified SAVI; removes the need for an empirical soil factor L. |
| `NDWI` | All VIIRS SR products | Gao variant: `(NIR − SWIR) / (NIR + SWIR)`. Uses M8 (1240 nm) for M-band products and I3 (1610 nm) for I-band products. |
| `NBR` | `VNP13A1`, `VNP09GA` | `(NIR − SWIR3) / (NIR + SWIR3)`. Uses M11 (2250 nm). Not available for I-band products (no 2.1 µm band). |
| `Albedo_SW` | `VNP09GA` | Liang (2001) narrowband-to-broadband shortwave albedo using M-band coefficients adapted for VIIRS spectral positions. Formula: `0.160×M5 + 0.291×M7 + 0.243×M3 + 0.116×M4 + 0.112×M8 + 0.081×M11 − 0.0015`. Physically grounded surface albedo proxy. |
| `LAI` | `VNP15A2H` | Leaf Area Index. GEE V002 serves in physical units (area fraction); scale factor of 1 applied. |
| `FPAR` | `VNP15A2H` | Fraction of Photosynthetically Active Radiation. GEE V002 serves in 0–1 units; scale factor of 1 applied. |
| `LST_Day` | `VNP21A1D` | Daily daytime Land Surface Temperature in Kelvin. GEE V002 serves in physical units (K); scale factor of 1 applied. |

#### VIIRS product details

**`VNP13A1 (500m, 16-day)`** — Vegetation Indices, 500 m, 16-day composite. Equivalent to MOD13A1. Uses the full 7-band M-band reflectance including SWIR3 for NBR. QA mask uses `pixel_reliability` ≤ 1 (Excellent and Good classes only); this is slightly stricter than the MOD13Q1 policy which also keeps Acceptable (value 2).

**`VNP09GA (1km, Daily)`** — Daily surface reflectance, 1 km, M-bands. Equivalent to MOD09GA. Provides the richest VIIRS variable set including `Albedo_SW`. QA mask uses `QF1` cloud detection (bits 2–3 ≤ 1, confident/probably clear) and `QF2` cloud shadow and cirrus flags. This product is computationally intensive for large AOIs due to its daily cadence.

**`VNP09H1 (500m, 8-day)`** — Surface reflectance 8-day composite, 500 m, I-bands. Equivalent to MOD09A1 at 500 m but with I-band topology. Only three bands available (Red, NIR, SWIR1). No EVI, no EVI2 (no Blue), no NBR (no 2.1 µm). NDWI here uses the 1.6 µm I3 band (NDWI/NDMI short-SWIR variant). QA mask uses `SurfReflect_State_500m` with the same bit structure as MOD09A1.

**`VNP43IA4 (500m, Daily)`** — Nadir BRDF-Adjusted Reflectance (NBAR), 500 m, I-bands. Daily product providing BRDF-corrected surface reflectance at a fixed nadir view angle. Reduces angular effects present in off-nadir acquisitions. Uses the same three I-bands (I1, I2, I3) as VNP09H1. QA mask requires both I1 and I2 BRDF inversion quality ≤ 1 (full inversion or magnitude inversion).

**`VNP15A2H (500m, 8-day)`** — LAI/FPAR, 500 m, 8-day composite. Equivalent to MCD15A3H. QA mask mirrors the MODIS LAI/FPAR policy: `FparLai_QC` MODLAND QA ≤ 1, plus `FparExtra_QC` cloud confidence ≤ 1, no cloud shadow, no thin cirrus.

**`VNP21A1D (1km, Daily)`** — Day Land Surface Temperature and Emissivity, 1 km, daily. Equivalent to MOD21A1D; uses a Temperature Emissivity Separation (TES) algorithm rather than the split-window method used by MOD11. Provides only `LST_Day` (daytime). QA mask keeps pixels where mandatory QA bits 0–1 ≤ 1 (good quality or unreliable-but-retrieved), matching the MOD11 masking policy.

## Annual aggregation functions

The following statistics are exposed under **Annual Statistics**.

| UI name | Category | Calculation |
| --- | --- | --- |
| `Mean` | Centrality and extremes | Annual mean of the single-band image collection. |
| `Median` | Centrality and extremes | Annual median. |
| `P05` | Centrality and extremes | 5th percentile. |
| `P95` | Centrality and extremes | 95th percentile. |
| `Min` | Centrality and extremes | Minimum observed value in the annual collection. |
| `Max` | Centrality and extremes | Maximum observed value in the annual collection. |
| `StdDev` | Dispersion | Standard deviation. |
| `IQR` | Dispersion | `P95 - P05`. This is an inter-percentile range, not the conventional `P75 - P25` IQR. |
| `MAD` | Dispersion | Median absolute deviation from the annual median. |
| `CV` | Dispersion | `StdDev / abs(Mean)`, with a minimum denominator of `1e-10` to avoid division by zero. |
| `DOY_Max` | Phenology | Day of year of the maximum value. |
| `DOY_Min` | Phenology | Day of year of the minimum value. |
| `Springness` | Phenology | `sin(2 * pi * DOY_Max / 365)`. Circular transform of the timing of peak activity. |
| `Winterness` | Phenology | `cos(2 * pi * DOY_Max / 365)`. Circular transform of the timing of peak activity. |
| `GSL` | Phenology | Count of observations above the annual median. It is observation-count based, not calendar-day based. |
| `CumSum` | Integration | Sum of all observations in the annual collection. It is not multiplied by the number of days represented by each observation. |
| `Amplitude` | Integration | `Max - Min`. |

Implementation note: the app derives DOY with Earth Engine `img.date().getRelative('day', 'year')`. This is a zero-based day index in Earth Engine, so January 1 is `0`. If your downstream workflow requires conventional one-based DOY, add 1 after export or adjust `addDOYband()`.

`Springness` and `Winterness` depend on `DOY_Max`. The export loop pre-computes `DOY_Max` once per variable-year when one of those statistics is requested.

## QA And cloud masking

The **Apply QA / Cloud Mask** option is enabled by default. It controls MODIS/MCD and VIIRS QA masks. When unchecked, the app skips the product-level and variable-level masks defined in the registry for those sensor families.

Landsat fmask, HLS Fmask, Sentinel-2 SCL, and Sentinel-3 QA masking are always applied inside their respective pipelines regardless of this checkbox.

| Product | QA behavior when masking is enabled |
| --- | --- |
| `MOD09Q1` | Uses `State` bits for clear cloud state, no cloud shadow, no cirrus, and no internal cloud. |
| `MOD09A1` | Uses `StateQA` bits for clear cloud state, no cloud shadow, no cirrus, and no internal cloud. |
| `MOD13Q1` | Keeps `SummaryQA <= 1`, meaning good and marginal observations; excludes snow/ice and cloudy classes. |
| `MOD11A1`, `MOD11A2` | Uses `QC_Day` for `LST_Day` and `QC_Night` for `LST_Night`; keeps MODLAND QA values `0` and `1`. |
| `MOD17A2H` | Uses `Psn_QC`; keeps good MODLAND QA, no cloud, and no significant cloud/ice contamination. |
| `MCD43A1` | Keeps mandatory BRDF/albedo quality for bands 1 and 2 less than or equal to `1`. |
| `MOD16A2` | Uses `ET_QC`; keeps MODLAND QA values `0` and `1` and requires no cloud. |
| `MCD15A3H` | Uses `FparLai_QC` plus `FparExtra_QC`; removes cloud, cloud shadow, and significant cloud/ice contamination. |
| `VNP13A1` | Uses `pixel_reliability` ≤ 1 (Excellent and Good classes only). |
| `VNP09GA` | Uses `QF1` cloud detection (≤ 1) and `QF2` cloud shadow and cirrus flags. |
| `VNP09H1` | Uses `SurfReflect_State_500m` bits for clear cloud state, no cloud shadow, no cirrus, and no internal cloud. |
| `VNP43IA4` | Requires BRDF inversion quality ≤ 1 for I1 (Red) and I2 (NIR) bands. |
| `VNP15A2H` | Uses `FparLai_QC` plus `FparExtra_QC` cloud confidence, cloud shadow, and thin cirrus flags. |
| `VNP21A1D` | Uses mandatory QA bits 0–1 ≤ 1 (good quality or unreliable-but-retrieved). |
| `Landsat Harmonized` | Always uses fmask from `QA_PIXEL`: cloud shadow bit 3 must be `0`, and cloud bit 5 must be `0`. The QA mask checkbox does not disable this. |
| Individual Landsat missions | Same fmask policy as Landsat Harmonized. The QA mask checkbox does not disable this. |
| `HLS S30 Sentinel-2` | Always uses HLS Fmask: cloud bit 1, adjacent cloud/shadow bit 2, and cloud shadow bit 3 are masked. The QA mask checkbox does not disable this. |
| `Sentinel-2 SR` | Always uses SCL: cloud shadow (SCL = 3), medium cloud (SCL = 8), high cloud (SCL = 9), and thin cirrus (SCL = 10) are masked. The QA mask checkbox does not disable this. |
| `Sentinel-3 OLCI` | Always applies QA: invalid pixels (quality flag bit 25) and saturated pixels in the five computation bands are masked. The QA mask checkbox does not disable this. |
| `Sentinel-1 SAR` | Not applicable. SAR is cloud-penetrating. The QA mask checkbox is automatically disabled when this product is selected. |
| `PALSAR-2 ScanSAR L2.2` | SAR is cloud-penetrating; the QA mask checkbox is automatically disabled. An unconditional `MSK == 1` valid-pixel filter (masks layover, shadow, ocean, invalid) is applied inside every index function and cannot be disabled. |

Masking improves scientific quality but reduces the number of valid observations. This matters for `CumSum`, `GSL`, and phenology metrics because those statistics depend strongly on how many valid dates remain.

## Temporal gap filling

Temporal gap filling is optional and disabled by default. It is applied after masking and variable calculation, but before the final annual statistic. Gap filling is **not available for SAR products (Sentinel-1 and PALSAR-2)**; the control is disabled in the UI and the pipeline bypasses it internally.

When enabled, the app:

1. Sorts the image collection by `system:time_start`.
2. For each image, builds a centered window of neighboring images by image count.
3. Computes either the local `Median` or local `Mean`.
4. Fills only masked pixels in the focal image with the local reducer.
5. Preserves original valid pixels.
6. Loads extra dates before January 1 and after December 31 so year-edge observations can be filled from neighboring dates.
7. Filters the filled collection back to the requested calendar year before annual aggregation.

### Gap-fill options

| Option | Values | Meaning |
| --- | --- | --- |
| Method | `Median`, `Mean` | Median is more robust to outliers. Mean is smoother but more sensitive to unusual values. |
| Window | Odd integer `>= 3` | Number of images in the centered window. A window of `5` uses two observations before and two after the focal image when available. |

The window is based on image count, not an exact number of days. The real time span depends on product cadence and data availability:

| Product cadence | Window 5 approximate meaning |
| --- | --- |
| Daily | Around two days before and after the focal image. |
| 4-day | Around two 4-day composites before and after. |
| 8-day | Around two 8-day composites before and after. |
| 16-day / Landsat nominal | Around two nominal acquisitions before and after, but Landsat scene availability varies strongly by path, row, cloud cover, and mission. |

Gap filling cannot invent valid values where the whole local window is masked. It is best understood as local temporal infilling, not a full time-series reconstruction model.

Filenames from gap-filled runs include:

```text
_GF{Method}W{Window}
```

For example:

```text
MOD13Q1_NDVI_Mean_2020_GFMedianW5
```

## Time-series smoothing

Three experimental smoothers can be applied to the annual time series after masking and variable calculation but before annual statistics are computed. Only one smoother can be active at a time. Smoothing is **not available for SAR products (Sentinel-1 and PALSAR-2)**; the controls are automatically disabled when a SAR product is selected.

The processing order when multiple options are combined is: gap fill → Whittaker (or Moving-Window, or Harmonic) → filter to calendar year → annual statistics.

### Whittaker smoother

Applies a penalized least-squares fit with 3rd-order differences to the full annual time series. The smoothed curve minimizes the sum of squared residuals plus a roughness penalty controlled by **Lambda**.

| Option | Values | Meaning |
| --- | --- | --- |
| Lambda | Positive number | Smoothing strength. 1–5: light; 10: moderate; 50–100: heavy. |

Masked pixels are temporarily set to zero before smoothing, so enabling gap fill first is recommended to avoid pulling the smooth curve toward zero in cloudy periods.

Filenames include `_WS{lambda}`.

### Moving-window smoother

Replaces each pixel value with the median or mean of its temporal neighbors within a centered sliding window. Window size is counted in images, not calendar days.

| Option | Values | Meaning |
| --- | --- | --- |
| Method | `Median`, `Mean` | Median is more robust to outliers; mean is smoother. |
| Window size | Odd integer `>= 3` | Number of images in the centered window. 3–5: light; 7–9: moderate; 11+: heavy. |

The original mask is restored after smoothing, so genuinely missing observations remain absent from annual statistics.

Filenames include `_MW{m|M}{window}` (`m` = Median, `M` = Mean).

### Harmonic smoother

Fits a Fourier model to the pixel time series using ordinary least squares and replaces every observation with the modelled value at its timestamp. The model is:

```text
y(t) = c0 + Σ[k=1..N] ( c_sin_k · sin(2πkt) + c_cos_k · cos(2πkt) )
```

where `t` is time in fractional years from the first observation in the loaded window and `N` is the number of harmonics.

| Option | Values | Meaning |
| --- | --- | --- |
| Harmonics | `1`, `2`, or `3` | 1 = annual cycle only (3 params); 2 = + semi-annual (5 params); 3 = + tertiary (7 params). |

Masked pixels are excluded from the OLS fit naturally. Pixels with no valid observations across the entire loaded window remain masked in the output. Because the output is a parametric fit rather than a smoothed observation, the harmonic smoother fills gaps and generates continuous annual curves even where cloudiness is high.

Filenames include `_HS{N}`.

### Edge buffer months

All three smoothers can load extra data before January 1 and after December 31. Smoothing at the start and end of a year is affected by edge effects when only one-sided neighbors are available. Loading extra months on both sides gives the smoother bilateral context at the boundaries; the buffer is then stripped before annual statistics are computed.

| Option | Default | Meaning |
| --- | --- | --- |
| Buffer months | 3 (Whittaker, Moving-Window) / 6 (Harmonic) | Number of calendar months added before Jan 1 and after Dec 31 before smoothing. Set to 0 to disable. |

The 6-month default for the harmonic smoother improves parameter estimation (intercept and harmonic amplitudes/phases) particularly when a full annual cycle is needed for stable OLS fitting.

When buffer months are used, the filename includes `_B{N}`:

```text
MOD09A1_NDVI_Mean_2020_HS2_B6
MOD13Q1_NDVI_Mean_2020_GFMedianW5_WS10_B3
```

## Specific-months filter

Annual EFAs are traditionally computed over the full calendar year, but many ecological questions are better answered by a **within-year seasonal window**: dry-season greenness, wet-season productivity, the summer photosynthetic peak, the winter dormancy trough, a post-monsoon SAR composite, and so on. The **Filter by specific months** checkbox in the side panel restricts the temporal window used for the annual statistic to a contiguous range of months, optionally wrapping across the year boundary.

When the checkbox is enabled, two dropdowns appear for **Start month** and **End month** (`Jan`…`Dec`), with a live preview showing the resulting interval. The final collection is trimmed to that interval before the annual statistic is computed.

### Within-year and wrap intervals

The filter supports three use cases:

| Case | Start → End | Interval used | Notes |
| --- | --- | --- | --- |
| Single month | `Jul → Jul` | `Jul 1 – Aug 1` of the selected year | Any single month is a valid window. |
| Multi-month within year | `Jun → Sep` | `Jun 1 – Oct 1` of the selected year | End month is **inclusive**. |
| Wrap across year boundary | `Nov → Feb` | `Nov 1 {year} – Mar 1 {year+1}` | When End month is earlier than Start month, the interval wraps. The selected year refers to the **start** year of the wrap. |
| Full year | `Jan → Dec` | Same as the filter being off | Silently treated as a no-op; no filename suffix is appended. |

Selecting `Jan → Dec` with the checkbox on has no effect; disable the checkbox instead for clarity.

### Interaction with phenology stats

Phenology statistics (`DOY_Max`, `DOY_Min`, `Springness`, `Winterness`, `GSL`) require a complete 12-month cycle to be meaningful — `DOY_Max` within a 3-month window is degenerate, and `Springness`/`Winterness` rely on circular DOY transforms over the full year. When the filter is active, these statistics are automatically **disabled in the UI**. If any of them are somehow selected, the Calculate button returns an error and no export tasks are created.

All other statistic families remain available:

- Centrality: `Mean`, `Median`
- Extremes: `Min`, `Max`, `P10`, `P90`
- Dispersion: `StdDev`, `CV`, `IQR`
- Integration: `CumSum`

These are all well-defined on a partial-year window.

### Interaction with gap fill and smoothing

The month filter is applied **after** gap fill and smoothing and **after** the smoother edge buffer is stripped. Concretely, the loading window is still expanded by any gap-fill window, moving-window window, or smoother buffer months around the **full calendar year** (not around the month interval). This preserves bilateral temporal context for the smoother across the whole seasonal cycle, and avoids edge artefacts when the month interval boundaries are chosen in the middle of a seasonal transition. Only after all smoothing runs is the collection trimmed to the requested month interval.

The filter combines freely with SAR products too: Sentinel-1 and PALSAR-2 bypass gap fill and smoothers, but the month interval is still applied before annual statistics are computed.

Filenames from month-filtered runs include:

```text
_MO{startMonth}_{endMonth}
```

with 1-based month numbers. For example:

```text
MOD13Q1_NDVI_Mean_2020_MO6_9              # Jun-Sep 2020
S1_VH_Median_2020_MO11_2                  # Nov 2020 - Feb 2021 (wrap)
PALSAR-2_HV_Mean_2020_MO7_9               # Jul-Sep 2020
```

## Export options

The app uses `Export.image.toDrive()` for every selected year-variable-statistic combination.

### Export Region, CRS, Scale, And Folder

| Export field | App behavior |
| --- | --- |
| `image` | The annual statistic image, clipped to the AOI and encoded according to the selected export encoding. |
| `description` | Same as the generated file prefix. |
| `fileNamePrefix` | Same as the generated task description. |
| `folder` | Drive folder from the UI, default `GEE_EFA`. |
| `region` | AOI geometry. |
| `crs` | CRS text box, default `EPSG:4326`. |
| `scale` | Scale text box. It is auto-set to the product resolution when the product changes. |
| `maxPixels` | Max pixels text box, default `1e9`. |

### Filename pattern

Base filename:

```text
{ProductShort}_{Variable}_{Statistic}_{Year}
```

`ProductShort` is the first word in the product label (e.g., `MOD09A1`, `LandsatH`, `HLSS30`, `VNP13A1`, `Sentinel2`, `Sentinel3`). Examples:

```text
MOD09A1_NDVI_Mean_2020
MOD11A2_LST_Day_Max_2018
MCD43A1_Avg_Albedo_Median_2021
LandsatH_NBR_DOY_Max_2003
Landsat_NDVI_Mean_2005          (individual mission products)
HLSS30_NDVI_Mean_2022
VNP13A1_EVI2_Mean_2020
VNP21A1D_LST_Day_Median_2019
Sentinel3_OTCI_Mean_2021
```

Optional suffixes are appended in this order: gap fill, Whittaker, Moving-Window, Harmonic, specific-months filter, compact encoding.

| Active option | Suffix pattern | Example |
| --- | --- | --- |
| Gap fill | `_GF{Method}W{Window}` | `_GFMedianW5` |
| Whittaker smoother | `_WS{lambda}` | `_WS10` |
| Moving-window smoother | `_MW{m\|M}{window}` | `_MWm5` (Median), `_MWM7` (Mean) |
| Harmonic smoother | `_HS{N}` | `_HS2` |
| Buffer months (any smoother) | `_B{months}` appended to the smoother suffix | `_WS10_B3`, `_HS2_B6` |
| Specific-months filter | `_MO{startMonth}_{endMonth}` (1-based) | `_MO6_9` (Jun-Sep), `_MO11_2` (Nov-Feb, wraps) |
| Compact integer encoding | `_{i16\|i32}x{factor}` | `_i16x10000` |

Full examples:

```text
MOD13Q1_NDVI_Mean_2020_GFMedianW5_i16x10000
MOD09A1_NDVI_Mean_2020_WS10_B3
MOD09A1_NDVI_Mean_2020_HS2_B6
Sentinel2_NDVI_Mean_2021_MWm5_B3_i16x10000
VNP13A1_NDVI_Mean_2020_GFMedianW5_i16x10000
```

### Float32 encoding

`Float32 (original)` is the default. The app exports the statistic as Float32 with no integer scale factor and no encoding suffix. This is the safest option when you want to avoid quantization or integer clipping.

### Compact integer encoding

`Compact integer (auto)` reduces file size by scaling values and casting them to `Int16` or `Int32`. To recover the original approximate value, divide by the factor in the filename.

| Statistic / variable case | Export type | Factor | Filename suffix | Recovery |
| --- | --- | --- | --- | --- |
| `DOY_Max`, `DOY_Min`, `GSL` | `Int16` | `1` | `_i16x1` | Use values directly. |
| `Springness`, `Winterness` | `Int16` | `10000` | `_i16x10000` | Divide by `10000`. |
| `CV`, `CumSum` | `Int32` | `10000` | `_i32x10000` | Divide by `10000`. |
| `LST`, `ET`, `LAI`, TCT variables, albedo variables, `OTCI` | `Int32` | `10000` | `_i32x10000` | Divide by `10000`. |
| Formula-derived `EVI` except `MOD13Q1` catalog EVI | `Int32` | `10000` | `_i32x10000` | Divide by `10000`. |
| SAR dB variables: `VV`, `VH`, `VV_minus_VH`, `HH`, `HV`, `HH_minus_HV` | `Int16` | `100` | `_i16x100` | Divide by `100` to recover dB. |
| Sentinel-1 `IR` (can exceed 100 over bare surfaces) | `Int32` | `10000` | `_i32x10000` | Divide by `10000`. |
| Sentinel-1 `CR`, `DpRVI`, `DpRVIc`, `RFDI` (0–1 range) | `Int16` | `10000` | `_i16x10000` | Divide by `10000`. |
| PALSAR-2 `RFDI`, `DpRVIc`, `RVI_dp` (bounded range) | `Int16` | `10000` | `_i16x10000` | Divide by `10000`. |
| Other cases | `Int16` | `10000` | `_i16x10000` | Divide by `10000`. |

Before integer casting, the app multiplies by the factor and clamps to the chosen integer range:

| Type | Range |
| --- | --- |
| `Int16` | `-32768` to `32767` |
| `Int32` | `-2147483648` to `2147483647` |

Compact mode is useful for storage and GIS interoperability, but Float32 is better when preserving exact numeric precision is more important than file size.

## Processing order

For each selected product, year, variable, and statistic, the app follows this order:

1. Build the target date range from January 1 to January 1 of the next year.
2. Expand the loading window for any active options:
   - Gap fill: extend by `floor(window/2) × product cadence days` on each side.
   - Moving-window smoother: extend by `floor(window/2) × product cadence days` on each side.
   - Any active smoother with buffer months enabled: extend by N calendar months on each side.
3. Load the image collection filtered by the expanded date range and AOI.
4. Apply QA/cloud masking:
   - MODIS/MCD and VIIRS: only when **Apply QA / Cloud Mask** is checked.
   - Landsat (harmonized and individual missions): fmask is always applied.
   - HLS S30: Fmask is always applied.
   - Sentinel-2: SCL masking is always applied.
   - Sentinel-3 OLCI: invalid-pixel and saturation masking are always applied.
   - Sentinel-1 SAR: no masking applied (SAR is cloud-penetrating).
   - PALSAR-2 ScanSAR L2.2: `MSK == 1` valid-pixel filter always applied (masks layover, shadow, ocean, invalid). The QA checkbox does not apply.
5. Convert the selected variable into a single-band image collection:
   - `compute` path: map a custom function, then select the requested band.
   - direct band path: select a catalog band and multiply by its scale factor.
   - Landsat harmonized path: use the dedicated multi-mission Landsat branch.
   - Landsat single-mission path: use the dedicated single-mission Landsat branch (no cross-sensor harmonization).
   - HLS S30 path: apply Fmask, rename bands to common schema, reuse LT8 index/TCT functions.
   - Sentinel-2 path: use the dedicated S2 branch.
   - Sentinel-3 path: apply per-band scale factors, apply QA mask, compute index.
   - Sentinel-1 path: use the dedicated SAR branch (dB-to-linear conversion as needed).
   - PALSAR-2 path: use the dedicated PALSAR-2 branch (`MSK == 1` filter and DN-to-γ⁰ conversion as needed).
6. Sort by `system:time_start`.
7. Apply temporal gap filling if requested (Sentinel-1 and PALSAR-2 always bypass this step).
8. Apply the active smoother if requested (Whittaker, Moving-Window, or Harmonic). Sentinel-1 and PALSAR-2 always bypass all smoothers.
9. Filter back to the target window — either the full calendar year, or the specific-months interval when the **Filter by specific months** checkbox is active (a within-year range, or a wrap interval that spans from `Start month {year}` into `End month {year+1}`). This step also strips any gap-fill / smoother edge buffer.
10. Compute the annual statistic. Phenology statistics (`DOY_Max`, `DOY_Min`, `Springness`, `Winterness`, `GSL`) are rejected up front when the specific-months filter is active.
11. Create a Drive export task.
12. Add the first result to the map as a preview layer.

## Extending the app with your own variables

Most custom work happens in the `PRODUCTS` registry. The variable checkboxes are generated automatically from `PRODUCTS[productKey].variables`, so adding a variable there makes it appear in the UI.

### Add a direct catalog band variable

Use this pattern when the product already has the band you need and it only needs scaling:

```javascript
'MyVariable': {
  band: 'Catalog_Band_Name',
  scale: 0.001
}
```

If a variable needs a different QA mask from the product default, add `qaMask`:

```javascript
'MyVariable': {
  band: 'Catalog_Band_Name',
  scale: 0.001,
  qaMask: myVariableQAMask
}
```

### Add a computed MODIS variable

Use this pattern when the variable is calculated from one or more image bands:

```javascript
function MOD09A1_NDMI(img) {
  return img.normalizedDifference(['sur_refl_b02', 'sur_refl_b06'])
    .toFloat()
    .rename('ndmi')
    .set('system:time_start', img.get('system:time_start'));
}
```

Then add it to the relevant product entry:

```javascript
'NDMI': {
  compute: MOD09A1_NDMI,
  band: 'ndmi'
}
```

If one compute function returns several bands, add one registry entry per exposed output band:

```javascript
'MyIndexA': {compute: computeManyIndices, band: 'index_a'},
'MyIndexB': {compute: computeManyIndices, band: 'index_b'}
```

Always preserve `system:time_start`. Phenology, sorting, and temporal gap filling all depend on image dates.

For MODIS surface reflectance products, compute functions are responsible for applying any needed scale factors. Pure ratios such as NDVI cancel the scale factor, but formulas with additive constants, such as EVI or SAVI-like indices, should generally use reflectance units.

### Add a Landsat reflectance index

For a new Landsat reflectance index, write a function that uses the harmonized common band names:

```javascript
function LT_NDMI(img) {
  return img.normalizedDifference(['NIR', 'SWIR1'])
    .rename('NDMI')
    .set('system:time_start', img.get('system:time_start'));
}
```

Register it in `LT_INDEX_FNS`:

```javascript
var LT_INDEX_FNS = {
  'NDVI': LT_NDVI,
  'EVI':  LT_EVI,
  'SAVI': LT_SAVI,
  'NBR':  LT_NBR,
  'NDWI': LT_NDWI,
  'NDMI': LT_NDMI
};
```

Then expose it under the Landsat product:

```javascript
'NDMI': {band: 'NDMI'}
```

Because the HLS S30 pipeline also reuses `LT_INDEX_FNS` after renaming to the common band schema, adding a new function there automatically makes it available to HLS S30 as well.

The Landsat branch will apply scale factors, rename bands, fmask clouds and shadows, harmonize LT5/LT7 to OLI-like reflectance (harmonized product only), and then run the index function.

### Add a Landsat Tasseled Cap-like variable

Tasseled Cap variables use mission-specific functions because coefficients differ by sensor. Add one function for LT5, LT7, and LT8, register them in `LT_TCT_FNS`, and expose the new variable in the Landsat product.

Use this route only for variables that genuinely need mission-specific coefficients before harmonization. For ordinary reflectance indices, use `LT_INDEX_FNS` instead.

## Adding a new product

For a MODIS-like or VIIRS-like single-collection product, add a new entry to `PRODUCTS`:

```javascript
'Product Label (resolution, cadence)': {
  geeId: 'PROVIDER/COLLECTION_ID',
  resolution: 500,
  temporal: '8-day',
  qaMask: myProductQAMask,  // or null
  variables: {
    'VariableA': {band: 'BandA', scale: 0.001},
    'VariableB': {compute: computeVariableB, band: 'variable_b'}
  }
}
```

The generic MODIS-style branch in `loadAndProcessCollection()` handles:

- `ee.ImageCollection(product.geeId)`
- Date filtering
- AOI filtering
- Optional product-level QA
- Optional variable-level QA
- Computed variables
- Direct scaled bands
- Optional temporal gap filling

For a product that needs multi-collection merging, mission-specific handling, joins, or custom filtering, add a dedicated branch in `loadAndProcessCollection()` similar to the Landsat branch.

## Adding a new annual statistic

To add a statistic:

1. Add its label to `STAT_CATEGORIES`.
2. Add a `case` in `computeStatistic(yearCol, statName, doyMaxImage)`.
3. If compact integer export should use a special type or factor, update `getCompactExportEncoding()`.
4. Run a small AOI/year test before large exports.

Example:

```javascript
// In STAT_CATEGORIES
'Centrality & Extremes': ['Mean', 'Median', 'P05', 'P95', 'Min', 'Max', 'P50']

// In computeStatistic()
case 'P50':
  return yearCol.reduce(ee.Reducer.percentile([50]));
```

## Practical guidance

- Prefer MODIS/MCD products for long, regular, coarse-resolution time series going back to 2000.
- Prefer VIIRS products as the MODIS continuity record from 2012 onward, or when inter-comparing with current products that span the MODIS-to-VIIRS transition.
- Prefer Landsat when 30 m spatial detail is more important than temporal regularity.
- Use HLS S30 when you want the spatial resolution of Landsat but prefer a near-daily Sentinel-2 time series cross-calibrated to the Landsat 8 radiometric scale.
- Use individual Landsat mission products (LT4 through LT9) when you need a single-sensor analysis free of cross-mission mixing.
- Prefer Sentinel-2 SR when spatial resolution (10–20 m) is the primary requirement and 2017+ temporal coverage is sufficient.
- Prefer Sentinel-3 OLCI for near-daily canopy chlorophyll estimation (OTCI) over large regions where the coarser 300 m resolution is acceptable.
- Keep the QA mask enabled for production MODIS and VIIRS runs.
- Use gap filling cautiously for phenology metrics. It can stabilize sparse time series, but it can also smooth real short events.
- For `DOY_Max` and `DOY_Min`, inspect whether the selected variable has a meaningful seasonal maximum/minimum.
- For current or partial years, annual statistics reflect only the observations available in the catalog and date range.
- For compact integer exports, always record and apply the filename scale factor during downstream analysis.
- Start with one year, one variable, and one statistic to verify settings before creating many export tasks.

## Code map

| Section in `EFA_Calculator_App.js` | Purpose |
| --- | --- |
| Section 1 | MODIS and VIIRS QA mask functions plus DOY and circular transform helpers. |
| Section 1B | Landsat scale factors, band renaming, fmask, harmonization (Roy et al. 2016), Landsat reflectance indices and Tasseled Cap functions, lookup tables `LT_INDEX_FNS` and `LT_TCT_FNS`, per-mission config `LANDSAT_SINGLE_CONFIG`, and HLS S30 renaming and Fmask functions. |
| Section 1C | Sentinel-2 scale factors, band renaming, SCL masking, spectral indices, and Tasseled Cap helpers (Shi & Xu 2019). |
| Section 1D | Sentinel-1 SAR dB-to-linear helper, index functions (`S1_VV`, `S1_VH`, `S1_CR`, `S1_IR`, `S1_DpRVI`, `S1_DpRVIc`, `S1_RFDI`), and `S1_INDEX_FNS` lookup table. |
| Section 1E | Sentinel-3 OLCI pipeline: per-band scale factors (`applyS3ScaleFactors`), QA masking (`maskQA_S3`), and index functions (`S3_NDVI`, `S3_OTCI`, `S3_NDWI`). |
| Section 1F | PALSAR-2 ScanSAR L2.2 pipeline: DN-to-γ⁰ helpers (`P2_dn2dB`, `P2_dn2lin`), `MSK == 1` valid-pixel filter (`P2_validMask`), index functions (`P2_HH`, `P2_HV`, `P2_HH_minus_HV`, `P2_RFDI`, `P2_DpRVIc`, `P2_RVI_dp`), and `P2_INDEX_FNS` lookup table. |
| Section 2 | MODIS spectral indices and Tasseled Cap functions, and VIIRS spectral index functions (`VNP13A1_SpectralIndices`, `VNP09GA_SpectralIndices`, `VNP09H1_SpectralIndices`, `VNP43IA4_SpectralIndices`). |
| Section 3 | MCD43A1 BRDF/albedo functions. |
| Section 4 | `PRODUCTS` registry and `MISSION_GROUPS` and `PRODUCT_YEAR_RANGES` lookup tables. These control product and variable options shown in the UI. |
| Section 5 | Annual statistics engine and `STAT_CATEGORIES`. |
| Section 6 | Collection loading pipeline (all sensor branches), temporal gap filling, export encoding, Drive export, and preview visualization settings. |
| Section 7 | UI widgets and default parameter values. |
| Section 8 | Main panel assembly. |
| Section 9 | Event handlers, validation, export task creation loop, and AOI handling. |
| Section 10 | Initial map center and basemap. |

## References mentioned in the app

- Alcaraz-Segura et al. (2006) - Ecosystem Functional Attributes framework and applications.
- Paruelo et al. (2001) - Ecosystem functional types.
- Schaaf et al. (2002) - BRDF/albedo model basis.
- Lobser and Cohen (2007) - MODIS Tasseled Cap coefficients.
- Roy et al. (2016) - Landsat ETM+/TM to OLI harmonization coefficients.
- Crist (1985), Huang et al. (2002), and Baig et al. (2014) - Landsat Tasseled Cap coefficients used for LT5/LT4, LT7, and LT8/LT9/HLS respectively.
- Shi & Xu (2019) - Sentinel-2 Tasseled Cap coefficients (6-band PCP-derived, aligned to Landsat 8 OLI TCT space). IEEE Journal of Selected Topics in Applied Earth Observations and Remote Sensing, 12(10), 4038–4048. doi:10.1109/JSTARS.2019.2938388
- Liang (2001) - Narrowband-to-broadband conversion for shortwave albedo. Remote Sensing of Environment, 76(2), 213–238. doi:10.1016/S0034-4257(00)00205-4
- Jiang et al. (2008) - Development of a two-band enhanced vegetation index (EVI2) without a blue band. Remote Sensing of Environment, 112(10), 3833–3845. doi:10.1016/j.rse.2008.06.006
- Dash & Curran (2004) - The MERIS terrestrial chlorophyll index. International Journal of Remote Sensing, 25(23), 5403–5413. doi:10.1080/0143116042000274015
- Mandal, D., Kumar, V., Ratha, D., Dey, S., Bhattacharya, A., Lopez-Sanchez, J.M., McNairn, H. & Rao, Y.S. (2020) - Dual polarimetric radar vegetation index for crop growth monitoring using Sentinel-1 SAR data. Remote Sensing of Environment, 247, 111954. doi:10.1016/j.rse.2020.111954
- Mitchard, E.T.A., Saatchi, S.S., White, L.J.T., Abernethy, K.A., Jeffery, K.J., Lewis, S.L., Collins, M., Lefsky, M.A., Leal, M.E., Woodhouse, I.H. & Meir, P. (2012) - Mapping tropical forest biomass with radar and spaceborne LiDAR in Lopé National Park, Gabon: overcoming problems of high biomass and persistent cloud. Biogeosciences, 9(1), 179–191. doi:10.5194/bg-9-179-2012
- Kim, Y. & van Zyl, J.J. (2009) - A time-series approach to estimate soil moisture using polarimetric radar data. IEEE Transactions on Geoscience and Remote Sensing, 47(8), 2519–2527. doi:10.1109/TGRS.2009.2014944 — Dual-pol RVI approximation (`RVI_dp`) used for PALSAR-2.
- JAXA Earth Observation Research Center — ALOS-2 PALSAR-2 Level 2.2 (NRB/CEOS-ARD) product specification, including the amplitude-DN to γ⁰ conversion `γ⁰_dB = 10·log₁₀(DN²) − 83` and the `MSK` bitmask definition. https://www.eorc.jaxa.jp/ALOS/en/alos-2/a2_l22_j.htm
