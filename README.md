# EFA Calculator App

`EFA_Calculator_App.js` is a Google Earth Engine Code Editor application for calculating annual Ecosystem Functional Attributes (EFAs) from satellite image time series. It creates one export task per selected year, variable, and annual statistic, and writes the result as a single-band GeoTIFF to Google Drive.

The app is designed for two main use cases:

- Run ready-made EFA calculations from supported MODIS/MCD, Landsat, Sentinel-2, and Sentinel-1 SAR products.
- Extend the script with your own variables, indices, statistics, or products by editing the central registries in the app.

There is no build system. Paste or open `EFA_Calculator_App.js` in the Earth Engine Code Editor, click **Run**, configure the side panel, then start the generated export tasks from the Earth Engine **Tasks** tab.

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
4. Select a satellite product. MODIS/MCD products are listed first; the harmonized Landsat product is listed after them.
5. Select one or more years.
6. Select one or more variables.
7. Select one or more annual statistics.
8. Set export options: CRS, scale (i.e., spatial resolution), Google Drive folder, maximum number of pixels, and raster bit depth/encoding.
9. Leave the QA/cloud mask enabled unless you have a specific reason to inspect unmasked MODIS values.
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
| Satellite Product | None | Product registry entry to use. Selecting a product rebuilds the variable list and updates the default scale. |
| Year(s) | None | Years from 1984 through 2026 are available in the UI. Data availability still depends on each satellite product. |
| Select MODIS range | 2000-2026 | Convenience button that checks the MODIS-era years in the current UI. |
| Select Sentinel-1 range | 2015-2026 | Convenience button that checks years 2015 onward. Sentinel-1A data starts 2014-10-03; selecting from 2015 ensures complete calendar-year coverage. |
| Variables / Dimensions | None | Single-band variables calculated from the selected product. |
| Annual Statistics | None | Annual aggregation functions applied to each variable-year collection. |
| CRS | `EPSG:4326` | Export projection. Change if you need a projected CRS for distance/area consistency. |
| Scale (m) | Product resolution | Export pixel size in meters. It is auto-filled from the product but can be overridden. |
| Drive folder | `GEE_EFA` | Google Drive folder used by `Export.image.toDrive`. |
| Max pixels | `1e9` | Earth Engine export `maxPixels`. Increase only when necessary. |
| Encoding | `Float32 (original)` | Output numeric encoding: original float values or compact integer values. |
| Apply QA / Cloud Mask | On | Applies MODIS product QA masks. Landsat fmask is always applied in the Landsat branch. |
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

The app currently exposes 13 product choices: 9 MODIS/MCD products, 1 harmonized Landsat product, 1 Sentinel-2 SR product, and 1 Sentinel-1 SAR product (experimental). MODIS/MCD products use the regular single-collection pipeline. Landsat, Sentinel-2, and Sentinel-1 each use dedicated pipelines.

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

### Landsat product

| Product in UI | Earth Engine collections | Resolution | Cadence used by app | Exposed variables |
| --- | --- | --- | --- | --- |
| `Landsat Harmonized (30m, LT5/7/8)` | `LANDSAT/LT05/C02/T1_L2`, `LANDSAT/LE07/C02/T1_L2`, `LANDSAT/LC08/C02/T1_L2` | 30 m | Scene based; `16-day` is used as the nominal gap-fill cadence | `NDVI`, `EVI`, `SAVI`, `NBR`, `NDWI`, `TCT_Brightness`, `TCT_Greenness`, `TCT_Wetness`, `LST` |

The Landsat branch supports:

| Mission | Sensor | Approximate period represented in UI text | Notes |
| --- | --- | --- | --- |
| Landsat 5 | TM | 1984-2013 | Collection 2, Tier 1, Level 2. |
| Landsat 7 | ETM+ | 1999 onward in the catalog | Collection 2, Tier 1, Level 2. SLC-off gaps after 2003 may remain unless nearby scenes can fill them. |
| Landsat 8 | OLI/TIRS | 2013 onward in the catalog | Collection 2, Tier 1, Level 2. |

#### Landsat processing

The Landsat product is not a single catalog collection. The app builds it each time a Landsat variable is requested:

1. Load LT5, LT7, and LT8 Collection 2 Tier 1 Level 2 scenes for the AOI and date range.
2. Apply official Collection 2 scale factors:
   - Optical SR bands: `SR_B* * 0.0000275 - 0.2`
   - Surface temperature bands: `ST_B* * 0.00341802 + 149.0`
3. Rename bands to a common schema:
   - LT8: `SR_B2,B3,B4,B5,B6,B7` -> `Blue,Green,Red,NIR,SWIR1,SWIR2`
   - LT5/LT7: `SR_B1,B2,B3,B4,B5,B7` -> `Blue,Green,Red,NIR,SWIR1,SWIR2`
   - LT8 thermal: `ST_B10` -> `LST_K`
   - LT5/LT7 thermal: `ST_B6` -> `LST_K`
4. Apply Landsat fmask using `QA_PIXEL` cloud shadow bit 3 and cloud bit 5.
5. Route the variable:
   - Reflectance indices (`NDVI`, `EVI`, `SAVI`, `NBR`, `NDWI`): LT5/LT7 are harmonized to OLI-like reflectance using Roy et al. (2016) coefficients before the index is calculated. LT8 is already OLI.
   - Tasseled Cap (`TCT_Brightness`, `TCT_Greenness`, `TCT_Wetness`): mission-specific coefficients are applied before cross-sensor harmonization. LT5 uses Crist (1985), LT7 uses Huang et al. (2002), and LT8 uses Baig et al. (2014).
   - `LST`: `LST_K` is converted to Celsius by subtracting `273.15`.
6. Merge the mission collections and sort by `system:time_start`.

For Landsat, the **Apply QA / Cloud Mask** checkbox does not disable fmask. Cloud and cloud-shadow masking is always applied inside the Landsat pipeline.

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

The **Apply QA / Cloud Mask** option is enabled by default. It controls MODIS/MCD QA masks. When unchecked, the app skips the product-level and variable-level MODIS QA masks defined in the registry.

| Product | QA behavior when MODIS QA masking is enabled |
| --- | --- |
| `MOD09Q1` | Uses `State` bits for clear cloud state, no cloud shadow, no cirrus, and no internal cloud. |
| `MOD09A1` | Uses `StateQA` bits for clear cloud state, no cloud shadow, no cirrus, and no internal cloud. |
| `MOD13Q1` | Keeps `SummaryQA <= 1`, meaning good and marginal observations; excludes snow/ice and cloudy classes. |
| `MOD11A1`, `MOD11A2` | Uses `QC_Day` for `LST_Day` and `QC_Night` for `LST_Night`; keeps MODLAND QA values `0` and `1`. |
| `MOD17A2H` | Uses `Psn_QC`; keeps good MODLAND QA, no cloud, and no significant cloud/ice contamination. |
| `MCD43A1` | Keeps mandatory BRDF/albedo quality for bands 1 and 2 less than or equal to `1`. |
| `MOD16A2` | Uses `ET_QC`; keeps MODLAND QA values `0` and `1` and requires no cloud. |
| `MCD15A3H` | Uses `FparLai_QC` plus `FparExtra_QC`; removes cloud, cloud shadow, and significant cloud/ice contamination. |
| Landsat Harmonized | Always uses fmask from `QA_PIXEL`: cloud shadow bit 3 must be `0`, and cloud bit 5 must be `0`. The MODIS QA checkbox does not disable this. |
| Sentinel-2 SR | Always uses SCL: cloud shadow (SCL = 3), medium cloud (SCL = 8), high cloud (SCL = 9), and thin cirrus (SCL = 10) are masked. The MODIS QA checkbox does not disable this. |
| Sentinel-1 SAR | Not applicable. SAR is cloud-penetrating. The QA mask checkbox is automatically disabled when this product is selected. |

Masking improves scientific quality but reduces the number of valid observations. This matters for `CumSum`, `GSL`, and phenology metrics because those statistics depend strongly on how many valid dates remain.

## Temporal gap filling

Temporal gap filling is optional and disabled by default. It is applied after masking and variable calculation, but before the final annual statistic. Gap filling is **not available for Sentinel-1 SAR**; the control is disabled in the UI and the pipeline bypasses it internally.

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

Three experimental smoothers can be applied to the annual time series after masking and variable calculation but before annual statistics are computed. Only one smoother can be active at a time. Smoothing is **not available for Sentinel-1 SAR**; the controls are automatically disabled when that product is selected.

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

`ProductShort` is the first word in the product label. Examples:

```text
MOD09A1_NDVI_Mean_2020
MOD11A2_LST_Day_Max_2018
MCD43A1_Avg_Albedo_Median_2021
Landsat_NBR_DOY_Max_2003
```

Optional suffixes are appended in this order: gap fill, Whittaker, Moving-Window, Harmonic, compact encoding.

| Active option | Suffix pattern | Example |
| --- | --- | --- |
| Gap fill | `_GF{Method}W{Window}` | `_GFMedianW5` |
| Whittaker smoother | `_WS{lambda}` | `_WS10` |
| Moving-window smoother | `_MW{m\|M}{window}` | `_MWm5` (Median), `_MWM7` (Mean) |
| Harmonic smoother | `_HS{N}` | `_HS2` |
| Buffer months (any smoother) | `_B{months}` appended to the smoother suffix | `_WS10_B3`, `_HS2_B6` |
| Compact integer encoding | `_{i16\|i32}x{factor}` | `_i16x10000` |

Full examples:

```text
MOD13Q1_NDVI_Mean_2020_GFMedianW5_i16x10000
MOD09A1_NDVI_Mean_2020_WS10_B3
MOD09A1_NDVI_Mean_2020_HS2_B6
Sentinel2_NDVI_Mean_2021_MWm5_B3_i16x10000
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
| `LST`, `ET`, `LAI`, TCT variables, albedo variables | `Int32` | `10000` | `_i32x10000` | Divide by `10000`. |
| Formula-derived `EVI` except `MOD13Q1` catalog EVI | `Int32` | `10000` | `_i32x10000` | Divide by `10000`. |
| SAR dB variables: `VV`, `VH`, `VV_minus_VH` | `Int16` | `100` | `_i16x100` | Divide by `100` to recover dB. |
| SAR `IR` (can exceed 100 over bare surfaces) | `Int32` | `10000` | `_i32x10000` | Divide by `10000`. |
| SAR `CR`, `DpRVI`, `DpRVIc`, `RFDI` (0–1 range) | `Int16` | `10000` | `_i16x10000` | Divide by `10000`. |
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
   - MODIS/MCD: only when **Apply QA / Cloud Mask** is checked.
   - Landsat: fmask is always applied.
   - Sentinel-2: SCL masking is always applied.
   - Sentinel-1 SAR: no masking applied (SAR is cloud-penetrating).
5. Convert the selected variable into a single-band image collection:
   - `compute` path: map a custom function, then select the requested band.
   - direct band path: select a catalog band and multiply by its scale factor.
   - Landsat path: use the dedicated Landsat branch.
   - Sentinel-2 path: use the dedicated S2 branch.
   - Sentinel-1 path: use the dedicated SAR branch (dB-to-linear conversion as needed).
6. Sort by `system:time_start`.
7. Apply temporal gap filling if requested (Sentinel-1 SAR always bypasses this step).
8. Apply the active smoother if requested (Whittaker, Moving-Window, or Harmonic). Sentinel-1 SAR always bypasses all smoothers.
9. Filter back to the target calendar year (strips the edge buffer and any gap-fill/smoother buffer).
10. Compute the annual statistic.
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

The Landsat branch will apply scale factors, rename bands, fmask clouds and shadows, harmonize LT5/LT7 to OLI-like reflectance, and then run the index function.

### Add a Landsat Tasseled Cap-like variable

Tasseled Cap variables use mission-specific functions because coefficients differ by sensor. Add one function for LT5, LT7, and LT8, register them in `LT_TCT_FNS`, and expose the new variable in the Landsat product.

Use this route only for variables that genuinely need mission-specific coefficients before harmonization. For ordinary reflectance indices, use `LT_INDEX_FNS` instead.

## Adding a new product

For a MODIS-like single-collection product, add a new entry to `PRODUCTS`:

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

- Prefer MODIS/MCD products for long, regular, coarse-resolution time series.
- Prefer Landsat when 30 m spatial detail is more important than temporal regularity.
- Keep the QA mask enabled for production MODIS runs.
- Use gap filling cautiously for phenology metrics. It can stabilize sparse time series, but it can also smooth real short events.
- For `DOY_Max` and `DOY_Min`, inspect whether the selected variable has a meaningful seasonal maximum/minimum.
- For current or partial years, annual statistics reflect only the observations available in the catalog and date range.
- For compact integer exports, always record and apply the filename scale factor during downstream analysis.
- Start with one year, one variable, and one statistic to verify settings before creating many export tasks.

## Code map

| Section in `EFA_Calculator_App.js` | Purpose |
| --- | --- |
| Section 1 | MODIS QA masks plus DOY and circular transform helpers. |
| Section 1B | Landsat scale factors, band renaming, fmask, harmonization, Landsat indices, Tasseled Cap, and LST helpers. |
| Section 1C | Sentinel-2 scale factors, band renaming, SCL masking, spectral indices, and Tasseled Cap helpers (Shi & Xu 2019). |
| Section 1D | Sentinel-1 SAR dB-to-linear helper, index functions (`S1_VV`, `S1_VH`, `S1_CR`, `S1_IR`, `S1_DpRVI`, `S1_DpRVIc`, `S1_RFDI`), and `S1_INDEX_FNS` lookup table. |
| Section 2 | MODIS spectral indices, Tasseled Cap, burn index helper, and MOD09Q1 NDVI. |
| Section 3 | MCD43A1 BRDF/albedo functions. |
| Section 4 | `PRODUCTS` registry. This controls product and variable options shown in the UI. |
| Section 5 | Annual statistics engine and `STAT_CATEGORIES`. |
| Section 6 | Collection loading, temporal gap filling, export encoding, Drive export, and preview visualization settings. |
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
- Crist (1985), Huang et al. (2002), and Baig et al. (2014) - Landsat Tasseled Cap coefficients used for LT5, LT7, and LT8 respectively.
- Shi & Xu (2019) - Sentinel-2 Tasseled Cap coefficients (6-band PCP-derived, aligned to Landsat 8 OLI TCT space). IEEE Journal of Selected Topics in Applied Earth Observations and Remote Sensing, 12(10), 4038–4048. doi:10.1109/JSTARS.2019.2938388
- Mandal, D., Kumar, V., Ratha, D., Dey, S., Bhattacharya, A., Lopez-Sanchez, J.M., McNairn, H. & Rao, Y.S. (2020) - Dual polarimetric radar vegetation index for crop growth monitoring using Sentinel-1 SAR data. Remote Sensing of Environment, 247, 111954. doi:10.1016/j.rse.2020.111954
- Mitchard, E.T.A., Saatchi, S.S., White, L.J.T., Abernethy, K.A., Jeffery, K.J., Lewis, S.L., Collins, M., Lefsky, M.A., Leal, M.E., Woodhouse, I.H. & Meir, P. (2012) - Mapping tropical forest biomass with radar and spaceborne LiDAR in Lopé National Park, Gabon: overcoming problems of high biomass and persistent cloud. Biogeosciences, 9(1), 179–191. doi:10.5194/bg-9-179-2012
