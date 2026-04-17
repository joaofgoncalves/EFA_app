/*
 * ============================================================================
 * EFA Calculator - MODIS, Landsat, Sentinel-2 & Sentinel-1 SAR Annual Statistics
 * ============================================================================
 *
 * Computes Ecosystem Functional Attributes (EFAs) from MODIS, Landsat,
 * Sentinel-2, and Sentinel-1 SAR time series. EFAs characterize ecosystem
 * functioning through:
 *   - Magnitude: annual mean/median (productivity proxy)
 *   - Seasonality: CV, StdDev, IQR (variation intensity)
 *   - Phenology: DOY of peak activity with circular transforms
 *
 * Supports 10 MODIS products, 1 Landsat harmonized product, 1 Sentinel-2
 * product, 1 Sentinel-1 SAR product (experimental), 28+ spectral/biophysical/
 * SAR variables, and 17 annual statistics across 4 categories.
 *
 * Optional time-series smoothing before annual aggregation:
 *   - Temporal gap fill: fills masked pixels from a centered image window
 *   - Whittaker smoother: penalized least-squares (3rd-order differences)
 *   - Moving-window smoother: per-image median or mean in a sliding window
 *   - Harmonic smoother: Fourier OLS fit (1–3 annual harmonics)
 * All smoothers support an edge-buffer option that loads extra months before
 * and after the target year to reduce boundary effects, then strips the
 * buffer before computing annual statistics.
 *
 * References:
 *   Alcaraz-Segura et al. (2006) - EFA framework
 *   Paruelo et al. (2001) - Ecosystem functional types
 *   Schaaf et al. (2002) - BRDF/Albedo model
 *   Lobser & Cohen (2007) - MODIS Tasseled Cap coefficients
 *   Roy et al. (2016) - Landsat ETM+/TM to OLI harmonization
 *   Crist (1985), Huang et al. (2002), Baig et al. (2014) - Landsat TCT coefficients
 *   Shi & Xu (2019) - Sentinel-2 TCT coefficients (IEEE JSTARS 12:4038-4048)
 *   Mandal et al. (2020) - DpRVI for Sentinel-1 SAR (Remote Sens. Environ. 247:111954)
 *   Mitchard et al. (2012) - RFDI forest degradation index (Biogeosciences 9:179-191)
 *
 * Version: v1.0 (2026-04-17)
 * ============================================================================
 */


// ============================================================================
// SECTION 1: QA & HELPER FUNCTIONS
// ============================================================================

// Bit extraction utility for QA bands
function getQABits(image, start, end, newName) {
  var pattern = 0;
  for (var i = start; i <= end; i++) {
    pattern += Math.pow(2, i);
  }
  return image.select([0], [newName])
    .bitwiseAnd(pattern)
    .rightShift(start);
}

// --------------------------------------------------------------------------
// Science-grade QA mask functions (one per product or per band where needed)
// --------------------------------------------------------------------------

// MOD09A1: StateQA bitmask - cloud state (bits 0-1), shadow (2), cirrus (8-9), internal cloud (10)
// Refs: LP DAAC MOD09A1 C6.1 User Guide Table 2
function maskQA_MOD09A1(image) {
  var qa = image.select('StateQA');
  var cloudState  = getQABits(qa,  0,  1, 'cloud_state');   // 00 = clear
  var cloudShadow = getQABits(qa,  2,  2, 'cloud_shadow');  // 0  = no shadow
  var cirrus      = getQABits(qa,  8,  9, 'cirrus');        // 00 = none
  var intCloud    = getQABits(qa, 10, 10, 'int_cloud');     // 0  = clear
  return image.updateMask(
    cloudState.eq(0).and(cloudShadow.eq(0)).and(cirrus.eq(0)).and(intCloud.eq(0))
  );
}

// MOD09Q1: State bitmask - same bit layout as MOD09A1 StateQA
function maskQA_MOD09Q1(image) {
  var qa = image.select('State');
  var cloudState  = getQABits(qa,  0,  1, 'cloud_state');
  var cloudShadow = getQABits(qa,  2,  2, 'cloud_shadow');
  var cirrus      = getQABits(qa,  8,  9, 'cirrus');
  var intCloud    = getQABits(qa, 10, 10, 'int_cloud');
  return image.updateMask(
    cloudState.eq(0).and(cloudShadow.eq(0)).and(cirrus.eq(0)).and(intCloud.eq(0))
  );
}

// MOD13Q1: SummaryQA - keep good (0) and marginal (1); exclude snow/ice (2) and cloud (3)
function maskQA_MOD13Q1(image) {
  var qa = image.select('SummaryQA');
  return image.updateMask(qa.lte(1));
}

// MOD11A1 / MOD11A2 Day LST: QC_Day bits 0-1 (MODLAND QA): 00=good, 01=other quality
// Keep both good and other-quality (lte 1); bit values 10/11 mean LST not produced.
function maskQA_MOD11_Day(image) {
  var qc = image.select('QC_Day');
  var qa = getQABits(qc, 0, 1, 'qa');
  return image.updateMask(qa.lte(1));
}

// MOD11A1 / MOD11A2 Night LST: same logic using QC_Night band
function maskQA_MOD11_Night(image) {
  var qc = image.select('QC_Night');
  var qa = getQABits(qc, 0, 1, 'qa');
  return image.updateMask(qa.lte(1));
}

// MOD17A2H GPP/PsnNet: Psn_QC bit 0 (MODLAND QA: 0=good), bit 3 (cloud: 0=none),
// bit 4 (significant cloud/ice contamination: 0=none)
function maskQA_MOD17A2H(image) {
  var qc       = image.select('Psn_QC');
  var qa       = getQABits(qc, 0, 0, 'qa');
  var cloud    = getQABits(qc, 3, 3, 'cloud');
  var cloudIce = getQABits(qc, 4, 4, 'cloud_ice');
  return image.updateMask(qa.eq(0).and(cloud.eq(0)).and(cloudIce.eq(0)));
}

// MCD43A1 BRDF/Albedo: Mandatory quality for Band1 (Red) and Band2 (NIR) <= 1
// 0=full BRDF inversion (best), 1=magnitude inversion (acceptable), 255=fill
function maskQA_MCD43A1(image) {
  var qa1 = image.select('BRDF_Albedo_Band_Mandatory_Quality_Band1');
  var qa2 = image.select('BRDF_Albedo_Band_Mandatory_Quality_Band2');
  return image.updateMask(qa1.lte(1).and(qa2.lte(1)));
}

// MOD16A2 ET: ET_QC bits 0-1 (MODLAND QA: 0=good, 1=other quality) and bit 3 (cloud: 0=none)
function maskQA_MOD16A2(image) {
  var qc    = image.select('ET_QC');
  var qa    = getQABits(qc, 0, 1, 'qa');
  var cloud = getQABits(qc, 3, 3, 'cloud');
  return image.updateMask(qa.lte(1).and(cloud.eq(0)));
}

// MCD15A3H LAI/FPAR: FparLai_QC bits 0-1 (MODLAND QA <= 1) and FparExtra_QC cloud flags
// FparExtra_QC: bit 1=cloud detected, bit 2=cloud shadow, bit 3=significant cloud/ice
function maskQA_MCD15A3H(image) {
  var qc   = image.select('FparLai_QC');
  var qa   = getQABits(qc, 0, 1, 'qa');
  var extra       = image.select('FparExtra_QC');
  var cloud       = getQABits(extra, 1, 1, 'cloud');
  var cloudShadow = getQABits(extra, 2, 2, 'cloud_shadow');
  var cloudIce    = getQABits(extra, 3, 3, 'cloud_ice');
  return image.updateMask(
    qa.lte(1).and(cloud.eq(0)).and(cloudShadow.eq(0)).and(cloudIce.eq(0))
  );
}

// Add DOY band to each image in a collection
function addDOYband(imgCol) {
  return imgCol.map(function(img) {
    var doy = img.date().getRelative('day', 'year');
    return img.addBands(ee.Image.constant(doy).uint16().rename('doy'));
  });
}

// Circular statistics: linearize DOY via sin/cos transforms
function sprg(doyImage) {
  return doyImage.toFloat().multiply(2).multiply(Math.PI).divide(365).sin();
}

function wint(doyImage) {
  return doyImage.toFloat().multiply(2).multiply(Math.PI).divide(365).cos();
}


// ============================================================================
// SECTION 1B: LANDSAT HARMONIZED PIPELINE
// ============================================================================
// Supports: Landsat 5 (TM), 7 (ETM+), 8 (OLI) — Collection 2, Tier 1, Level 2
// All bands renamed to Blue/Green/Red/NIR/SWIR1/SWIR2/LST_K before any computation.
// ETM+/TM optical bands are cross-calibrated to OLI equivalents via Roy et al. (2016)
// coefficients before reflectance indices are computed.
// TCT uses mission-specific coefficients and is applied BEFORE harmonization.
// ============================================================================

// ---- Scaling factors (C02 L2) ----
function applyLandsatScaleFactors(image) {
  var opt = image.select('SR_B.').multiply(0.0000275).add(-0.2);
  var thm = image.select('ST_B.*').multiply(0.00341802).add(149.0);
  return image.addBands(opt, null, true).addBands(thm, null, true);
}

// ---- Band renaming ----
function renameLT8(img) {
  return img.select(
    ['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7','ST_B10','QA_PIXEL'],
    ['Blue', 'Green','Red', 'NIR', 'SWIR1','SWIR2','LST_K', 'pixel_qa']);
}
function renameLT57(img) {
  return img.select(
    ['SR_B1','SR_B2','SR_B3','SR_B4','SR_B5','SR_B7','ST_B6','QA_PIXEL'],
    ['Blue', 'Green','Red', 'NIR', 'SWIR1','SWIR2','LST_K','pixel_qa']);
}

// ---- Cloud / shadow mask using QA_PIXEL (C02) ----
function fmaskLandsat(img) {
  var qa = img.select('pixel_qa');
  return img.updateMask(
    qa.bitwiseAnd(1 << 3).eq(0).and(qa.bitwiseAnd(1 << 5).eq(0))
  );
}

// ---- ETM+ / TM → OLI spectral harmonization (Roy et al. 2016) ----
var LT_HARM_SLOPES = ee.Image.constant([0.8474, 0.8483, 0.9047, 0.8462, 0.8937, 0.9071]);
var LT_HARM_ITCPS  = ee.Image.constant([0.0003, 0.0088, 0.0061, 0.0412, 0.0254, 0.0172]);
function etmToOli(img) {
  var sr = img.select(['Blue','Green','Red','NIR','SWIR1','SWIR2'])
    .multiply(LT_HARM_SLOPES).add(LT_HARM_ITCPS);
  return sr.addBands(img.select(['LST_K','pixel_qa']));
}

// ---- Reflectance-based spectral indices (harmonized bands) ----
function LT_NDVI(img) {
  return img.normalizedDifference(['NIR','Red']).rename('NDVI')
    .set('system:time_start', img.get('system:time_start'));
}
function LT_EVI(img) {
  return img.expression(
    '2.5 * (NIR - RED) / (NIR + 6.0*RED - 7.5*BLUE + 1.0)', {
      NIR: img.select('NIR').toFloat(),
      RED: img.select('Red').toFloat(),
      BLUE: img.select('Blue').toFloat()
    }).rename('EVI').set('system:time_start', img.get('system:time_start'));
}
function LT_SAVI(img) {
  return img.expression(
    '1.5 * (NIR - RED) / (NIR + RED + 0.5)', {
      NIR: img.select('NIR').toFloat(),
      RED: img.select('Red').toFloat()
    }).rename('SAVI').set('system:time_start', img.get('system:time_start'));
}
function LT_NBR(img) {
  return img.normalizedDifference(['NIR','SWIR2']).rename('NBR')
    .set('system:time_start', img.get('system:time_start'));
}
function LT_NDWI(img) {
  return img.normalizedDifference(['NIR','SWIR1']).rename('NDWI')
    .set('system:time_start', img.get('system:time_start'));
}
function LT_LST(img) {
  return img.select('LST_K').subtract(273.15).rename('LST')
    .set('system:time_start', img.get('system:time_start'));
}

// Lookup table for reflectance index functions
var LT_INDEX_FNS = {
  'NDVI': LT_NDVI,
  'EVI':  LT_EVI,
  'SAVI': LT_SAVI,
  'NBR':  LT_NBR,
  'NDWI': LT_NDWI
};

// ---- Tasseled Cap Transforms — mission-specific coefficients ----
// Applied to renamed (unharmonized) bands. Must run BEFORE etmToOli.

// LT5 (Crist 1985)
function LT5_TCT_B(img) {
  return img.expression(
    '(B*0.2043)+(G*0.4158)+(R*0.5524)+(N*0.5741)+(S1*0.3124)+(S2*0.2303)',
    {B:img.select('Blue'),G:img.select('Green'),R:img.select('Red'),
     N:img.select('NIR'),S1:img.select('SWIR1'),S2:img.select('SWIR2')})
    .rename('TCTB').set('system:time_start', img.get('system:time_start'));
}
function LT5_TCT_G(img) {
  return img.expression(
    '(B*-0.1603)+(G*-0.2819)+(R*-0.4934)+(N*0.7940)+(S1*-0.0002)+(S2*-0.1446)',
    {B:img.select('Blue'),G:img.select('Green'),R:img.select('Red'),
     N:img.select('NIR'),S1:img.select('SWIR1'),S2:img.select('SWIR2')})
    .rename('TCTG').set('system:time_start', img.get('system:time_start'));
}
function LT5_TCT_W(img) {
  return img.expression(
    '(B*0.0315)+(G*0.2021)+(R*0.3102)+(N*0.1594)+(S1*-0.6806)+(S2*-0.6109)',
    {B:img.select('Blue'),G:img.select('Green'),R:img.select('Red'),
     N:img.select('NIR'),S1:img.select('SWIR1'),S2:img.select('SWIR2')})
    .rename('TCTW').set('system:time_start', img.get('system:time_start'));
}

// LT7 (Huang et al. 2002)
function LT7_TCT_B(img) {
  return img.expression(
    '(B*0.3561)+(G*0.3972)+(R*0.3904)+(N*0.6966)+(S1*0.2286)+(S2*0.1596)',
    {B:img.select('Blue'),G:img.select('Green'),R:img.select('Red'),
     N:img.select('NIR'),S1:img.select('SWIR1'),S2:img.select('SWIR2')})
    .rename('TCTB').set('system:time_start', img.get('system:time_start'));
}
function LT7_TCT_G(img) {
  return img.expression(
    '(B*-0.3344)+(G*-0.3544)+(R*-0.4556)+(N*0.6966)+(S1*-0.0242)+(S2*-0.2630)',
    {B:img.select('Blue'),G:img.select('Green'),R:img.select('Red'),
     N:img.select('NIR'),S1:img.select('SWIR1'),S2:img.select('SWIR2')})
    .rename('TCTG').set('system:time_start', img.get('system:time_start'));
}
function LT7_TCT_W(img) {
  return img.expression(
    '(B*0.2626)+(G*0.2141)+(R*0.0926)+(N*0.0656)+(S1*-0.7629)+(S2*-0.5388)',
    {B:img.select('Blue'),G:img.select('Green'),R:img.select('Red'),
     N:img.select('NIR'),S1:img.select('SWIR1'),S2:img.select('SWIR2')})
    .rename('TCTW').set('system:time_start', img.get('system:time_start'));
}

// LT8 (Baig et al. 2014)
function LT8_TCT_B(img) {
  return img.expression(
    '(B*0.3029)+(G*0.2786)+(R*0.4733)+(N*0.5599)+(S1*0.508)+(S2*0.1872)',
    {B:img.select('Blue'),G:img.select('Green'),R:img.select('Red'),
     N:img.select('NIR'),S1:img.select('SWIR1'),S2:img.select('SWIR2')})
    .rename('TCTB').set('system:time_start', img.get('system:time_start'));
}
function LT8_TCT_G(img) {
  return img.expression(
    '(B*-0.2941)+(G*-0.2430)+(R*-0.5424)+(N*0.7276)+(S1*0.0713)+(S2*-0.1608)',
    {B:img.select('Blue'),G:img.select('Green'),R:img.select('Red'),
     N:img.select('NIR'),S1:img.select('SWIR1'),S2:img.select('SWIR2')})
    .rename('TCTG').set('system:time_start', img.get('system:time_start'));
}
function LT8_TCT_W(img) {
  return img.expression(
    '(B*0.1511)+(G*0.1973)+(R*0.3283)+(N*0.3407)+(S1*-0.7117)+(S2*-0.4559)',
    {B:img.select('Blue'),G:img.select('Green'),R:img.select('Red'),
     N:img.select('NIR'),S1:img.select('SWIR1'),S2:img.select('SWIR2')})
    .rename('TCTW').set('system:time_start', img.get('system:time_start'));
}

// Lookup table: variable name → per-mission TCT functions.
// lt4 shares Crist (1985) TM coefficients with lt5; lt9 shares Baig (2014) OLI with lt8.
var LT_TCT_FNS = {
  'TCT_Brightness': {lt4: LT5_TCT_B, lt5: LT5_TCT_B, lt7: LT7_TCT_B, lt8: LT8_TCT_B, lt9: LT8_TCT_B},
  'TCT_Greenness':  {lt4: LT5_TCT_G, lt5: LT5_TCT_G, lt7: LT7_TCT_G, lt8: LT8_TCT_G, lt9: LT8_TCT_G},
  'TCT_Wetness':    {lt4: LT5_TCT_W, lt5: LT5_TCT_W, lt7: LT7_TCT_W, lt8: LT8_TCT_W, lt9: LT8_TCT_W}
};

// Per-mission config for the landsat_single pipeline branch.
var LANDSAT_SINGLE_CONFIG = {
  'LT04': {
    renameFn: renameLT57,
    tctKey:   'lt4',
    label:    'LT4 TM: 1982–1993',
    tctNote:  'TCT: Crist (1985) TM coefficients.'
  },
  'LT05': {
    renameFn: renameLT57,
    tctKey:   'lt5',
    label:    'LT5 TM: 1984–2012',
    tctNote:  'TCT: Crist (1985) TM coefficients.'
  },
  'LE07': {
    renameFn: renameLT57,
    tctKey:   'lt7',
    label:    'LT7 ETM+: 1999–2024  ·  Note: SLC scan-line gaps from May 2003 onward.',
    tctNote:  'TCT: Huang et al. (2002) ETM+ coefficients.'
  },
  'LC08': {
    renameFn: renameLT8,
    tctKey:   'lt8',
    label:    'LT8 OLI/TIRS: 2013–present',
    tctNote:  'TCT: Baig et al. (2014) OLI coefficients.'
  },
  'LC09': {
    renameFn: renameLT8,
    tctKey:   'lt9',
    label:    'LT9 OLI-2/TIRS-2: 2021–present',
    tctNote:  'TCT: Baig et al. (2014) OLI coefficients (applied to OLI-2).'
  }
};


// ============================================================================
// SECTION 1C: SENTINEL-2 SR PIPELINE
// ============================================================================
// Supports: COPERNICUS/S2_SR_HARMONIZED — Level-2A SR, 2017-03-28 to present
// Six core bands renamed to common schema (matching Landsat) before any computation.
// SCL cloud/shadow masking is always applied inside the pipeline.
// TCT uses Shi & Xu (2019) coefficients (6-band, PCP-derived, aligned to LT8 TCT space).
// Ref: Shi, T. & Xu, H. (2019) IEEE JSTARS 12:4038-4048, doi:10.1109/JSTARS.2019.2938388
// ============================================================================

// ---- Scale factors (divide by 10000) ----
function applyS2ScaleFactors(image) {
  var optical = image.select('B.*').multiply(0.0001);
  return image.addBands(optical, null, true);
}

// ---- Band renaming (6 core bands matched to Landsat schema) ----
function renameS2(img) {
  return img.select(
    ['B2',   'B3',    'B4',  'B8',  'B11',   'B12'],
    ['Blue', 'Green', 'Red', 'NIR', 'SWIR1', 'SWIR2']
  );
}

// ---- Cloud / shadow mask using SCL (Scene Classification Layer) ----
// Removes: cloud shadow (3), medium-probability cloud (8),
//          high-probability cloud (9), thin cirrus (10)
function maskQA_S2(img) {
  var scl = img.select('SCL');
  return img.updateMask(
    scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10))
  );
}

// ---- Spectral indices (same set as Landsat; LST excluded — not available for S2) ----
function S2_NDVI(img) {
  return img.normalizedDifference(['NIR', 'Red']).rename('NDVI')
    .set('system:time_start', img.get('system:time_start'));
}
function S2_EVI(img) {
  return img.expression(
    '2.5 * (NIR - RED) / (NIR + 6.0*RED - 7.5*BLUE + 1.0)', {
      NIR:  img.select('NIR').toFloat(),
      RED:  img.select('Red').toFloat(),
      BLUE: img.select('Blue').toFloat()
    }).rename('EVI').set('system:time_start', img.get('system:time_start'));
}
function S2_SAVI(img) {
  return img.expression(
    '1.5 * (NIR - RED) / (NIR + RED + 0.5)', {
      NIR: img.select('NIR').toFloat(),
      RED: img.select('Red').toFloat()
    }).rename('SAVI').set('system:time_start', img.get('system:time_start'));
}
function S2_NDWI(img) {
  // Gao variant: (NIR - SWIR1) / (NIR + SWIR1); SWIR1 = B11 (20 m)
  return img.normalizedDifference(['NIR', 'SWIR1']).rename('NDWI')
    .set('system:time_start', img.get('system:time_start'));
}
function S2_NBR(img) {
  // (NIR - SWIR2) / (NIR + SWIR2); SWIR2 = B12 (20 m)
  return img.normalizedDifference(['NIR', 'SWIR2']).rename('NBR')
    .set('system:time_start', img.get('system:time_start'));
}

var S2_INDEX_FNS = {
  'NDVI': S2_NDVI,
  'EVI':  S2_EVI,
  'SAVI': S2_SAVI,
  'NDWI': S2_NDWI,
  'NBR':  S2_NBR
};

// ---- Tasseled Cap (Shi & Xu 2019, 6-band PCP-derived, aligned to Landsat 8 OLI TCT) ----
// Bands: Blue(B2), Green(B3), Red(B4), NIR(B8), SWIR1(B11), SWIR2(B12)
// Note: coefficients derived for at-sensor reflectance; widely applied to SR data.
function S2_TCT_B(img) {
  return img.expression(
    '(B*0.3037)+(G*0.2793)+(R*0.4743)+(N*0.5585)+(S1*0.5082)+(S2*0.1863)',
    {B:img.select('Blue'),G:img.select('Green'),R:img.select('Red'),
     N:img.select('NIR'),S1:img.select('SWIR1'),S2:img.select('SWIR2')})
    .rename('TCTB').set('system:time_start', img.get('system:time_start'));
}
function S2_TCT_G(img) {
  return img.expression(
    '(B*-0.2848)+(G*-0.2435)+(R*-0.5436)+(N*0.7243)+(S1*0.0840)+(S2*-0.1800)',
    {B:img.select('Blue'),G:img.select('Green'),R:img.select('Red'),
     N:img.select('NIR'),S1:img.select('SWIR1'),S2:img.select('SWIR2')})
    .rename('TCTG').set('system:time_start', img.get('system:time_start'));
}
function S2_TCT_W(img) {
  return img.expression(
    '(B*0.1509)+(G*0.1973)+(R*0.3279)+(N*0.3406)+(S1*-0.7112)+(S2*-0.4572)',
    {B:img.select('Blue'),G:img.select('Green'),R:img.select('Red'),
     N:img.select('NIR'),S1:img.select('SWIR1'),S2:img.select('SWIR2')})
    .rename('TCTW').set('system:time_start', img.get('system:time_start'));
}

var S2_TCT_FNS = {
  'TCT_Brightness': S2_TCT_B,
  'TCT_Greenness':  S2_TCT_G,
  'TCT_Wetness':    S2_TCT_W
};


// ============================================================================
// SECTION 1D: SENTINEL-1 SAR PIPELINE
// ============================================================================
// Collection: COPERNICUS/S1_GRD — IW mode, dual-pol VV+VH, GRDH, 10 m
// GEE stores backscatter in dB. Ratios and vegetation indices require
// conversion to linear (power) units. VV, VH, and VV_minus_VH remain in dB.
// No cloud masking applies to SAR. Gap filling is bypassed for this pipeline.
// Data available from 2014-10-03 (S1A); full-year statistics start from 2015.
// S1B added 2016-04-25 (~6-day revisit); S1B EoL 2021-12-23; S1C 2023-12-05.
//
// Refs:
//   Mandal et al. (2020) Remote Sens. Environ. 247:111954     - DpRVI
//   Mitchard et al. (2012) Biogeosciences 9:179-191           - RFDI
// ============================================================================

// Convert dB to linear (power) scale: linear = 10^(dB/10)
function S1_dB2lin(img) {
  return ee.Image(10).pow(img.divide(10));
}

// VV backscatter — kept in dB as provided by GEE
function S1_VV(img) {
  return img.select('VV').rename('VV')
    .set('system:time_start', img.get('system:time_start'));
}

// VH backscatter — kept in dB as provided by GEE
function S1_VH(img) {
  return img.select('VH').rename('VH')
    .set('system:time_start', img.get('system:time_start'));
}

// dB difference VV − VH (= 10·log10(VV_lin/VH_lin)); stays in dB
function S1_VV_minus_VH(img) {
  return img.select('VV').subtract(img.select('VH')).rename('VV_minus_VH')
    .set('system:time_start', img.get('system:time_start'));
}

// Cross Ratio CR = VH_lin / VV_lin (linear power; requires dB→linear conversion)
function S1_CR(img) {
  var vvLin = S1_dB2lin(img.select('VV'));
  var vhLin = S1_dB2lin(img.select('VH'));
  return vhLin.divide(vvLin).rename('CR')
    .set('system:time_start', img.get('system:time_start'));
}

// Inverse Ratio IR = VV_lin / VH_lin (linear power)
function S1_IR(img) {
  var vvLin = S1_dB2lin(img.select('VV'));
  var vhLin = S1_dB2lin(img.select('VH'));
  return vvLin.divide(vhLin).rename('IR')
    .set('system:time_start', img.get('system:time_start'));
}

// DpRVI: Dual-pol Radar Vegetation Index (Mandal et al. 2020)
// q = VH_lin / VV_lin;  DpRVI = 4q / (1 + q)^2
// Range 0 (bare/low vegetation) → 1 (dense vegetation)
function S1_DpRVI(img) {
  var vvLin = S1_dB2lin(img.select('VV'));
  var vhLin = S1_dB2lin(img.select('VH'));
  var q = vhLin.divide(vvLin);
  return q.multiply(4).divide(q.add(1).pow(2)).rename('DpRVI')
    .set('system:time_start', img.get('system:time_start'));
}

// DpRVIc: DpRVI corrected by Degree of Polarization (DOP)
// DOP = |VV_lin − VH_lin| / (VV_lin + VH_lin)
// DpRVIc = DpRVI × (1 − DOP)  ≡  8q² / (1 + q)³  where q = VH_lin/VV_lin
// Range 0 → 1; penalises acquisitions with high polarisation contrast
function S1_DpRVIc(img) {
  var vvLin = S1_dB2lin(img.select('VV'));
  var vhLin = S1_dB2lin(img.select('VH'));
  var q     = vhLin.divide(vvLin);
  var dpRVI = q.multiply(4).divide(q.add(1).pow(2));
  var dop   = vvLin.subtract(vhLin).abs().divide(vvLin.add(vhLin));
  return dpRVI.multiply(ee.Image(1).subtract(dop)).rename('DpRVIc')
    .set('system:time_start', img.get('system:time_start'));
}

// RFDI: Radar Forest Degradation Index (Mitchard et al. 2012)
// RFDI = (VV_lin − VH_lin) / (VV_lin + VH_lin)
// Range −1 to 1; sensitive to forest structure and degradation.
// Higher values indicate surface-dominated scattering (open land, degraded forest).
function S1_RFDI(img) {
  var vvLin = S1_dB2lin(img.select('VV'));
  var vhLin = S1_dB2lin(img.select('VH'));
  return vvLin.subtract(vhLin).divide(vvLin.add(vhLin)).rename('RFDI')
    .set('system:time_start', img.get('system:time_start'));
}

var S1_INDEX_FNS = {
  'VV':          S1_VV,
  'VH':          S1_VH,
  'VV_minus_VH': S1_VV_minus_VH,
  'CR':          S1_CR,
  'IR':          S1_IR,
  'DpRVI':       S1_DpRVI,
  'DpRVIc':      S1_DpRVIc,
  'RFDI':        S1_RFDI
};


// ============================================================================
// SECTION 1E: SENTINEL-3 OLCI PIPELINE
// ============================================================================
// Supports: COPERNICUS/S3/OLCI — Level-1 EFR TOA radiances, 300m, 2016-10-18+
// Bands are TOA radiances with per-band scale factors (not a uniform reflectance factor).
// Scale factors applied before index computation; no renaming to common schema needed.
// No TCT: no published TCT coefficients for OLCI in the literature.
// QA masking always applied: removes invalid pixels and band saturation in key bands.
// Ref: Dash & Curran (2004) Int. J. Remote Sens. 25:5403-5413 (OTCI/MTCI)
// ============================================================================

// Apply per-band scale factors to the five bands used in index computation.
// Oa06=Green(560nm), Oa08=Red(665nm), Oa10=681nm, Oa11=RedEdge(709nm), Oa17=NIR(865nm)
function applyS3ScaleFactors(img) {
  return img
    .addBands(img.select('Oa06_radiance').multiply(0.0123538),  null, true)
    .addBands(img.select('Oa08_radiance').multiply(0.00876539), null, true)
    .addBands(img.select('Oa10_radiance').multiply(0.00773378), null, true)
    .addBands(img.select('Oa11_radiance').multiply(0.00675523), null, true)
    .addBands(img.select('Oa17_radiance').multiply(0.00493004), null, true);
}

// Mask invalid pixels (bit 25) and saturated pixels in the five computation bands.
// Saturation flags: Oa01=bit0 … Oa06=bit5, Oa08=bit7, Oa10=bit9, Oa11=bit10, Oa17=bit16.
// Bit 27 (bright/glint) not masked here — too aggressive for general land use.
function maskQA_S3(img) {
  var qa = img.select('quality_flags');
  return img.updateMask(
    qa.bitwiseAnd(1 << 25).eq(0)          // invalid pixel
      .and(qa.bitwiseAnd(1 <<  5).eq(0))  // Oa06 saturated
      .and(qa.bitwiseAnd(1 <<  7).eq(0))  // Oa08 saturated
      .and(qa.bitwiseAnd(1 <<  9).eq(0))  // Oa10 saturated
      .and(qa.bitwiseAnd(1 << 10).eq(0))  // Oa11 saturated
      .and(qa.bitwiseAnd(1 << 16).eq(0))  // Oa17 saturated
  );
}

function S3_NDVI(img) {
  return img.normalizedDifference(['Oa17_radiance', 'Oa08_radiance'])
    .rename('NDVI').set('system:time_start', img.get('system:time_start'));
}

// OLCI Terrestrial Chlorophyll Index (OTCI) — ESA standard OLCI land product,
// continuation of the MERIS MTCI. Exploits the three red-edge bands unique to OLCI.
// Range typically 0–7 for vegetation; can exceed Int16 range — export requires Int32.
function S3_OTCI(img) {
  return img.expression(
    '(Oa11 - Oa10) / (Oa10 - Oa08)',
    { Oa11: img.select('Oa11_radiance').toFloat(),
      Oa10: img.select('Oa10_radiance').toFloat(),
      Oa08: img.select('Oa08_radiance').toFloat() }
  ).rename('OTCI').set('system:time_start', img.get('system:time_start'));
}

// NDWI (McFeeters 1996): (Green - NIR) / (Green + NIR)
// Sensitive to open water and vegetation water content.
function S3_NDWI(img) {
  return img.normalizedDifference(['Oa06_radiance', 'Oa17_radiance'])
    .rename('NDWI').set('system:time_start', img.get('system:time_start'));
}

var S3_INDEX_FNS = {
  'NDVI': S3_NDVI,
  'OTCI': S3_OTCI,
  'NDWI': S3_NDWI
};


// ============================================================================
// SECTION 2: SPECTRAL INDEX FUNCTIONS
// ============================================================================

// MOD09A1: NDVI, EVI, SAVI, MSAVI, NDWI (500m, 7-band)
function MOD09A1_SpectralIndices(img) {
  var ndvi = img.expression(
    '(NIR - RED) / (NIR + RED)', {
      'NIR': img.select('sur_refl_b02'),
      'RED': img.select('sur_refl_b01')
  }).toFloat();

  var evi = img.expression(
    '(2.5 * (NIR - RED)) / (NIR + 6 * RED - 7.5 * BLUE + 1)', {
      'NIR': img.select('sur_refl_b02').toFloat().multiply(1E-4),
      'RED': img.select('sur_refl_b01').toFloat().multiply(1E-4),
      'BLUE': img.select('sur_refl_b03').toFloat().multiply(1E-4)
  });

  var savi = img.expression(
    '(1 + L) * (NIR - RED) / (NIR + RED + L)', {
      'NIR': img.select('sur_refl_b02').toFloat(),
      'RED': img.select('sur_refl_b01').toFloat(),
      'L': 0.5
  });

  var msavi = img.expression(
    '(2 * NIR + 1 - sqrt(pow((2 * NIR + 1), 2) - 8 * (NIR - RED))) / 2', {
      'NIR': img.select('sur_refl_b02').toFloat(),
      'RED': img.select('sur_refl_b01').toFloat()
  });

  var ndwi = img.expression(
    '(NIR - SWIR) / (NIR + SWIR)', {
      'NIR': img.select('sur_refl_b02'),
      'SWIR': img.select('sur_refl_b06')
  }).toFloat();

  return ndvi.addBands(evi).addBands(savi).addBands(msavi).addBands(ndwi)
    .rename(['ndvi', 'evi', 'savi', 'msavi', 'ndwi'])
    .set('system:time_start', img.get('system:time_start'));
}

// MOD09A1: Tasseled Cap Transform (Lobser & Cohen 2007) - returns float
function MOD09A1_TCT(img) {
  var b1 = img.select('sur_refl_b01').toDouble().multiply(1E-4);
  var b2 = img.select('sur_refl_b02').toDouble().multiply(1E-4);
  var b3 = img.select('sur_refl_b03').toDouble().multiply(1E-4);
  var b4 = img.select('sur_refl_b04').toDouble().multiply(1E-4);
  var b5 = img.select('sur_refl_b05').toDouble().multiply(1E-4);
  var b6 = img.select('sur_refl_b06').toDouble().multiply(1E-4);
  var b7 = img.select('sur_refl_b07').toDouble().multiply(1E-4);

  var bri = b1.multiply(0.4395).add(b2.multiply(0.5945))
    .add(b3.multiply(0.2460)).add(b4.multiply(0.3918))
    .add(b5.multiply(0.3506)).add(b6.multiply(0.2136))
    .add(b7.multiply(0.2678));

  var grn = b1.multiply(-0.4064).add(b2.multiply(0.5129))
    .add(b3.multiply(-0.2744)).add(b4.multiply(-0.2893))
    .add(b5.multiply(0.4882)).add(b6.multiply(-0.0036))
    .add(b7.multiply(-0.4169));

  var wet = b1.multiply(0.1147).add(b2.multiply(0.2489))
    .add(b3.multiply(0.2408)).add(b4.multiply(0.3132))
    .add(b5.multiply(-0.3122)).add(b6.multiply(-0.6416))
    .add(b7.multiply(-0.5087));

  return bri.toFloat().addBands(grn.toFloat()).addBands(wet.toFloat())
    .rename(['brightness', 'greenness', 'wetness'])
    .set('system:time_start', img.get('system:time_start'));
}

// MOD09A1: Burn indices (NBR, CSI, MIRBI)
function MOD09A1_burnIndices(img) {
  var nbr = img.expression(
    '(NIR - LSWIR) / (NIR + LSWIR)', {
      'NIR': img.select('sur_refl_b02'),
      'LSWIR': img.select('sur_refl_b07')
  }).toFloat();

  var csi = img.expression(
    'NIR / LSWIR', {
      'NIR': img.select('sur_refl_b02'),
      'LSWIR': img.select('sur_refl_b07')
  }).toFloat();

  var mirbi = img.expression(
    '10 * LSWIR - 9.8 * SSWIR + 2', {
      'LSWIR': img.select('sur_refl_b07').toFloat().multiply(1E-4),
      'SSWIR': img.select('sur_refl_b06').toFloat().multiply(1E-4)
  }).toFloat();

  return nbr.addBands(csi).addBands(mirbi)
    .rename(['NBR', 'CSI', 'MIRBI'])
    .set('system:time_start', img.get('system:time_start'));
}

// MOD09Q1: NDVI from 250m Red/NIR
function computeNDVI_MOD09Q1(img) {
  return img.normalizedDifference(['sur_refl_b02', 'sur_refl_b01']).toFloat()
    .rename('ndvi')
    .set('system:time_start', img.get('system:time_start'));
}


// ============================================================================
// SECTION 3: BRDF / ALBEDO FUNCTIONS (Schaaf et al. 2002)
// ============================================================================

// Extract broadband BRDF parameters (vis, nir, or shortwave)
function getBroadbandParams(broadband, paramsImage) {
  return paramsImage.select([
    'BRDF_Albedo_Parameters_' + broadband + '_iso',
    'BRDF_Albedo_Parameters_' + broadband + '_vol',
    'BRDF_Albedo_Parameters_' + broadband + '_geo'
  ], ['iso', 'vol', 'geo']).multiply(0.001);
}

// Black-sky albedo polynomial approximation (Schaaf et al. 2002, eq. 2)
function bsAlbedo(params, sza) {
  var szaRad = ee.Image(sza).multiply(Math.PI).divide(180.0);
  var sza2 = szaRad.pow(2);
  var sza3 = szaRad.pow(3);

  var iso = params.select(['iso']);
  var vol = params.select(['vol']).multiply(
    ee.Image(-0.007574).add(ee.Image(-0.070987).multiply(sza2))
      .add(ee.Image(0.307588).multiply(sza3)));
  var geo = params.select(['geo']).multiply(
    ee.Image(-1.284909).add(ee.Image(-0.166314).multiply(sza2))
      .add(ee.Image(0.041840).multiply(sza3)));

  return iso.add(vol).add(geo).select([0], ['bsa']);
}

// White-sky albedo (diffuse, SZA-independent)
function wsAlbedo(params) {
  var iso = params.select(['iso']).float();
  var vol = params.select(['vol']).multiply(0.189184);
  var geo = params.select(['geo']).multiply(-1.377622);
  return iso.add(vol).add(geo).select([0], ['wsa']);
}

// Compute all albedo bands from MCD43A1 BRDF parameters
// Returns 7 bands: wsa_vis, wsa_nir, wsa_shortwave, bsa_vis, bsa_nir, bsa_shortwave, avg_albedo
function computeAllAlbedo_MCD43A1(img) {
  var SZA = 30; // Fixed solar zenith angle for BSA

  var visP = getBroadbandParams('vis', img);
  var nirP = getBroadbandParams('nir', img);
  var swP  = getBroadbandParams('shortwave', img);

  var wsa_vis = wsAlbedo(visP).rename('wsa_vis');
  var wsa_nir = wsAlbedo(nirP).rename('wsa_nir');
  var wsa_sw  = wsAlbedo(swP).rename('wsa_shortwave');
  var bsa_vis = bsAlbedo(visP, SZA).rename('bsa_vis');
  var bsa_nir = bsAlbedo(nirP, SZA).rename('bsa_nir');
  var bsa_sw  = bsAlbedo(swP, SZA).rename('bsa_shortwave');

  var allBands = wsa_vis.addBands(wsa_nir).addBands(wsa_sw)
    .addBands(bsa_vis).addBands(bsa_nir).addBands(bsa_sw);

  var avg = allBands.reduce(ee.Reducer.mean()).rename('avg_albedo');

  return allBands.addBands(avg)
    .set('system:time_start', img.get('system:time_start'));
}


// ============================================================================
// SECTION 4: PRODUCT REGISTRY
// ============================================================================

var PRODUCTS = {
  'MOD09Q1 (250m, 8-day)': {
    geeId: 'MODIS/061/MOD09Q1',
    resolution: 250,
    temporal: '8-day',
    qaMask: maskQA_MOD09Q1,
    variables: {
      'NDVI': {compute: computeNDVI_MOD09Q1, band: 'ndvi'}
    }
  },

  'MOD09A1 (500m, 8-day)': {
    geeId: 'MODIS/061/MOD09A1',
    resolution: 500,
    temporal: '8-day',
    qaMask: maskQA_MOD09A1,
    variables: {
      'NDVI':           {compute: MOD09A1_SpectralIndices, band: 'ndvi'},
      'EVI':            {compute: MOD09A1_SpectralIndices, band: 'evi'},
      'SAVI':           {compute: MOD09A1_SpectralIndices, band: 'savi'},
      'MSAVI':          {compute: MOD09A1_SpectralIndices, band: 'msavi'},
      'NDWI':           {compute: MOD09A1_SpectralIndices, band: 'ndwi'},
      'NBR':            {compute: MOD09A1_burnIndices,     band: 'NBR'},
      'TCT_Brightness': {compute: MOD09A1_TCT,             band: 'brightness'},
      'TCT_Greenness':  {compute: MOD09A1_TCT,             band: 'greenness'},
      'TCT_Wetness':    {compute: MOD09A1_TCT,             band: 'wetness'}
    }
  },

  'MOD11A1 (1km, Daily)': {
    geeId: 'MODIS/061/MOD11A1',
    resolution: 1000,
    temporal: 'Daily',
    qaMask: null,   // per-variable masks below (Day vs Night use different QC bands)
    variables: {
      'LST_Day':   {band: 'LST_Day_1km',   scale: 0.02, qaMask: maskQA_MOD11_Day},
      'LST_Night': {band: 'LST_Night_1km',  scale: 0.02, qaMask: maskQA_MOD11_Night}
    }
  },

  'MOD11A2 (1km, 8-day)': {
    geeId: 'MODIS/061/MOD11A2',
    resolution: 1000,
    temporal: '8-day',
    qaMask: null,   // per-variable masks below
    variables: {
      'LST_Day':   {band: 'LST_Day_1km',   scale: 0.02, qaMask: maskQA_MOD11_Day},
      'LST_Night': {band: 'LST_Night_1km',  scale: 0.02, qaMask: maskQA_MOD11_Night}
    }
  },

  'MOD13Q1 (250m, 16-day)': {
    geeId: 'MODIS/061/MOD13Q1',
    resolution: 250,
    temporal: '16-day',
    qaMask: maskQA_MOD13Q1,
    variables: {
      'NDVI': {band: 'NDVI', scale: 0.0001},
      'EVI':  {band: 'EVI',  scale: 0.0001}
    }
  },

  'MOD17A2H (500m, 8-day)': {
    geeId: 'MODIS/061/MOD17A2H',
    resolution: 500,
    temporal: '8-day',
    qaMask: maskQA_MOD17A2H,
    variables: {
      'GPP':    {band: 'Gpp',    scale: 0.0001},
      'PsnNet': {band: 'PsnNet', scale: 0.0001}
    }
  },

  'MCD43A1 (500m, Daily)': {
    geeId: 'MODIS/061/MCD43A1',
    resolution: 500,
    temporal: 'Daily',
    qaMask: maskQA_MCD43A1,
    variables: {
      'WSA_vis':       {compute: computeAllAlbedo_MCD43A1, band: 'wsa_vis'},
      'WSA_nir':       {compute: computeAllAlbedo_MCD43A1, band: 'wsa_nir'},
      'WSA_shortwave': {compute: computeAllAlbedo_MCD43A1, band: 'wsa_shortwave'},
      'BSA_vis':       {compute: computeAllAlbedo_MCD43A1, band: 'bsa_vis'},
      'BSA_nir':       {compute: computeAllAlbedo_MCD43A1, band: 'bsa_nir'},
      'BSA_shortwave': {compute: computeAllAlbedo_MCD43A1, band: 'bsa_shortwave'},
      'Avg_Albedo':    {compute: computeAllAlbedo_MCD43A1, band: 'avg_albedo'}
    }
  },

  'MOD16A2 (500m, 8-day)': {
    geeId: 'MODIS/061/MOD16A2',
    resolution: 500,
    temporal: '8-day',
    qaMask: maskQA_MOD16A2,
    variables: {
      'ET': {band: 'ET', scale: 0.1}
    }
  },

  'MCD15A3H (500m, 4-day)': {
    geeId: 'MODIS/061/MCD15A3H',
    resolution: 500,
    temporal: '4-day',
    qaMask: maskQA_MCD15A3H,
    variables: {
      'LAI':  {band: 'Lai',  scale: 0.1},
      'FPAR': {band: 'Fpar', scale: 0.01}
    }
  },

  // ---- Landsat Harmonized (LT5 + LT7 + LT8, C02 T1 L2, 30m) ----
  // Collection loading is handled by a dedicated branch in loadAndProcessCollection.
  // fmask cloud masking is always applied; etmToOli harmonization applied for
  // reflectance indices; TCT uses mission-specific coefficients (no harmonization).
  'Landsat Harmonized (30m, LT5/7/8)': {
    type: 'landsat',
    resolution: 30,
    temporal: '16-day',   // nominal revisit; used for gap-fill buffer calculation
    qaMask: null,         // fmask is applied inside the Landsat pipeline builder
    variables: {
      'NDVI':           {band: 'NDVI'},
      'EVI':            {band: 'EVI'},
      'SAVI':           {band: 'SAVI'},
      'NBR':            {band: 'NBR'},
      'NDWI':           {band: 'NDWI'},
      'TCT_Brightness': {band: 'TCTB'},
      'TCT_Greenness':  {band: 'TCTG'},
      'TCT_Wetness':    {band: 'TCTW'},
      'LST':            {band: 'LST'}
    }
  },

  // ---- Individual Landsat missions (C02 T1 L2, 30m) ----
  // Each uses the landsat_single branch: single collection, no cross-sensor
  // harmonization. fmask always applied. TCT uses mission-specific coefficients.
  // Spectral indices computed on native reflectance.
  'Landsat 4 TM (30m, 1982–1993)': {
    type: 'landsat_single',
    mission: 'LT04',
    geeId: 'LANDSAT/LT04/C02/T1_L2',
    resolution: 30,
    temporal: '16-day',
    qaMask: null,
    variables: {
      'NDVI':           {band: 'NDVI'},
      'EVI':            {band: 'EVI'},
      'SAVI':           {band: 'SAVI'},
      'NBR':            {band: 'NBR'},
      'NDWI':           {band: 'NDWI'},
      'TCT_Brightness': {band: 'TCTB'},
      'TCT_Greenness':  {band: 'TCTG'},
      'TCT_Wetness':    {band: 'TCTW'},
      'LST':            {band: 'LST'}
    }
  },

  'Landsat 5 TM (30m, 1984–2012)': {
    type: 'landsat_single',
    mission: 'LT05',
    geeId: 'LANDSAT/LT05/C02/T1_L2',
    resolution: 30,
    temporal: '16-day',
    qaMask: null,
    variables: {
      'NDVI':           {band: 'NDVI'},
      'EVI':            {band: 'EVI'},
      'SAVI':           {band: 'SAVI'},
      'NBR':            {band: 'NBR'},
      'NDWI':           {band: 'NDWI'},
      'TCT_Brightness': {band: 'TCTB'},
      'TCT_Greenness':  {band: 'TCTG'},
      'TCT_Wetness':    {band: 'TCTW'},
      'LST':            {band: 'LST'}
    }
  },

  'Landsat 7 ETM+ (30m, 1999–2024)': {
    type: 'landsat_single',
    mission: 'LE07',
    geeId: 'LANDSAT/LE07/C02/T1_L2',
    resolution: 30,
    temporal: '16-day',
    qaMask: null,
    variables: {
      'NDVI':           {band: 'NDVI'},
      'EVI':            {band: 'EVI'},
      'SAVI':           {band: 'SAVI'},
      'NBR':            {band: 'NBR'},
      'NDWI':           {band: 'NDWI'},
      'TCT_Brightness': {band: 'TCTB'},
      'TCT_Greenness':  {band: 'TCTG'},
      'TCT_Wetness':    {band: 'TCTW'},
      'LST':            {band: 'LST'}
    }
  },

  'Landsat 8 OLI (30m, 2013+)': {
    type: 'landsat_single',
    mission: 'LC08',
    geeId: 'LANDSAT/LC08/C02/T1_L2',
    resolution: 30,
    temporal: '16-day',
    qaMask: null,
    variables: {
      'NDVI':           {band: 'NDVI'},
      'EVI':            {band: 'EVI'},
      'SAVI':           {band: 'SAVI'},
      'NBR':            {band: 'NBR'},
      'NDWI':           {band: 'NDWI'},
      'TCT_Brightness': {band: 'TCTB'},
      'TCT_Greenness':  {band: 'TCTG'},
      'TCT_Wetness':    {band: 'TCTW'},
      'LST':            {band: 'LST'}
    }
  },

  'Landsat 9 OLI-2 (30m, 2021+)': {
    type: 'landsat_single',
    mission: 'LC09',
    geeId: 'LANDSAT/LC09/C02/T1_L2',
    resolution: 30,
    temporal: '16-day',
    qaMask: null,
    variables: {
      'NDVI':           {band: 'NDVI'},
      'EVI':            {band: 'EVI'},
      'SAVI':           {band: 'SAVI'},
      'NBR':            {band: 'NBR'},
      'NDWI':           {band: 'NDWI'},
      'TCT_Brightness': {band: 'TCTB'},
      'TCT_Greenness':  {band: 'TCTG'},
      'TCT_Wetness':    {band: 'TCTW'},
      'LST':            {band: 'LST'}
    }
  },

  // ---- Sentinel-2 SR Harmonized (S2A + S2B, Level-2A, 10/20m) ----
  // Collection loading is handled by a dedicated branch in loadAndProcessCollection.
  // SCL cloud masking is always applied; no cross-sensor harmonization needed.
  // TCT uses Shi & Xu (2019) 6-band coefficients aligned to Landsat 8 TCT space.
  // Per-variable resolution overrides product.resolution in the export loop.
  'Sentinel-2 SR (10/20m, 5-day)': {
    type: 'sentinel2',
    geeId: 'COPERNICUS/S2_SR_HARMONIZED',
    resolution: 20,        // default scale shown in UI; NDVI/EVI/SAVI export at 10m
    temporal: '5-day',
    qaMask: null,          // SCL masking handled inside the Sentinel-2 pipeline
    variables: {
      'NDVI':           {band: 'NDVI',  resolution: 10},
      'EVI':            {band: 'EVI',   resolution: 10},
      'SAVI':           {band: 'SAVI',  resolution: 10},
      'NDWI':           {band: 'NDWI',  resolution: 20},
      'NBR':            {band: 'NBR',   resolution: 20},
      'TCT_Brightness': {band: 'TCTB',  resolution: 20},
      'TCT_Greenness':  {band: 'TCTG',  resolution: 20},
      'TCT_Wetness':    {band: 'TCTW',  resolution: 20}
    }
  },

  // ---- Sentinel-1 SAR (experimental) ----
  // Dedicated pipeline branch in loadAndProcessCollection.
  // All images filtered to IW mode + dual-pol VV+VH (GRDH, 10 m).
  // QA masking and temporal gap filling are not applicable for SAR and are
  // bypassed automatically; the UI disables those controls for this product.
  // VV/VH/VV_minus_VH are in dB; CR/IR are linear ratios; DpRVI/DpRVIc/RFDI
  // are dimensionless 0-1. Select years 2015 or later for full-year coverage.
  'Sentinel-1 SAR (10m, ~12-day)': {
    type: 'sentinel1',
    resolution: 10,
    temporal: '12-day',   // S1A-only revisit; ~6-day when S1B or S1C is active
    qaMask: null,
    variables: {
      'VV':          {band: 'VV'},
      'VH':          {band: 'VH'},
      'VV_minus_VH': {band: 'VV_minus_VH'},
      'CR':          {band: 'CR'},
      'IR':          {band: 'IR'},
      'DpRVI':       {band: 'DpRVI'},
      'DpRVIc':      {band: 'DpRVIc'},
      'RFDI':        {band: 'RFDI'}
    }
  },

  // ---- Sentinel-3 OLCI (S3A + S3B, Level-1 EFR TOA radiances, 300m) ----
  // Collection loading is handled by the sentinel3 branch in loadAndProcessCollection.
  // Per-band scale factors are applied before index computation (bands differ in scale).
  // QA masking (invalid + saturation) always applied. No TCT available for OLCI.
  'Sentinel-3 OLCI (300m, ~2-day)': {
    type: 'sentinel3',
    geeId: 'COPERNICUS/S3/OLCI',
    resolution: 300,
    temporal: '2-day',
    qaMask: null,   // invalid + saturation masking applied inside pipeline
    variables: {
      'NDVI': {band: 'NDVI'},
      'OTCI': {band: 'OTCI'},
      'NDWI': {band: 'NDWI'}
    }
  }
};

// Maps each mission label to its PRODUCTS keys (order determines dropdown order)
var MISSION_GROUPS = {
  'MODIS':      ['MOD09Q1 (250m, 8-day)', 'MOD09A1 (500m, 8-day)',
                 'MOD11A1 (1km, Daily)',   'MOD11A2 (1km, 8-day)',
                 'MOD13Q1 (250m, 16-day)', 'MOD17A2H (500m, 8-day)',
                 'MCD43A1 (500m, Daily)',  'MOD16A2 (500m, 8-day)',
                 'MCD15A3H (500m, 4-day)'],
  'Landsat':    ['Landsat Harmonized (30m, LT5/7/8)',
                 'Landsat 4 TM (30m, 1982–1993)',
                 'Landsat 5 TM (30m, 1984–2012)',
                 'Landsat 7 ETM+ (30m, 1999–2024)',
                 'Landsat 8 OLI (30m, 2013+)',
                 'Landsat 9 OLI-2 (30m, 2021+)'],
  'Sentinel-2': ['Sentinel-2 SR (10/20m, 5-day)'],
  'Sentinel-3': ['Sentinel-3 OLCI (300m, ~2-day)'],
  'Sentinel-1': ['Sentinel-1 SAR (10m, ~12-day)']
};
var MISSION_NAMES = ['MODIS', 'Landsat', 'Sentinel-2', 'Sentinel-3', 'Sentinel-1'];

// Per-product year-range button definitions.
// Each entry is an array of {label, start, end?} objects; end omitted means open-ended.
var PRODUCT_YEAR_RANGES = {
  'MOD09Q1 (250m, 8-day)':             [{label: 'MOD09Q1 range (2000+)',   start: 2000}],
  'MOD09A1 (500m, 8-day)':             [{label: 'MOD09A1 range (2000+)',   start: 2000}],
  'MOD11A1 (1km, Daily)':              [{label: 'MOD11A1 range (2000+)',   start: 2000}],
  'MOD11A2 (1km, 8-day)':              [{label: 'MOD11A2 range (2000+)',   start: 2000}],
  'MOD13Q1 (250m, 16-day)':            [{label: 'MOD13Q1 range (2000+)',   start: 2000}],
  'MOD17A2H (500m, 8-day)':            [{label: 'MOD17A2H range (2000+)',  start: 2000}],
  'MCD43A1 (500m, Daily)':             [{label: 'MCD43A1 range (2000+)',   start: 2000}],
  'MOD16A2 (500m, 8-day)':             [{label: 'MOD16A2 range (2001+)',   start: 2001}],
  'MCD15A3H (500m, 4-day)':            [{label: 'MCD15A3H range (2002+)',  start: 2002}],
  'Landsat Harmonized (30m, LT5/7/8)': [
    {label: 'All Landsat (1984+)',  start: 1984},
    {label: 'LT5 era (1984–2012)', start: 1984, end: 2012},
    {label: 'LT7 era (1999–2023)', start: 1999, end: 2023},
    {label: 'LT8 era (2013+)',     start: 2013}
  ],
  'Landsat 4 TM (30m, 1982–1993)':   [{label: 'LT4 range (1982–1993)', start: 1982, end: 1993}],
  'Landsat 5 TM (30m, 1984–2012)':   [{label: 'LT5 range (1984–2012)', start: 1984, end: 2012}],
  'Landsat 7 ETM+ (30m, 1999–2024)': [{label: 'LT7 range (1999–2023)', start: 1999, end: 2023}],
  'Landsat 8 OLI (30m, 2013+)':      [{label: 'LT8 range (2013+)',     start: 2013}],
  'Landsat 9 OLI-2 (30m, 2021+)':    [{label: 'LT9 range (2021+)',     start: 2021}],
  'Sentinel-2 SR (10/20m, 5-day)':     [{label: 'Sentinel-2 range (2017+)', start: 2017}],
  'Sentinel-3 OLCI (300m, ~2-day)':   [{label: 'Sentinel-3 range (2017+)', start: 2017}],
  'Sentinel-1 SAR (10m, ~12-day)':     [{label: 'Sentinel-1 range (2015+)', start: 2015}]
};


// ============================================================================
// SECTION 5: STATISTICS ENGINE
// ============================================================================

// DOY of annual maximum value (array-based sort approach)
function viTSdateOfMax(imgCol) {
  imgCol = addDOYband(imgCol);
  var imgArray = imgCol.toArray();
  var axes = {image: 0, band: 1};
  var sort = imgArray.arraySlice(axes.band, 0, 1);
  var sorted = imgArray.arraySort(sort);
  var len = sorted.arrayLength(axes.image);
  var values = sorted.arraySlice(axes.image, len.subtract(1), len);
  return values.arrayProject([axes.band]).arrayFlatten([['maxvalue', 'doy']]).select('doy');
}

// DOY of annual minimum value (mirror of max: take first after sort)
function viTSdateOfMin(imgCol) {
  imgCol = addDOYband(imgCol);
  var imgArray = imgCol.toArray();
  var axes = {image: 0, band: 1};
  var sort = imgArray.arraySlice(axes.band, 0, 1);
  var sorted = imgArray.arraySort(sort);
  var values = sorted.arraySlice(axes.image, 0, 1);
  return values.arrayProject([axes.band]).arrayFlatten([['minvalue', 'doy']]).select('doy');
}

// Stat categories for UI grouping
var STAT_CATEGORIES = {
  'Centrality & Extremes': ['Mean', 'Median', 'P05', 'P95', 'Min', 'Max'],
  'Dispersion':            ['StdDev', 'IQR', 'MAD', 'CV'],
  'Phenology':             ['DOY_Max', 'DOY_Min', 'Springness', 'Winterness', 'GSL'],
  'Integration':           ['CumSum', 'Amplitude']
};

// Compute a single statistic on an annual image collection
// yearCol: single-band ImageCollection for one year
// statName: string key from STAT_CATEGORIES
// doyMaxImage: pre-computed DOY_Max (for Springness/Winterness dependency)
function computeStatistic(yearCol, statName, doyMaxImage) {
  switch (statName) {
    // --- Centrality & Extremes ---
    case 'Mean':   return yearCol.mean();
    case 'Median': return yearCol.median();
    case 'P05':    return yearCol.reduce(ee.Reducer.percentile([5]));
    case 'P95':    return yearCol.reduce(ee.Reducer.percentile([95]));
    case 'Min':    return yearCol.min();
    case 'Max':    return yearCol.max();

    // --- Dispersion ---
    case 'StdDev':
      return yearCol.reduce(ee.Reducer.stdDev());

    case 'IQR':
      var iqrP95 = yearCol.reduce(ee.Reducer.percentile([95])).rename('val');
      var iqrP05 = yearCol.reduce(ee.Reducer.percentile([5])).rename('val');
      return iqrP95.subtract(iqrP05);

    case 'MAD':
      var med = yearCol.median();
      var absDev = yearCol.map(function(img) {
        return img.subtract(med).abs()
          .copyProperties(img, ['system:time_start']);
      });
      return absDev.median();

    case 'CV':
      var cvAvg = yearCol.mean().rename('val');
      var cvStd = yearCol.reduce(ee.Reducer.stdDev()).rename('val');
      return cvStd.divide(cvAvg.abs().max(1e-10));

    // --- Phenology ---
    case 'DOY_Max':
      return doyMaxImage || viTSdateOfMax(yearCol);

    case 'DOY_Min':
      return viTSdateOfMin(yearCol);

    case 'Springness':
      return sprg(doyMaxImage);

    case 'Winterness':
      return wint(doyMaxImage);

    case 'GSL':
      var medGSL = yearCol.median();
      var above = yearCol.map(function(img) {
        return img.gt(medGSL).selfMask()
          .copyProperties(img, ['system:time_start']);
      });
      return above.count();

    // --- Integration ---
    case 'CumSum':
      return yearCol.sum();

    case 'Amplitude':
      return yearCol.max().subtract(yearCol.min());

    default:
      return null;
  }
}


// ============================================================================
// SECTION 6: COLLECTION LOADING PIPELINE & EXPORT
// ============================================================================

// Convert product cadence labels to days for year-edge interpolation buffers.
function getTemporalStepDays(product) {
  if (product.temporal === 'Daily') return 1;

  var match = product.temporal.match(/^(\d+)-day$/);
  if (match) return parseInt(match[1], 10);

  return 1;
}

// Fill masked pixels in each timestamp from a centered, image-count temporal window.
// The focal image is included in the reducer, but original valid pixels are preserved.
function gapFillTemporalReducer(imgCol, windowSize, method) {
  var halfWindow = Math.floor(windowSize / 2);
  var sorted = ee.ImageCollection(imgCol).sort('system:time_start');
  var count = sorted.size();
  var imgList = sorted.toList(count);
  var indexes = ee.List(ee.Algorithms.If(
    count.gt(0),
    ee.List.sequence(0, count.subtract(1)),
    ee.List([])
  ));

  var filled = indexes.map(function(index) {
    index = ee.Number(index);
    var start = index.subtract(halfWindow).max(0);
    var end = index.add(halfWindow).add(1).min(count);
    var localCol = ee.ImageCollection.fromImages(imgList.slice(start, end));
    var filler = (method === 'Mean') ? localCol.mean() : localCol.median();
    var img = ee.Image(imgList.get(index));

    return img.unmask(filler)
      .copyProperties(img, img.propertyNames());
  });

  return ee.ImageCollection.fromImages(filled)
    .sort('system:time_start');
}

// Whittaker smoother: penalized least squares fit with 3rd-order differences.
// Adapted from TS_Phenology/app/app (whittakerSmoothing).
// Operates on a single-band ee.ImageCollection; returns a smoothed ImageCollection
// with the same band name and system:time_start preserved on each image.
function whittakerSmoothing(imageCollection, lambda) {
  if (lambda === undefined) lambda = 10;

  // Unpack a flattened array image back into an ImageCollection
  var unpack = function(arrayImage, imageIds, bands) {
    function iter(item, icoll) {
      function innerIter(innerItem, innerList) {
        return ee.List(innerList).add(ee.String(item).cat('_').cat(ee.String(innerItem)));
      }
      var temp = bands.iterate(innerIter, ee.List([]));
      return ee.ImageCollection(icoll)
        .merge(ee.ImageCollection(ee.Image(arrayImage).select(temp, bands).set('id', item)));
    }
    return ee.ImageCollection(imageIds.iterate(iter, ee.ImageCollection([])));
  };

  // Build recursive difference matrix of given order
  var getDifferenceMatrix = function(inputMatrix, order) {
    var rowCount = ee.Number(inputMatrix.length().get([0]));
    var left  = inputMatrix.slice(0, 0, rowCount.subtract(1));
    var right = inputMatrix.slice(0, 1, rowCount);
    if (order > 1) {
      return getDifferenceMatrix(left.subtract(right), order - 1);
    }
    return left.subtract(right);
  };

  // Cast to float and unmask to prevent array dimension mismatch
  var ic = imageCollection.map(function(image) {
    var t = image.get('system:time_start');
    return image.toFloat().unmask(0).set('system:time_start', t);
  });

  // Build penalty matrix: lambda * D'D + I  (3rd-order differences)
  var dimension = ic.size();
  var identity = ee.Array.identity(dimension);
  var D = getDifferenceMatrix(identity, 3);
  var Dt = D.transpose();
  var penalty = Dt.multiply(lambda).matrixMultiply(D);
  var A = penalty.add(identity);

  // Solve A * z = y  for each pixel
  var arrayImage = ic.toArray();
  var smoothImage = ee.Image(A).matrixSolve(arrayImage);

  // Unpack smoothed array back to ImageCollection
  var idList = ee.List(ic.iterate(function(image, list) {
    return ee.List(list).add(image.id());
  }, []));
  var bandList = ee.Image(ic.first()).bandNames();
  var flatImage = smoothImage.arrayFlatten([idList, bandList]);
  var smoothCol = unpack(flatImage, idList, bandList);

  // Restore system:time_start from original collection
  var timeList = ee.List(ic.iterate(function(image, list) {
    return ee.List(list).add(image.get('system:time_start'));
  }, []));
  var smoothColWithTime = smoothCol.iterate(function(image, list) {
    return ee.List(list).add(
      image.set('system:time_start', timeList.get(ee.List(list).size()))
    );
  }, []);

  return ee.ImageCollection.fromImages(smoothColWithTime)
    .sort('system:time_start');
}

// Moving-window smoother: replaces each pixel value with the median or mean
// of its temporal neighbours within a centered window.
// Window size is in image count (must be odd >= 3).
// Masked pixels are set to 0 before reducing; original mask is restored after.
function movingWindowSmooth(imgCol, windowSize, method) {
  var halfWindow = Math.floor(windowSize / 2);
  var sorted = ee.ImageCollection(imgCol).sort('system:time_start');
  var count = sorted.size();
  var imgList = sorted.toList(count);
  var indexes = ee.List(ee.Algorithms.If(
    count.gt(0),
    ee.List.sequence(0, count.subtract(1)),
    ee.List([])
  ));

  var smoothed = indexes.map(function(index) {
    index = ee.Number(index);
    var start = index.subtract(halfWindow).max(0);
    var end = index.add(halfWindow).add(1).min(count);
    var localCol = ee.ImageCollection.fromImages(imgList.slice(start, end))
      .map(function(img) { return img.unmask(0); });
    var result = (method === 'Mean') ? localCol.mean() : localCol.median();
    var orig = ee.Image(imgList.get(index));
    // Restore the original mask so downstream stats ignore truly absent pixels
    return result.updateMask(orig.mask())
      .copyProperties(orig, orig.propertyNames());
  });

  return ee.ImageCollection.fromImages(smoothed)
    .sort('system:time_start');
}

// Harmonic (Fourier) smoother: fits a sum of annual harmonics to each pixel's time
// series using ordinary least squares, then replaces every observation with the
// modelled value at that timestamp.
//   numHarmonics 1 → annual cycle only      (3 params: intercept + sin + cos)
//   numHarmonics 2 → + semi-annual          (5 params)
//   numHarmonics 3 → + tertiary cycle       (7 params)
// Masked pixels are excluded from the OLS fit; pixels with no valid observations
// remain masked in the output.
function harmonicSmoothing(imgCol, numHarmonics) {
  if (numHarmonics === undefined) numHarmonics = 2;
  var numX = 1 + 2 * numHarmonics;  // intercept + sin/cos pair per harmonic

  var sorted = imgCol.sort('system:time_start');
  var t0 = ee.Date(ee.Image(sorted.first()).get('system:time_start'));
  var bandName = ee.Image(sorted.first()).bandNames().get(0);

  // Build design matrix [1, sin(2πkt), cos(2πkt)… | response] per image.
  // JS for-loop is valid here — numHarmonics is a client-side integer.
  var designCol = sorted.map(function(img) {
    var t = ee.Date(img.get('system:time_start')).difference(t0, 'year');
    var ts = img.get('system:time_start');
    var row = ee.Image(1).rename('c');
    for (var k = 1; k <= numHarmonics; k++) {
      var angle = t.multiply(k * 2 * Math.PI);
      row = row
        .addBands(ee.Image(angle.sin()).rename('s' + k))
        .addBands(ee.Image(angle.cos()).rename('c' + k));
    }
    return row.addBands(img.select([bandName]).rename('y'))
              .toDouble()
              .set('system:time_start', ts);
  });

  // Fit: coefficients image has shape [numX, 1]; masked pixels in the response
  // band are naturally excluded from the regression.
  var coeffs = designCol.reduce(ee.Reducer.linearRegression(numX, 1))
                        .select('coefficients');

  // Predict at each original timestamp using the fitted coefficients.
  var predicted = sorted.map(function(img) {
    var t = ee.Date(img.get('system:time_start')).difference(t0, 'year');
    var ts = img.get('system:time_start');
    var pred = ee.Image(coeffs.arrayGet([0, 0]));  // intercept
    for (var k = 1; k <= numHarmonics; k++) {
      var angle = t.multiply(k * 2 * Math.PI);
      pred = pred
        .add(ee.Image(coeffs.arrayGet([2 * k - 1, 0])).multiply(angle.sin()))
        .add(ee.Image(coeffs.arrayGet([2 * k,     0])).multiply(angle.cos()));
    }
    return pred.rename(ee.List([bandName])).toFloat().set('system:time_start', ts);
  });

  return ee.ImageCollection(predicted).sort('system:time_start');
}

// Load, filter, mask, and process a collection for one variable and year.
// Handles both MODIS (single-collection) and Landsat Harmonized (multi-mission merge).
function loadAndProcessCollection(productKey, varName, year, aoi, gapFillOptions, smoothingOptions, mwOptions, harmonicOptions) {
  var product = PRODUCTS[productKey];
  var varConfig = product.variables[varName];
  gapFillOptions = gapFillOptions || {enabled: false};
  smoothingOptions = smoothingOptions || {enabled: false};
  mwOptions = mwOptions || {enabled: false};
  harmonicOptions = harmonicOptions || {enabled: false, numHarmonics: 2, bufferMonths: 0};

  var startDate = ee.Date.fromYMD(year, 1, 1);
  var endDate = startDate.advance(1, 'year');
  var loadStartDate = startDate;
  var loadEndDate = endDate;

  if (gapFillOptions.enabled) {
    var bufferDays = getTemporalStepDays(product) * Math.floor(gapFillOptions.window / 2);
    loadStartDate = startDate.advance(-bufferDays, 'day');
    loadEndDate = endDate.advance(bufferDays, 'day');
  }
  if (mwOptions.enabled) {
    var mwBufferDays = getTemporalStepDays(product) * Math.floor(mwOptions.window / 2);
    loadStartDate = loadStartDate.advance(-mwBufferDays, 'day');
    loadEndDate = loadEndDate.advance(mwBufferDays, 'day');
  }

  // Months buffer for smoother edge correction (Whittaker or Moving-Window).
  // Loads extra data before/after the year so edge images have neighbours to smooth
  // against; the buffer is stripped by filterDate(startDate, endDate) in each branch.
  var smoothMonths = 0;
  if (smoothingOptions.enabled && smoothingOptions.bufferMonths > 0) {
    smoothMonths = smoothingOptions.bufferMonths;
  } else if (mwOptions.enabled && mwOptions.bufferMonths > 0) {
    smoothMonths = mwOptions.bufferMonths;
  } else if (harmonicOptions.enabled && harmonicOptions.bufferMonths > 0) {
    smoothMonths = harmonicOptions.bufferMonths;
  }
  if (smoothMonths > 0) {
    loadStartDate = loadStartDate.advance(-smoothMonths, 'month');
    loadEndDate = loadEndDate.advance(smoothMonths, 'month');
  }

  // ---- Landsat Harmonized branch ----
  if (product.type === 'landsat') {
    var ltFilter = ee.Filter.and(
      ee.Filter.bounds(aoi),
      ee.Filter.date(loadStartDate, loadEndDate)
    );
    var lt8raw = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').filter(ltFilter);
    var lt7raw = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2').filter(ltFilter);
    var lt5raw = ee.ImageCollection('LANDSAT/LT05/C02/T1_L2').filter(ltFilter);

    var col;

    if (varName === 'LST') {
      // LST: extract thermal band, scale to Kelvin, subtract 273.15 → Celsius
      var mkLST = function(renameFn) {
        return function(img) {
          var orig = img;
          img = applyLandsatScaleFactors(img);
          img = renameFn(img);
          img = fmaskLandsat(img);
          return ee.Image(LT_LST(img).copyProperties(orig, orig.propertyNames()));
        };
      };
      col = lt8raw.map(mkLST(renameLT8))
        .merge(lt7raw.map(mkLST(renameLT57)))
        .merge(lt5raw.map(mkLST(renameLT57)));

    } else if (varName === 'TCT_Brightness' || varName === 'TCT_Greenness' ||
               varName === 'TCT_Wetness') {
      // TCT: mission-specific coefficients applied BEFORE cross-sensor harmonization
      var tctFnMap = LT_TCT_FNS[varName];
      var mkTCT = function(renameFn, tctFn) {
        return function(img) {
          var orig = img;
          img = applyLandsatScaleFactors(img);
          img = renameFn(img);
          img = fmaskLandsat(img);
          return ee.Image(tctFn(img.toFloat()).copyProperties(orig, orig.propertyNames()));
        };
      };
      col = lt8raw.map(mkTCT(renameLT8,  tctFnMap.lt8))
        .merge(lt7raw.map(mkTCT(renameLT57, tctFnMap.lt7)))
        .merge(lt5raw.map(mkTCT(renameLT57, tctFnMap.lt5)));

    } else {
      // Reflectance indices: harmonize ETM+/TM to OLI space first, then compute index
      var idxFn = LT_INDEX_FNS[varName];
      var mkIdx8 = function(img) {
        var orig = img;
        img = applyLandsatScaleFactors(img);
        img = renameLT8(img);
        img = fmaskLandsat(img);
        return ee.Image(idxFn(img.toFloat()).copyProperties(orig, orig.propertyNames()));
      };
      var mkIdx57 = function(img) {
        var orig = img;
        img = applyLandsatScaleFactors(img);
        img = renameLT57(img);
        img = fmaskLandsat(img);
        img = ee.Image(etmToOli(img).copyProperties(orig, orig.propertyNames()));
        return ee.Image(idxFn(img.toFloat()).copyProperties(orig, orig.propertyNames()));
      };
      col = lt8raw.map(mkIdx8)
        .merge(lt7raw.map(mkIdx57))
        .merge(lt5raw.map(mkIdx57));
    }

    col = col.sort('system:time_start');
    if (gapFillOptions.enabled) {
      col = gapFillTemporalReducer(col, gapFillOptions.window, gapFillOptions.method);
    }
    if (smoothingOptions.enabled) {
      col = whittakerSmoothing(col, smoothingOptions.lambda);
    }
    if (mwOptions.enabled) {
      col = movingWindowSmooth(col, mwOptions.window, mwOptions.method);
    }
    if (harmonicOptions.enabled) {
      col = harmonicSmoothing(col, harmonicOptions.numHarmonics);
    }
    return col.filterDate(startDate, endDate).sort('system:time_start');
  }

  // ---- Landsat Single-Mission branch ----
  // Single collection, fmask applied, no cross-sensor harmonization.
  // TCT uses mission-specific coefficients via LANDSAT_SINGLE_CONFIG.
  // Spectral indices computed on native (unharmonized) reflectance.
  if (product.type === 'landsat_single') {
    var ltsCfg = LANDSAT_SINGLE_CONFIG[product.mission];
    var ltsRenameFn = ltsCfg.renameFn;
    var ltsTctKey   = ltsCfg.tctKey;
    var ltsFilter = ee.Filter.and(
      ee.Filter.bounds(aoi),
      ee.Filter.date(loadStartDate, loadEndDate)
    );
    var ltsRaw = ee.ImageCollection(product.geeId).filter(ltsFilter);

    var col;
    if (varName === 'LST') {
      col = ltsRaw.map(function(img) {
        var orig = img;
        img = applyLandsatScaleFactors(img);
        img = ltsRenameFn(img);
        img = fmaskLandsat(img);
        return ee.Image(LT_LST(img).copyProperties(orig, orig.propertyNames()));
      });
    } else if (varName === 'TCT_Brightness' || varName === 'TCT_Greenness' ||
               varName === 'TCT_Wetness') {
      var ltsTctFn = LT_TCT_FNS[varName][ltsTctKey];
      col = ltsRaw.map(function(img) {
        var orig = img;
        img = applyLandsatScaleFactors(img);
        img = ltsRenameFn(img);
        img = fmaskLandsat(img);
        return ee.Image(ltsTctFn(img.toFloat()).copyProperties(orig, orig.propertyNames()));
      });
    } else {
      var ltsIdxFn = LT_INDEX_FNS[varName];
      col = ltsRaw.map(function(img) {
        var orig = img;
        img = applyLandsatScaleFactors(img);
        img = ltsRenameFn(img);
        img = fmaskLandsat(img);
        return ee.Image(ltsIdxFn(img.toFloat()).copyProperties(orig, orig.propertyNames()));
      });
    }

    col = col.sort('system:time_start');
    if (gapFillOptions.enabled) {
      col = gapFillTemporalReducer(col, gapFillOptions.window, gapFillOptions.method);
    }
    if (smoothingOptions.enabled) {
      col = whittakerSmoothing(col, smoothingOptions.lambda);
    }
    if (mwOptions.enabled) {
      col = movingWindowSmooth(col, mwOptions.window, mwOptions.method);
    }
    if (harmonicOptions.enabled) {
      col = harmonicSmoothing(col, harmonicOptions.numHarmonics);
    }
    return col.filterDate(startDate, endDate).sort('system:time_start');
  }

  // ---- Sentinel-2 SR Harmonized branch ----
  if (product.type === 'sentinel2') {
    var s2Filter = ee.Filter.and(
      ee.Filter.bounds(aoi),
      ee.Filter.date(loadStartDate, loadEndDate)
    );
    var s2raw = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filter(s2Filter);

    // SCL cloud/shadow mask is always applied (mirrors fmask behaviour in Landsat branch)
    s2raw = s2raw.map(maskQA_S2);

    var col;
    if (varName === 'TCT_Brightness' || varName === 'TCT_Greenness' ||
        varName === 'TCT_Wetness') {
      var s2TctFn = S2_TCT_FNS[varName];
      col = s2raw.map(function(img) {
        var orig = img;
        img = applyS2ScaleFactors(img);
        img = renameS2(img);
        return ee.Image(s2TctFn(img.toFloat()).copyProperties(orig, orig.propertyNames()));
      });
    } else {
      var s2IdxFn = S2_INDEX_FNS[varName];
      col = s2raw.map(function(img) {
        var orig = img;
        img = applyS2ScaleFactors(img);
        img = renameS2(img);
        return ee.Image(s2IdxFn(img.toFloat()).copyProperties(orig, orig.propertyNames()));
      });
    }

    col = col.sort('system:time_start');
    if (gapFillOptions.enabled) {
      col = gapFillTemporalReducer(col, gapFillOptions.window, gapFillOptions.method);
    }
    if (smoothingOptions.enabled) {
      col = whittakerSmoothing(col, smoothingOptions.lambda);
    }
    if (mwOptions.enabled) {
      col = movingWindowSmooth(col, mwOptions.window, mwOptions.method);
    }
    if (harmonicOptions.enabled) {
      col = harmonicSmoothing(col, harmonicOptions.numHarmonics);
    }
    return col.filterDate(startDate, endDate).sort('system:time_start');
  }

  // ---- Sentinel-1 SAR branch ----
  // Filters to IW mode, dual-pol VV+VH. No cloud masking (SAR is all-weather).
  // Gap filling is not applied regardless of the UI toggle state.
  if (product.type === 'sentinel1') {
    var s1raw = ee.ImageCollection('COPERNICUS/S1_GRD')
      .filter(ee.Filter.eq('instrumentMode', 'IW'))
      .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
      .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
      .filterBounds(aoi)
      .filterDate(loadStartDate, loadEndDate);

    var s1IdxFn = S1_INDEX_FNS[varName];
    var col = s1raw.map(function(img) {
      return ee.Image(s1IdxFn(img).copyProperties(img, img.propertyNames()));
    });

    // Gap fill is NOT applied for SAR regardless of gapFillOptions.enabled
    return col.sort('system:time_start')
      .filterDate(startDate, endDate)
      .sort('system:time_start');
  }

  // ---- Sentinel-3 OLCI branch ----
  // Radiances scaled per-band (applyS3ScaleFactors); QA masking always applied.
  // Gap fill and all smoothers are supported; no SAR-style restrictions.
  if (product.type === 'sentinel3') {
    var s3Filter = ee.Filter.and(
      ee.Filter.bounds(aoi),
      ee.Filter.date(loadStartDate, loadEndDate)
    );
    var s3raw = ee.ImageCollection(product.geeId).filter(s3Filter);
    s3raw = s3raw.map(maskQA_S3);

    var s3IdxFn = S3_INDEX_FNS[varName];
    var col = s3raw.map(function(img) {
      var orig = img;
      img = applyS3ScaleFactors(img);
      return ee.Image(s3IdxFn(img.toFloat()).copyProperties(orig, orig.propertyNames()));
    });

    col = col.sort('system:time_start');
    if (gapFillOptions.enabled) {
      col = gapFillTemporalReducer(col, gapFillOptions.window, gapFillOptions.method);
    }
    if (smoothingOptions.enabled) {
      col = whittakerSmoothing(col, smoothingOptions.lambda);
    }
    if (mwOptions.enabled) {
      col = movingWindowSmooth(col, mwOptions.window, mwOptions.method);
    }
    if (harmonicOptions.enabled) {
      col = harmonicSmoothing(col, harmonicOptions.numHarmonics);
    }
    return col.filterDate(startDate, endDate).sort('system:time_start');
  }

  // ---- MODIS branch (original pipeline) ----
  var col = ee.ImageCollection(product.geeId)
    .filterDate(loadStartDate, loadEndDate)
    .filterBounds(aoi);

  // Apply product-level QA mask (cloud/shadow/cirrus) if toggle is enabled
  if (product.qaMask && applyQAMask) {
    col = col.map(product.qaMask);
  }
  // Apply variable-level QA mask (e.g. MOD11 Day vs Night use separate QC bands)
  if (varConfig.qaMask && applyQAMask) {
    col = col.map(varConfig.qaMask);
  }

  // Route: computed variable vs direct band selection + scale
  if (varConfig.compute) {
    col = col.map(varConfig.compute).select([varConfig.band]);
  } else {
    var scaleFactor = varConfig.scale;
    var bandName = varConfig.band;
    col = col.map(function(img) {
      return img.select([bandName]).toFloat().multiply(scaleFactor)
        .copyProperties(img, ['system:time_start']);
    });
  }

  col = col.sort('system:time_start');

  if (gapFillOptions.enabled) {
    col = gapFillTemporalReducer(col, gapFillOptions.window, gapFillOptions.method);
  }

  if (smoothingOptions.enabled) {
    col = whittakerSmoothing(col, smoothingOptions.lambda);
  }

  if (mwOptions.enabled) {
    col = movingWindowSmooth(col, mwOptions.window, mwOptions.method);
  }

  if (harmonicOptions.enabled) {
    col = harmonicSmoothing(col, harmonicOptions.numHarmonics);
  }

  return col.filterDate(startDate, endDate)
    .sort('system:time_start');
}

// ---- Export encoding helpers ----
var EXPORT_ENCODING_FLOAT = 'Float32 (original)';
var EXPORT_ENCODING_COMPACT = 'Compact integer (auto)';

var INT16_MIN = -32768;
var INT16_MAX = 32767;
var INT32_MIN = -2147483648;
var INT32_MAX = 2147483647;

function makeExportEncoding(type, factor) {
  var isInt16 = (type === 'int16');
  return {
    type: type,
    factor: factor,
    suffix: '_' + (isInt16 ? 'i16' : 'i32') + 'x' + factor,
    clampMin: isInt16 ? INT16_MIN : INT32_MIN,
    clampMax: isInt16 ? INT16_MAX : INT32_MAX
  };
}

function isIntegerExportStat(statName) {
  return statName === 'DOY_Max' || statName === 'DOY_Min' || statName === 'GSL';
}

function isAlwaysInt32ExportVariable(varName) {
  return varName.indexOf('LST') >= 0 ||
    varName === 'ET' ||
    varName === 'LAI' ||
    varName.indexOf('TCT') >= 0 ||
    varName.indexOf('Albedo') >= 0 ||
    varName.indexOf('WSA') >= 0 ||
    varName.indexOf('BSA') >= 0 ||
    varName === 'OTCI';   // red-edge ratio; typical max ~7 → ×10000 exceeds Int16
}

// SAR dB variables (VV, VH, VV_minus_VH): typical range -30 to +20 dB.
// Factor 100 → Int16 range covers -327 to +327 dB with 0.01 dB precision.
function isSARdBVariable(varName) {
  return varName === 'VV' || varName === 'VH' || varName === 'VV_minus_VH';
}

// IR (VV_lin/VH_lin) is unbounded in forested and open land; requires Int32.
function isSARLinearUnbounded(varName) {
  return varName === 'IR';
}

function isCatalogBoundedEVI(productKey, varName) {
  return varName === 'EVI' && productKey === 'MOD13Q1 (250m, 16-day)';
}

function isFormulaEVI(varName) {
  return varName === 'EVI';
}

function getCompactExportEncoding(productKey, varName, statName) {
  if (isIntegerExportStat(statName)) {
    return makeExportEncoding('int16', 1);
  }

  if (statName === 'Springness' || statName === 'Winterness') {
    return makeExportEncoding('int16', 10000);
  }

  if (statName === 'CV' || statName === 'CumSum') {
    return makeExportEncoding('int32', 10000);
  }

  if (isAlwaysInt32ExportVariable(varName)) {
    return makeExportEncoding('int32', 10000);
  }

  // MOD13Q1 EVI is a catalog-scaled bounded product. Formula-derived EVI
  // can have rare high outliers when denominators approach zero, so keep it
  // in Int32 for compact mode rather than clipping those values to Int16.
  if (isFormulaEVI(varName) && !isCatalogBoundedEVI(productKey, varName)) {
    return makeExportEncoding('int32', 10000);
  }

  // SAR dB variables: use factor 100 (not 10000) to stay within Int16 range.
  // Recover original dB by dividing the exported integer value by 100.
  if (isSARdBVariable(varName)) {
    return makeExportEncoding('int16', 100);
  }

  // SAR IR can be large (VV/VH > 100 over bare soil); Int32 needed.
  if (isSARLinearUnbounded(varName)) {
    return makeExportEncoding('int32', 10000);
  }

  // SAR CR, DpRVI, DpRVIc, RFDI are all bounded 0–1 → default Int16 × 10000.
  return makeExportEncoding('int16', 10000);
}

function getExportEncoding(productKey, varName, statName, exportOptions) {
  if (exportOptions.mode === 'compact') {
    return getCompactExportEncoding(productKey, varName, statName);
  }

  return {
    type: 'float32',
    factor: 1,
    suffix: '',
    clampMin: null,
    clampMax: null
  };
}

function prepareExportImage(image, exportEncoding) {
  if (exportEncoding.type === 'float32') {
    return image.toFloat();
  }

  var bandNames = image.bandNames();
  var scaled = image.toFloat().multiply(exportEncoding.factor);
  var clamped = scaled
    .max(ee.Image.constant(exportEncoding.clampMin))
    .min(ee.Image.constant(exportEncoding.clampMax));

  if (exportEncoding.type === 'int16') {
    return clamped.toInt16().rename(bandNames);
  }

  return clamped.toInt32().rename(bandNames);
}

// Create a single export task to Google Drive
function createExportTask(image, description, aoi, crs, scale, folder, maxPixels,
                          productKey, varName, statName, exportOptions) {
  var exportEncoding = getExportEncoding(productKey, varName, statName, exportOptions);
  var exportDescription = description + exportEncoding.suffix;
  Export.image.toDrive({
    image: prepareExportImage(image, exportEncoding).clip(aoi),
    description: exportDescription,
    folder: folder,
    fileNamePrefix: exportDescription,
    region: aoi,
    crs: crs,
    scale: scale,
    maxPixels: maxPixels
  });
}

// Default visualization parameters by variable/stat type
function getDefaultVisParams(varName, statName) {
  if (statName === 'DOY_Max' || statName === 'DOY_Min') {
    return {min: 1, max: 365, palette: ['blue', 'cyan', 'green', 'yellow', 'red']};
  }
  if (statName === 'Springness' || statName === 'Winterness') {
    return {min: -1, max: 1, palette: ['blue', 'white', 'red']};
  }
  if (statName === 'GSL') {
    return {min: 0, max: 46, palette: ['white', 'yellow', 'green', 'darkgreen']};
  }
  if (statName === 'CV') {
    return {min: 0, max: 2, palette: ['green', 'yellow', 'red']};
  }
  if (varName.indexOf('NDVI') >= 0 || varName.indexOf('EVI') >= 0 ||
      varName === 'SAVI' || varName === 'MSAVI') {
    return {min: -0.2, max: 0.9, palette: ['brown', 'yellow', 'green', 'darkgreen']};
  }
  if (varName === 'LST') {
    // Landsat LST is in Celsius after K→°C conversion
    return {min: -10, max: 50, palette: ['blue', 'cyan', 'yellow', 'orange', 'red']};
  }
  if (varName.indexOf('LST') >= 0) {
    // MODIS LST is in Kelvin (scale 0.02 applied)
    return {min: 270, max: 330, palette: ['blue', 'cyan', 'yellow', 'orange', 'red']};
  }
  if (varName.indexOf('Albedo') >= 0 || varName.indexOf('WSA') >= 0 ||
      varName.indexOf('BSA') >= 0) {
    return {min: 0, max: 0.5, palette: ['black', 'gray', 'white']};
  }
  if (varName === 'GPP' || varName === 'PsnNet') {
    return {min: 0, max: 0.02, palette: ['lightyellow', 'green', 'darkgreen']};
  }
  if (varName === 'ET') {
    return {min: 0, max: 150, palette: ['white', 'cyan', 'blue']};
  }
  if (varName === 'LAI') {
    return {min: 0, max: 6, palette: ['white', 'green', 'darkgreen']};
  }
  if (varName === 'FPAR') {
    return {min: 0, max: 1, palette: ['white', 'green', 'darkgreen']};
  }
  if (varName.indexOf('TCT') >= 0 || varName === 'TCT_Brightness' ||
      varName === 'TCT_Greenness' || varName === 'TCT_Wetness' ||
      varName.indexOf('brightness') >= 0 || varName.indexOf('greenness') >= 0 ||
      varName.indexOf('wetness') >= 0) {
    return {min: -0.1, max: 0.5, palette: ['brown', 'yellow', 'green']};
  }
  if (varName === 'NBR' || varName === 'NDWI') {
    return {min: -0.5, max: 0.8, palette: ['brown', 'white', 'blue']};
  }
  // SAR backscatter — values in dB
  if (varName === 'VV') {
    return {min: -20, max: 0, palette: ['black', 'gray', 'white']};
  }
  if (varName === 'VH') {
    return {min: -28, max: -5, palette: ['black', 'gray', 'white']};
  }
  if (varName === 'VV_minus_VH') {
    return {min: 3, max: 20, palette: ['blue', 'cyan', 'yellow', 'red']};
  }
  // SAR ratios — linear units
  if (varName === 'CR') {
    return {min: 0.01, max: 0.5, palette: ['darkblue', 'cyan', 'green', 'yellow']};
  }
  if (varName === 'IR') {
    return {min: 2, max: 15, palette: ['darkgreen', 'yellow', 'red']};
  }
  // SAR vegetation / structure indices (0–1)
  if (varName === 'DpRVI' || varName === 'DpRVIc') {
    return {min: 0, max: 0.7, palette: ['brown', 'yellow', 'green', 'darkgreen']};
  }
  if (varName === 'RFDI') {
    return {min: -0.3, max: 0.5, palette: ['darkgreen', 'yellow', 'red']};
  }
  return {min: 0, max: 1};
}


// ============================================================================
// SECTION 7: USER INTERFACE
// ============================================================================

// --- State ---
var variableCheckboxes = {};
var statisticCheckboxes = {};
var yearCheckboxes = {};
var currentAssetAOI = null;
var applyQAMask = true;  // Enable science-grade QA / cloud masking by default
var applyGapFill = false; // Optional temporal interpolation of masked pixels
var applySmoothing = false; // Experimental Whittaker smoother (off by default)
var applyMovingWindow = false; // Moving-window median/mean smoother (off by default)
var applyHarmonic = false;    // Harmonic (Fourier) smoother (off by default)

// --- Styles ---
var S = {
  title:    {fontWeight: 'bold', fontSize: '18px', margin: '10px 0 2px 0', color: '#2c3e50'},
  subtitle: {fontSize: '11px', color: '#7f8c8d', margin: '0 0 8px 0'},
  section:  {fontWeight: 'bold', fontSize: '13px', margin: '10px 0 4px 0', color: '#34495e'},
  category: {fontWeight: 'bold', fontSize: '11px', margin: '6px 0 2px 4px', color: '#555',
             fontStyle: 'italic'},
  sep:      {height: '1px', backgroundColor: '#bdc3c7', margin: '8px 0'},
  smallBtn: {fontSize: '11px', margin: '2px', padding: '2px 8px'},
  cb:       {fontSize: '12px', margin: '1px 0 1px 12px'}
};

// --- Title ---
var titleLabel = ui.Label('EFA Calculator', S.title);
var subtitleLabel = ui.Label(
  'Ecosystem Functional Attributes from MODIS, Landsat, Sentinel-2 & Sentinel-1 SAR', S.subtitle);

// ---- 1. AOI Section ----
var aoiHeader = ui.Label('1. Area of Interest', S.section);
var aoiMethodSelect = ui.Select({
  items: ['Draw on Map', 'GEE Asset'],
  value: 'Draw on Map',
  style: {stretch: 'horizontal', fontSize: '12px'}
});

var drawRectBtn = ui.Button({label: 'Rectangle', style: S.smallBtn});
var drawPolyBtn = ui.Button({label: 'Polygon', style: S.smallBtn});
var clearAoiBtn = ui.Button({label: 'Clear', style: S.smallBtn});
var aoiVisible = true;
var toggleAoiBtn = ui.Button({label: 'Hide AOI', style: S.smallBtn});
var aoiDrawPanel = ui.Panel({
  widgets: [drawRectBtn, drawPolyBtn, clearAoiBtn, toggleAoiBtn],
  layout: ui.Panel.Layout.flow('horizontal')
});

var assetPathInput = ui.Textbox({
  placeholder: 'users/name/asset or projects/name/assets/asset',
  style: {stretch: 'horizontal', fontSize: '11px', shown: false}
});
var loadAssetBtn = ui.Button({
  label: 'Load Asset',
  style: {fontSize: '11px', shown: false}
});
var aoiStatus = ui.Label('Draw an AOI on the map to begin.', {fontSize: '11px', color: '#7f8c8d'});

// ---- 2. Satellite Product Section ----
var productHeader  = ui.Label('2. Satellite Product', S.section);
var missionSubHeader = ui.Label('Mission', S.category);
var productSubHeader = ui.Label('Product', S.category);

// Level 2.1 — mission radio buttons
var selectedMission = null;
var missionButtons  = {};
var missionPanel = ui.Panel({
  layout: ui.Panel.Layout.flow('horizontal'),
  style:  {stretch: 'horizontal', margin: '2px 0 4px 0'}
});
var S_btnSel   = {backgroundColor: '#1a73e8', color: '#1a73e8',   fontWeight: 'bold',
                  fontSize: '11px', margin: '2px', padding: '4px 8px'};
var S_btnUnsel = {backgroundColor: '#f0f0f0', color: '#333333', fontWeight: 'normal',
                  fontSize: '11px', margin: '2px', padding: '4px 8px'};
MISSION_NAMES.forEach(function(m) {
  var btn = ui.Button({label: m, style: S_btnUnsel});
  missionButtons[m] = btn;
  missionPanel.add(btn);
});

// Level 2.2 — product dropdown (populated when a mission is selected)
var productSelect = ui.Select({
  items: [],
  placeholder: 'Select a product...',
  disabled: true,
  style: {stretch: 'horizontal', fontSize: '12px'}
});
var productInfo = ui.Label('', {fontSize: '11px', color: '#7f8c8d'});

// ---- 3. Year(s) Section ----
var yearHeader = ui.Label('3. Year(s)', S.section);
var yearCbStyle = {fontSize: '12px', margin: '1px 0 1px 0'};
var yearColStyle = {margin: '0 12px 0 4px'};
var yearCol1 = ui.Panel({layout: ui.Panel.Layout.flow('vertical'), style: yearColStyle});
var yearCol2 = ui.Panel({layout: ui.Panel.Layout.flow('vertical'), style: yearColStyle});
var yearCol3 = ui.Panel({layout: ui.Panel.Layout.flow('vertical'), style: yearColStyle});
var yearCols = [yearCol1, yearCol2, yearCol3];
var yearList = [];
for (var y = 1982; y <= 2026; y++) yearList.push(y);
var yearPerCol = Math.ceil(yearList.length / 3);
for (var yi = 0; yi < yearList.length; yi++) {
  var ycb = ui.Checkbox({label: String(yearList[yi]), value: false, style: yearCbStyle});
  yearCheckboxes[String(yearList[yi])] = ycb;
  yearCols[Math.floor(yi / yearPerCol)].add(ycb);
}
var yearPanel = ui.Panel({
  widgets: [yearCol1, yearCol2, yearCol3],
  layout: ui.Panel.Layout.flow('horizontal'),
  style: {margin: '0 0 0 0'}
});

var yearButtonsMain = ui.Panel({
  widgets: [

    ui.Button({label: 'Select All', style: S.smallBtn, onClick: function() {
      var keys = Object.keys(yearCheckboxes);
      for (var i = 0; i < keys.length; i++) yearCheckboxes[keys[i]].setValue(true);
    }}),

    ui.Button({label: 'Clear All', style: S.smallBtn, onClick: function() {
      var keys = Object.keys(yearCheckboxes);
      for (var i = 0; i < keys.length; i++) yearCheckboxes[keys[i]].setValue(false);
    }})
  ],
  layout: ui.Panel.Layout.flow('horizontal')
});

// Populated dynamically by rebuildSatRangeButtons() when a product is selected
var satRangesLabel = ui.Label('Select range for this product',
  {fontSize: '11px', color: '#7f8c8d', shown: false});
var yearButtonsSatRanges = ui.Panel({
  layout: ui.Panel.Layout.flow('vertical'),
  style: {shown: false}
});

// ---- 4. Variables Section ----
var varsHeader = ui.Label('4. Variables / Dimensions', S.section);
var varsPanel = ui.Panel({style: {margin: '0 0 0 4px'}});
var varsButtons = ui.Panel({
  widgets: [
    ui.Button({label: 'Select All', style: S.smallBtn, onClick: function() {
      var keys = Object.keys(variableCheckboxes);
      for (var i = 0; i < keys.length; i++) variableCheckboxes[keys[i]].setValue(true);
    }}),
    ui.Button({label: 'Clear All', style: S.smallBtn, onClick: function() {
      var keys = Object.keys(variableCheckboxes);
      for (var i = 0; i < keys.length; i++) variableCheckboxes[keys[i]].setValue(false);
    }})
  ],
  layout: ui.Panel.Layout.flow('horizontal')
});

// ---- 5. Statistics Section ----
var statsHeader = ui.Label('5. Annual Statistics', S.section);
var statsPanel = ui.Panel({style: {margin: '0 0 0 4px'}});

// Build static stat checkboxes grouped by category
var statCatNames = Object.keys(STAT_CATEGORIES);
for (var c = 0; c < statCatNames.length; c++) {
  var catName = statCatNames[c];
  statsPanel.add(ui.Label(catName, S.category));
  var statList = STAT_CATEGORIES[catName];
  for (var si = 0; si < statList.length; si++) {
    var scb = ui.Checkbox({label: statList[si], value: false, style: S.cb});
    statsPanel.add(scb);
    statisticCheckboxes[statList[si]] = scb;
  }
}

var statsButtons = ui.Panel({
  widgets: [
    ui.Button({label: 'Select All', style: S.smallBtn, onClick: function() {
      var keys = Object.keys(statisticCheckboxes);
      for (var i = 0; i < keys.length; i++) statisticCheckboxes[keys[i]].setValue(true);
    }}),
    ui.Button({label: 'Clear All', style: S.smallBtn, onClick: function() {
      var keys = Object.keys(statisticCheckboxes);
      for (var i = 0; i < keys.length; i++) statisticCheckboxes[keys[i]].setValue(false);
    }})
  ],
  layout: ui.Panel.Layout.flow('horizontal')
});

// ---- 6. Pre-processing Options Section ----
var preprocHeader = ui.Label('6. Pre-processing Options', S.section);

// ---- 7. Export Settings Section ----
var exportHeader = ui.Label('7. Export Settings', S.section);

function makeRow(labelText, widget) {
  return ui.Panel({
    widgets: [
      ui.Label(labelText, {fontSize: '12px', width: '90px'}),
      widget
    ],
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {margin: '1px 0'}
  });
}

var crsInput    = ui.Textbox({value: 'EPSG:4326', style: {fontSize: '12px', stretch: 'horizontal'}});
var scaleInput  = ui.Textbox({value: '500',        style: {fontSize: '12px', stretch: 'horizontal'}});
var folderInput = ui.Textbox({value: 'GEE_EFA',    style: {fontSize: '12px', stretch: 'horizontal'}});
var maxPixInput = ui.Textbox({value: '1e9',         style: {fontSize: '12px', stretch: 'horizontal'}});
var exportEncodingSelect = ui.Select({
  items: [EXPORT_ENCODING_FLOAT, EXPORT_ENCODING_COMPACT],
  value: EXPORT_ENCODING_FLOAT,
  style: {stretch: 'horizontal', fontSize: '12px'}
});

var exportPanel = ui.Panel([
  makeRow('CRS:', crsInput),
  makeRow('Scale (m):', scaleInput),
  makeRow('Drive folder:', folderInput),
  makeRow('Max pixels:', maxPixInput),
  makeRow('Encoding:', exportEncodingSelect)
]);

// ---- QA / Cloud Masking Toggle ----
var qaMaskCheckbox = ui.Checkbox({
  label: 'Apply QA / Cloud Mask',
  value: true,
  style: {fontSize: '12px', margin: '6px 0 0 0'}
});
var qaMaskInfo = ui.Label(
  'For MODIS: removes clouds, cloud shadows, cirrus, and low-quality ' +
  'observations using each product\'s QA/QC band(s).\n' +
  'For Landsat Harmonized: fmask (cloud + cloud shadow) is always applied.\n' +
  'For Sentinel-2 SR: SCL cloud/shadow masking is always applied inside the pipeline.\n' +
  'For Sentinel-1 SAR: not applicable — SAR is cloud-penetrating. ' +
  'QA mask and gap fill are automatically disabled for SAR products.',
  {fontSize: '10px', color: '#7f8c8d', margin: '1px 0 4px 12px', whiteSpace: 'pre-wrap', shown: true}
);

// ---- Temporal Gap-Filling Toggle ----
var gapFillCheckbox = ui.Checkbox({
  label: 'Apply Temporal Gap Fill',
  value: false,
  style: {fontSize: '12px', margin: '6px 0 0 0'}
});
var gapFillMethodSelect = ui.Select({
  items: ['Median', 'Mean'],
  value: 'Median',
  style: {stretch: 'horizontal', fontSize: '12px'}
});
var gapFillWindowInput = ui.Textbox({
  value: '5',
  placeholder: 'Odd integer >= 3',
  style: {stretch: 'horizontal', fontSize: '12px'}
});
var gapFillControls = ui.Panel({
  widgets: [
    makeRow('Method:', gapFillMethodSelect),
    makeRow('Window:', gapFillWindowInput)
  ],
  style: {shown: false, margin: '2px 0 0 12px'}
});
var gapFillInfo = ui.Label(
  'Fills only masked pixels using a centered image-count window. ' +
  'For example, window 5 uses two observations before and two after the focal date; ' +
  'the real time span depends on product frequency.',
  {fontSize: '10px', color: '#7f8c8d', margin: '1px 0 4px 12px',
   whiteSpace: 'pre-wrap', shown: false}
);

// ---- Whittaker Smoother Toggle [experimental] ----
var smoothCheckbox = ui.Checkbox({
  label: 'Apply Whittaker Smoother [experimental]',
  value: false,
  style: {fontSize: '12px', margin: '6px 0 0 0'}
});
var smoothLambdaInput = ui.Textbox({
  value: '10',
  placeholder: 'Positive number (e.g. 10)',
  style: {stretch: 'horizontal', fontSize: '12px'}
});
var smoothControls = ui.Panel({
  widgets: [
    makeRow('Lambda (smoothing):', smoothLambdaInput)
  ],
  style: {shown: false, margin: '2px 0 0 12px'}
});
var smoothInfo = ui.Label(
  'WARNING: Experimental and processing-intensive. May cause errors on large ' +
  'collections or complex geometries (GEE memory limits).\n' +
  'Applies a penalized least squares fit (3rd-order differences) to the time series. ' +
  'Higher lambda = smoother curve. Guidance: 1-5 light, 10 moderate, 50-100 heavy.\n' +
  'Recommendation: enable gap fill first to avoid smoothing over masked pixels ' +
  '(remaining masked values are set to 0 before smoothing).',
  {fontSize: '10px', color: '#b35900', margin: '1px 0 4px 12px',
   whiteSpace: 'pre-wrap', shown: false}
);

// ---- Moving-Window Smoother Toggle [experimental] ----
var mwCheckbox = ui.Checkbox({
  label: 'Apply Moving-Window Smoother [experimental]',
  value: false,
  style: {fontSize: '12px', margin: '6px 0 0 0'}
});
var mwMethodSelect = ui.Select({
  items: ['Median', 'Mean'],
  value: 'Median',
  style: {stretch: 'horizontal', fontSize: '12px'}
});
var mwWindowInput = ui.Textbox({
  value: '5',
  placeholder: 'Odd integer >= 3 (e.g. 5)',
  style: {stretch: 'horizontal', fontSize: '12px'}
});
var mwControls = ui.Panel({
  widgets: [
    makeRow('Method:', mwMethodSelect),
    makeRow('Window size (images):', mwWindowInput)
  ],
  style: {shown: false, margin: '2px 0 0 12px'}
});
var mwInfo = ui.Label(
  'WARNING: Experimental feature. Replaces each pixel value with the median/mean ' +
  'of its temporal neighbours within a centered sliding window.\n' +
  'Window size = number of images (must be odd). Larger window = smoother curve ' +
  'but more temporal detail lost. Guidance: 3-5 light, 7-9 moderate, 11+ heavy.\n' +
  'Recommendation: enable gap fill first to minimize the effect of masked pixels ' +
  '(remaining masked values are set to 0 during smoothing, original mask is preserved).',
  {fontSize: '10px', color: '#b35900', margin: '1px 0 4px 12px',
   whiteSpace: 'pre-wrap', shown: false}
);

// ---- Harmonic Smoother ----
var harmonicCheckbox = ui.Checkbox({
  label: 'Apply Harmonic Smoother [experimental]',
  value: false,
  style: {fontSize: '12px', margin: '6px 0 0 0'}
});
var harmonicNumInput = ui.Textbox({
  value: '2',
  placeholder: '1, 2 or 3',
  style: {stretch: 'horizontal', fontSize: '12px'}
});
var harmonicControls = ui.Panel({
  widgets: [makeRow('Harmonics (1\u20133):', harmonicNumInput)],
  style: {shown: false, margin: '2px 0 0 12px'}
});
var harmonicInfo = ui.Label(
  'WARNING: Experimental and compute-intensive. Fits a Fourier model ' +
  '(intercept + N annual harmonic pairs) to each pixel\'s time series using ' +
  'ordinary least squares, then replaces each observation with the modelled ' +
  'value at that timestamp.\n' +
  'Harmonics: 1 = annual cycle only (3 params); 2 = + semi-annual (5 params); ' +
  '3 = + tertiary (7 params).\n' +
  'Recommendation: use \u2265 6-month buffer (default) for better edge estimation. ' +
  'Enable gap fill first if cloud cover is heavy.',
  {fontSize: '10px', color: '#b35900', margin: '1px 0 4px 12px',
   whiteSpace: 'pre-wrap', shown: false}
);

// ---- Smoothing Edge Buffer (shared by Whittaker, Moving-Window, and Harmonic) ----
var smoothBufferInput = ui.Textbox({
  value: '3',
  placeholder: 'Integer >= 0 (default 3)',
  style: {stretch: 'horizontal', fontSize: '12px'}
});
var smoothBufferPanel = ui.Panel({
  widgets: [makeRow('Buffer months:', smoothBufferInput)],
  style: {shown: false, margin: '2px 0 0 12px'}
});
var smoothBufferInfo = ui.Label(
  'Extends the loaded series by N months before Jan 1 and after Dec 31 before smoothing, ' +
  'then removes the buffer so EFA statistics are based on the actual year only. ' +
  'Reduces edge distortion at the start/end of the series. Set to 0 to disable.',
  {fontSize: '10px', color: '#7f8c8d', margin: '1px 0 4px 12px',
   whiteSpace: 'pre-wrap', shown: false}
);

// ---- Calculate Button ----
var calcButton = ui.Button({
  label: 'CALCULATE & EXPORT',
  style: {stretch: 'horizontal', fontSize: '14px', fontWeight: 'bold',
          color: '#000000', backgroundColor: '#FFF'}
});
var statusLabel = ui.Label('', {fontSize: '12px', color: '#333', whiteSpace: 'pre-wrap'});

// ---- Info Panel ----
var infoToggle = ui.Button({
  label: 'About EFA methodology...',
  style: {fontSize: '11px', stretch: 'horizontal', margin: '8px 0 0 0'}
});
var infoContent = ui.Label(
  'Ecosystem Functional Attributes (EFAs) characterize ecosystem functioning:\n\n' +
  '  MAGNITUDE - Annual mean/median as productivity proxy.\n' +
  '  SEASONALITY - CV, StdDev, IQR quantify seasonal variation.\n' +
  '  PHENOLOGY - DOY of peak/trough. Springness & Winterness are\n' +
  '    circular statistics: sin(2pi*DOY/365) and cos(2pi*DOY/365)\n' +
  '    that linearize the cyclical day-of-year variable.\n\n' +
  'Statistics:\n' +
  '  Centrality: Mean, Median, P05 - 5% percentile, P95 - 95% percentile, Min, Max\n' +
  '  Dispersion: StdDev, IQR(P95-P05) - interquantile range, MAD - Median Absolute Deviation,\n' +  
  ' CV(StdDev/Mean) - Coefficient of Variation\n' +
  '  Phenology: DOY_Max, DOY_Min, Springness, Winterness, GSL\n' +
  '  Integration: CumSum (annual sum), Amplitude (Max-Min)\n\n' +
  'Time-series smoothing (applied before annual aggregation):\n' +
  '  Gap fill - fills masked pixels from a centered image-count window.\n' +
  '  Whittaker - penalized least-squares with 3rd-order differences.\n' +
  '    Lambda controls smoothness (1-5 light, 10 moderate, 50-100 heavy).\n' +
  '  Moving-window - replaces each image with the median/mean of its\n' +
  '    temporal neighbours within a sliding window (size in images).\n' +
  '  Harmonic - fits a Fourier model (intercept + N harmonic pairs) via\n' +
  '    OLS and replaces each observation with the modelled value.\n' +
  '    1 harmonic = annual cycle; 2 = + semi-annual; 3 = + tertiary.\n' +
  '  Buffer months - all smoothers can load N extra months before Jan 1\n' +
  '    and after Dec 31 to reduce edge effects; the buffer is stripped\n' +
  '    before annual statistics are computed (default 3 months, 6 for\n' +
  '    harmonic). Suffix in export name: _GF*, _WS*, _MW*, _HS*, _B*.\n\n' +
  'Landsat Harmonized product:\n' +
  '  LT5 (1984–2013) + LT7 (1999–) + LT8 (2013–), C02 T1 L2.\n' +
  '  Reflectance indices (NDVI, EVI, SAVI, NBR, NDWI) use ETM+/TM→OLI\n' +
  '  cross-calibration (Roy et al. 2016). TCT uses mission-specific\n' +
  '  coefficients: LT5 Crist (1985), LT7 Huang et al. (2002),\n' +
  '  LT8 Baig et al. (2014). LST in Celsius from C02 ST_B bands.\n\n' +
  'References: Alcaraz-Segura et al. (2006), Paruelo et al. (2001),\n' +
  'Schaaf et al. (2002), Lobser & Cohen (2007), Roy et al. (2016)',
  {fontSize: '10px', color: '#555', shown: false, whiteSpace: 'pre-wrap'}
);

var infoShown = false;
infoToggle.onClick(function() {
  infoShown = !infoShown;
  infoContent.style().set('shown', infoShown);
});


// ============================================================================
// SECTION 8: ASSEMBLE MAIN PANEL
// ============================================================================

var mainPanel = ui.Panel({
  widgets: [
    titleLabel, subtitleLabel,
    ui.Panel({style: S.sep}),
    aoiHeader, aoiMethodSelect, aoiDrawPanel, assetPathInput, loadAssetBtn, aoiStatus,
    ui.Panel({style: S.sep}),
    productHeader, missionSubHeader, missionPanel, productSubHeader, productSelect, productInfo,
    yearHeader, yearPanel, yearButtonsMain, satRangesLabel, yearButtonsSatRanges, 
    ui.Panel({style: S.sep}),
    varsHeader, varsPanel, varsButtons,
    statsHeader, statsPanel, statsButtons,
    ui.Panel({style: S.sep}),
    preprocHeader,
    qaMaskCheckbox, qaMaskInfo,
    gapFillCheckbox, gapFillControls, gapFillInfo,
    smoothCheckbox, smoothControls, smoothInfo,
    mwCheckbox, mwControls, mwInfo,
    harmonicCheckbox, harmonicControls, harmonicInfo,
    smoothBufferPanel, smoothBufferInfo,
    ui.Panel({style: S.sep}),
    exportHeader, exportPanel,
    calcButton, statusLabel,
    infoToggle, infoContent
  ],
  style: {width: '385px', padding: '8px'}
});

ui.root.insert(0, mainPanel);


// ============================================================================
// SECTION 9: EVENT HANDLERS
// ============================================================================

// --- Drawing Tools ---
var drawingTools = Map.drawingTools();
drawingTools.setShown(false);

// Clear default layers
while (drawingTools.layers().length() > 0) {
  drawingTools.layers().remove(drawingTools.layers().get(0));
}

var aoiLayer = ui.Map.GeometryLayer({geometries: [], name: 'AOI', color: 'FF0000'});
drawingTools.layers().add(aoiLayer);

function clearAllGeometries() {
  aoiLayer.geometries().reset([]);
}

drawingTools.onDraw(function() {
  aoiStatus.setValue('AOI defined. Ready for calculation.');
  aoiStatus.style().set('color', '#27ae60');
});

drawingTools.onEdit(function() {
  aoiStatus.setValue('AOI edited.');
});

drawRectBtn.onClick(function() {
  clearAllGeometries();
  drawingTools.setShape('rectangle');
  drawingTools.draw();
});

drawPolyBtn.onClick(function() {
  clearAllGeometries();
  drawingTools.setShape('polygon');
  drawingTools.draw();
});

clearAoiBtn.onClick(function() {
  clearAllGeometries();
  currentAssetAOI = null;
  aoiStatus.setValue('AOI cleared.');
  aoiStatus.style().set('color', '#7f8c8d');
});

toggleAoiBtn.onClick(function() {
  aoiVisible = !aoiVisible;
  aoiLayer.setShown(aoiVisible);
  toggleAoiBtn.setLabel(aoiVisible ? 'Hide AOI' : 'Show AOI');
});

// --- QA Mask Toggle ---
qaMaskCheckbox.onChange(function(checked) {
  applyQAMask = checked;
  qaMaskInfo.style().set('shown', checked);
});

// --- Temporal Gap Fill Toggle ---
gapFillCheckbox.onChange(function(checked) {
  applyGapFill = checked;
  gapFillControls.style().set('shown', checked);
  gapFillInfo.style().set('shown', checked);
});

// --- Whittaker Smoother Toggle (mutually exclusive with moving-window and harmonic) ---
smoothCheckbox.onChange(function(checked) {
  applySmoothing = checked;
  smoothControls.style().set('shown', checked);
  smoothInfo.style().set('shown', checked);
  smoothBufferPanel.style().set('shown', checked);
  smoothBufferInfo.style().set('shown', checked);
  if (checked) {
    mwCheckbox.setValue(false);
    applyMovingWindow = false;
    mwControls.style().set('shown', false);
    mwInfo.style().set('shown', false);
    harmonicCheckbox.setValue(false);
    applyHarmonic = false;
    harmonicControls.style().set('shown', false);
    harmonicInfo.style().set('shown', false);
  }
});

// --- Moving-Window Smoother Toggle (mutually exclusive with Whittaker and harmonic) ---
mwCheckbox.onChange(function(checked) {
  applyMovingWindow = checked;
  mwControls.style().set('shown', checked);
  mwInfo.style().set('shown', checked);
  smoothBufferPanel.style().set('shown', checked);
  smoothBufferInfo.style().set('shown', checked);
  if (checked) {
    smoothCheckbox.setValue(false);
    applySmoothing = false;
    smoothControls.style().set('shown', false);
    smoothInfo.style().set('shown', false);
    harmonicCheckbox.setValue(false);
    applyHarmonic = false;
    harmonicControls.style().set('shown', false);
    harmonicInfo.style().set('shown', false);
  }
});

// --- Harmonic Smoother Toggle (mutually exclusive with Whittaker and moving-window) ---
harmonicCheckbox.onChange(function(checked) {
  applyHarmonic = checked;
  harmonicControls.style().set('shown', checked);
  harmonicInfo.style().set('shown', checked);
  smoothBufferPanel.style().set('shown', checked);
  smoothBufferInfo.style().set('shown', checked);
  if (checked) {
    smoothCheckbox.setValue(false);
    applySmoothing = false;
    smoothControls.style().set('shown', false);
    smoothInfo.style().set('shown', false);
    mwCheckbox.setValue(false);
    applyMovingWindow = false;
    mwControls.style().set('shown', false);
    mwInfo.style().set('shown', false);
    // Harmonic benefits from a longer edge buffer for better parameter estimation
    smoothBufferInput.setValue('6');
  }
});

// --- AOI Method Toggle ---
aoiMethodSelect.onChange(function(method) {
  var isDraw = (method === 'Draw on Map');
  aoiDrawPanel.style().set('shown', isDraw);
  assetPathInput.style().set('shown', !isDraw);
  loadAssetBtn.style().set('shown', !isDraw);
  aoiStatus.setValue(isDraw
    ? 'Draw an AOI on the map.'
    : 'Enter a GEE asset path and click Load.');
  aoiStatus.style().set('color', '#7f8c8d');
});

// --- Load Asset ---
loadAssetBtn.onClick(function() {
  var path = assetPathInput.getValue().trim();
  if (!path) {
    aoiStatus.setValue('Enter an asset path.');
    aoiStatus.style().set('color', 'red');
    return;
  }
  aoiStatus.setValue('Loading asset...');
  aoiStatus.style().set('color', '#7f8c8d');
  var fc = ee.FeatureCollection(path);
  currentAssetAOI = fc.geometry();
  Map.addLayer(fc.style({color: 'red', fillColor: '00000022', width: 2}), {}, 'Asset AOI');
  Map.centerObject(fc);
  aoiStatus.setValue('Asset loaded: ' + path);
  aoiStatus.style().set('color', '#27ae60');
});

// --- Get AOI ---
function getAOI() {
  if (aoiMethodSelect.getValue() === 'GEE Asset') {
    if (currentAssetAOI) return currentAssetAOI;
    var path = assetPathInput.getValue().trim();
    if (!path) return null;
    currentAssetAOI = ee.FeatureCollection(path).geometry();
    return currentAssetAOI;
  }
  // Drawing tools - get drawn geometries directly
  var geomList = aoiLayer.geometries();
  if (geomList.length() === 0) return null;
  // If single geometry, use it; if multiple, combine
  if (geomList.length() === 1) {
    return geomList.get(0);
  }
  var features = [];
  for (var i = 0; i < geomList.length(); i++) {
    features.push(ee.Feature(geomList.get(i)));
  }
  return ee.FeatureCollection(features).geometry();
}

// --- Satellite Range Buttons ---
// Rebuilds yearButtonsSatRanges for the currently selected product.
// Each range entry selects years >= start and (if end is defined) <= end.
function rebuildSatRangeButtons(productKey) {
  yearButtonsSatRanges.widgets().reset([]);
  var ranges = productKey && PRODUCT_YEAR_RANGES[productKey];
  var hasRanges = ranges && ranges.length > 0;
  satRangesLabel.style().set('shown', hasRanges);
  yearButtonsSatRanges.style().set('shown', hasRanges);
  if (!hasRanges) return;

  for (var ri = 0; ri < ranges.length; ri++) {
    (function(range) {
      yearButtonsSatRanges.add(ui.Button({
        label: range.label,
        style: S.smallBtn,
        onClick: function() {
          var keys = Object.keys(yearCheckboxes);
          for (var i = 0; i < keys.length; i++) {
            var yr = parseInt(keys[i]);
            var inRange = yr >= range.start && (range.end === undefined || yr <= range.end);
            yearCheckboxes[keys[i]].setValue(inRange);
          }
        }
      }));
    })(ranges[ri]);
  }
}

// --- Mission Selection ---
function selectMission(missionName) {
  selectedMission = missionName;

  // Update button visual states
  MISSION_NAMES.forEach(function(m) {
    missionButtons[m].style().set(m === missionName ? S_btnSel : S_btnUnsel);
  });

  // Populate the product dropdown with products for this mission
  var products = MISSION_GROUPS[missionName];
  productSelect.setDisabled(false);
  productSelect.items().reset(products);

  // Auto-select if only one product (Landsat, Sentinel-1, Sentinel-2)
  if (products.length === 1) {
    productSelect.setValue(products[0], true);  // fires onChange
  } else {
    productSelect.setValue(null);               // reset to placeholder
    varsPanel.widgets().reset([]);
    variableCheckboxes = {};
    productInfo.setValue('');
    rebuildSatRangeButtons(null);              // hide range buttons until a product is picked
  }
}

MISSION_NAMES.forEach(function(m) {
  missionButtons[m].onClick(function() { selectMission(m); });
});

// --- Product Change ---
productSelect.onChange(function(productKey) {
  varsPanel.widgets().reset([]);
  variableCheckboxes = {};

  if (!productKey || !PRODUCTS[productKey]) return;

  var product = PRODUCTS[productKey];
  var varNames = Object.keys(product.variables);

  for (var i = 0; i < varNames.length; i++) {
    var vcb = ui.Checkbox({label: varNames[i], value: false, style: S.cb});
    varsPanel.add(vcb);
    variableCheckboxes[varNames[i]] = vcb;
  }

  scaleInput.setValue(String(product.resolution));

  // Check if any QA masking is available (product-level or variable-level)
  var hasQA = !!product.qaMask;
  if (!hasQA) {
    var vKeys = Object.keys(product.variables);
    for (var q = 0; q < vKeys.length; q++) {
      if (product.variables[vKeys[q]].qaMask) { hasQA = true; break; }
    }
  }

  var isSAR = (product.type === 'sentinel1');

  var infoText;
  if (product.type === 'landsat') {
    infoText = product.resolution + 'm | ' + product.temporal + ' | ' + varNames.length +
      ' variable(s) | fmask cloud masking always applied\n' +
      '  LT5: 1984–2012 · LT7: 1999–2023 · LT8: 2013–present\n' +
      '  TCT uses mission-specific coefficients; reflectance indices harmonized to OLI.';
  } else if (product.type === 'landsat_single') {
    var ltInfoCfg = LANDSAT_SINGLE_CONFIG[product.mission];
    infoText = product.resolution + 'm | ' + product.temporal + ' | ' + varNames.length +
      ' variable(s) | fmask cloud masking always applied\n' +
      '  ' + ltInfoCfg.label + '\n' +
      '  ' + ltInfoCfg.tctNote + '\n' +
      '  Spectral indices on native reflectance (no cross-sensor harmonization).';
  } else if (product.type === 'sentinel2') {
    infoText = '10/20m | ' + product.temporal + ' | ' + varNames.length +
      ' variable(s) | SCL cloud masking always applied\n' +
      '  S2A/B: 2017–present\n' +
      '  10 m: NDVI, EVI, SAVI  ·  20 m: NDWI, NBR, TCT\n' +
      '  TCT: Shi & Xu (2019), 6-band PCP, aligned to Landsat 8 TCT space.';
  } else if (product.type === 'sentinel3') {
    infoText = '300m | ' + product.temporal + ' | ' + varNames.length +
      ' variable(s) | QA masking always applied (invalid + saturated pixels)\n' +
      '  S3A: 2016-10-18+  ·  S3B: 2018-04-26+  ·  ~1–2 day revisit\n' +
      '  NDVI (Oa08/Oa17)  ·  OTCI: red-edge chlorophyll index (Oa08/Oa10/Oa11)  ·  NDWI (Oa06/Oa17)\n' +
      '  No TCT: no published OLCI TCT coefficients. TOA radiances scaled per-band before index computation.';
  } else if (product.type === 'sentinel1') {
    infoText = '10m | ~12-day | ' + varNames.length + ' variable(s) | SAR — cloud-penetrating\n' +
      '  S1A: 2014-10-03+  ·  S1B: 2016–2021  ·  S1C: 2023-present\n' +
      '  IW mode, VV+VH dual-pol  ·  Select years 2015 or later for full-year coverage\n' +
      '  dB: VV, VH, VV−VH  ·  linear ratio: CR, IR  ·  0–1: DpRVI, DpRVIc, RFDI';
  } else {
    infoText = product.resolution + 'm | ' + product.temporal +
      ' | ' + varNames.length + ' variable(s)' +
      ' | QA mask: ' + (hasQA ? 'available' : 'n/a');
    if (product.temporal === 'Daily') {
      infoText += '\n  Note: Daily product - computation may be slower.';
    }
  }
  productInfo.setValue(infoText);

  // For SAR: disable QA masking and gap fill (not applicable for radar data).
  // Re-enable both controls when switching to any non-SAR product.
  qaMaskCheckbox.setDisabled(isSAR);
  gapFillCheckbox.setDisabled(isSAR);
  smoothCheckbox.setDisabled(isSAR);
  mwCheckbox.setDisabled(isSAR);
  harmonicCheckbox.setDisabled(isSAR);
  if (isSAR) {
    qaMaskCheckbox.setValue(false);
    applyQAMask = false;
    gapFillCheckbox.setValue(false);
    applyGapFill = false;
    gapFillControls.style().set('shown', false);
    gapFillInfo.style().set('shown', false);
    smoothCheckbox.setValue(false);
    applySmoothing = false;
    smoothControls.style().set('shown', false);
    smoothInfo.style().set('shown', false);
    mwCheckbox.setValue(false);
    applyMovingWindow = false;
    mwControls.style().set('shown', false);
    mwInfo.style().set('shown', false);
    harmonicCheckbox.setValue(false);
    applyHarmonic = false;
    harmonicControls.style().set('shown', false);
    harmonicInfo.style().set('shown', false);
    smoothBufferPanel.style().set('shown', false);
    smoothBufferInfo.style().set('shown', false);
  }

  rebuildSatRangeButtons(productKey);
});

// --- Gather Selections ---
function getSelectedVariables() {
  var sel = [];
  var keys = Object.keys(variableCheckboxes);
  for (var i = 0; i < keys.length; i++) {
    if (variableCheckboxes[keys[i]].getValue()) sel.push(keys[i]);
  }
  return sel;
}

function getSelectedStatistics() {
  var sel = [];
  var keys = Object.keys(statisticCheckboxes);
  for (var i = 0; i < keys.length; i++) {
    if (statisticCheckboxes[keys[i]].getValue()) sel.push(keys[i]);
  }
  return sel;
}

function getSelectedYears() {
  var sel = [];
  for (var y = 1982; y <= 2026; y++) {
    if (yearCheckboxes[String(y)].getValue()) sel.push(y);
  }
  return sel;
}

function getGapFillOptions() {
  applyGapFill = gapFillCheckbox.getValue();

  if (!applyGapFill) {
    return {enabled: false, method: 'Median', window: 5, suffix: ''};
  }

  var method = gapFillMethodSelect.getValue() || 'Median';
  if (method !== 'Median' && method !== 'Mean') {
    return {error: 'ERROR: Select a valid temporal gap-fill method.'};
  }

  var windowText = gapFillWindowInput.getValue().trim();
  if (!/^\d+$/.test(windowText)) {
    return {error: 'ERROR: Gap-fill window must be an odd integer >= 3.'};
  }

  var windowSize = parseInt(windowText, 10);
  if (windowSize < 3 || windowSize % 2 === 0) {
    return {error: 'ERROR: Gap-fill window must be an odd integer >= 3.'};
  }

  return {
    enabled: true,
    method: method,
    window: windowSize,
    suffix: '_GF' + method + 'W' + windowSize
  };
}

function getBufferMonths() {
  var isSmoothingActive = smoothCheckbox.getValue() || mwCheckbox.getValue() || harmonicCheckbox.getValue();
  if (!isSmoothingActive) return {months: 0, suffix: ''};
  var text = smoothBufferInput.getValue().trim();
  if (!/^\d+$/.test(text)) {
    return {error: 'ERROR: Smoothing buffer must be a non-negative integer (e.g. 3).'};
  }
  var n = parseInt(text, 10);
  return {months: n, suffix: n > 0 ? '_B' + n : ''};
}

function getSmoothingOptions() {
  applySmoothing = smoothCheckbox.getValue();

  if (!applySmoothing) {
    return {enabled: false, lambda: 10, bufferMonths: 0, suffix: ''};
  }

  var lambdaText = smoothLambdaInput.getValue().trim();
  if (!/^\d+(\.\d+)?$/.test(lambdaText) || parseFloat(lambdaText) <= 0) {
    return {error: 'ERROR: Smoothing lambda must be a positive number.'};
  }

  var lambda = parseFloat(lambdaText);
  var bufOpts = getBufferMonths();
  if (bufOpts.error) return {error: bufOpts.error};
  return {
    enabled: true,
    lambda: lambda,
    bufferMonths: bufOpts.months,
    suffix: '_WS' + lambda + bufOpts.suffix
  };
}

function getMovingWindowOptions() {
  applyMovingWindow = mwCheckbox.getValue();
  if (!applyMovingWindow) {
    return {enabled: false, window: 5, method: 'Median', bufferMonths: 0, suffix: ''};
  }
  var method = mwMethodSelect.getValue() || 'Median';
  var windowText = mwWindowInput.getValue().trim();
  if (!/^\d+$/.test(windowText)) {
    return {error: 'ERROR: Moving-window size must be an odd integer >= 3.'};
  }
  var windowSize = parseInt(windowText, 10);
  if (windowSize < 3 || windowSize % 2 === 0) {
    return {error: 'ERROR: Moving-window size must be an odd integer >= 3.'};
  }
  var methodCode = (method === 'Median') ? 'm' : 'M';
  var bufOpts = getBufferMonths();
  if (bufOpts.error) return {error: bufOpts.error};
  return {
    enabled: true,
    method: method,
    window: windowSize,
    bufferMonths: bufOpts.months,
    suffix: '_MW' + methodCode + windowSize + bufOpts.suffix
  };
}

function getHarmonicOptions() {
  applyHarmonic = harmonicCheckbox.getValue();
  if (!applyHarmonic) {
    return {enabled: false, numHarmonics: 2, bufferMonths: 0, suffix: ''};
  }
  var numText = harmonicNumInput.getValue().trim();
  if (!/^\d+$/.test(numText)) {
    return {error: 'ERROR: Number of harmonics must be 1, 2, or 3.'};
  }
  var numHarmonics = parseInt(numText, 10);
  if (numHarmonics < 1 || numHarmonics > 3) {
    return {error: 'ERROR: Number of harmonics must be 1, 2, or 3.'};
  }
  var bufOpts = getBufferMonths();
  if (bufOpts.error) return {error: bufOpts.error};
  return {
    enabled: true,
    numHarmonics: numHarmonics,
    bufferMonths: bufOpts.months,
    suffix: '_HS' + numHarmonics + bufOpts.suffix
  };
}

function getExportOptions() {
  var encoding = exportEncodingSelect.getValue() || EXPORT_ENCODING_FLOAT;
  return {
    mode: encoding === EXPORT_ENCODING_COMPACT ? 'compact' : 'float',
    label: encoding
  };
}

// --- Calculate Button Handler ---
calcButton.onClick(function() {
  statusLabel.style().set('color', '#333');
  statusLabel.setValue('Validating inputs...');

  // Validate product
  var productKey = productSelect.getValue();
  if (!productKey || !PRODUCTS[productKey]) {
    statusLabel.style().set('color', 'red');
    statusLabel.setValue('ERROR: Select a MODIS product.');
    return;
  }

  // Validate years
  var selectedYears = getSelectedYears();
  if (selectedYears.length === 0) {
    statusLabel.style().set('color', 'red');
    statusLabel.setValue('ERROR: Select at least one year.');
    return;
  }

  // Validate AOI
  var aoi = getAOI();
  if (!aoi) {
    statusLabel.style().set('color', 'red');
    statusLabel.setValue('ERROR: Define an area of interest first.');
    return;
  }

  // Validate variables
  var selectedVars = getSelectedVariables();
  if (selectedVars.length === 0) {
    statusLabel.style().set('color', 'red');
    statusLabel.setValue('ERROR: Select at least one variable.');
    return;
  }

  // Validate statistics
  var selectedStats = getSelectedStatistics();
  if (selectedStats.length === 0) {
    statusLabel.style().set('color', 'red');
    statusLabel.setValue('ERROR: Select at least one statistic.');
    return;
  }

  // Validate temporal gap-fill settings
  var gapFillOptions = getGapFillOptions();
  if (gapFillOptions.error) {
    statusLabel.style().set('color', 'red');
    statusLabel.setValue(gapFillOptions.error);
    return;
  }

  var smoothingOptions = getSmoothingOptions();
  if (smoothingOptions.error) {
    statusLabel.style().set('color', 'red');
    statusLabel.setValue(smoothingOptions.error);
    return;
  }

  var mwOptions = getMovingWindowOptions();
  if (mwOptions.error) {
    statusLabel.style().set('color', 'red');
    statusLabel.setValue(mwOptions.error);
    return;
  }

  var harmonicOptions = getHarmonicOptions();
  if (harmonicOptions.error) {
    statusLabel.style().set('color', 'red');
    statusLabel.setValue(harmonicOptions.error);
    return;
  }

  // Parse export settings
  var crs = crsInput.getValue().trim() || 'EPSG:4326';
  var scale = parseInt(scaleInput.getValue(), 10) || PRODUCTS[productKey].resolution;
  var folder = folderInput.getValue().trim() || 'GEE_EFA';
  var maxPx = parseFloat(maxPixInput.getValue()) || 1e9;
  var exportOptions = getExportOptions();

  // Task count
  var taskCount = selectedYears.length * selectedVars.length * selectedStats.length;
  statusLabel.style().set('color', '#333');
  var yearRange = selectedYears.length === 1
    ? String(selectedYears[0])
    : selectedYears[0] + '–' + selectedYears[selectedYears.length - 1] +
      ' (' + selectedYears.length + ' years)';
  var prepMsg = 'Preparing ' + taskCount + ' export task(s) for ' + yearRange + '...';
  if (gapFillOptions.enabled) {
    prepMsg += '\nTemporal gap fill: ' + gapFillOptions.method +
      ', window ' + gapFillOptions.window;
  }
  if (smoothingOptions.enabled) {
    prepMsg += '\nWhittaker smoother: lambda ' + smoothingOptions.lambda;
  }
  if (mwOptions.enabled) {
    prepMsg += '\nMoving-window smoother: ' + mwOptions.method + ', window ' + mwOptions.window;
  }
  if (harmonicOptions.enabled) {
    prepMsg += '\nHarmonic smoother: ' + harmonicOptions.numHarmonics + ' harmonic(s)';
  }
  if (exportOptions.mode === 'compact') {
    prepMsg += '\nCompact integer export enabled. Filenames include integer type and divisor.';
  }
  if (taskCount > 50) {
    prepMsg += '\n(NOTE: High task count - consider reducing selections)';
  }
  statusLabel.setValue(prepMsg);

  // Check if DOY_Max is needed for Springness/Winterness dependency
  var needsDoyMax = (selectedStats.indexOf('Springness') >= 0 ||
                     selectedStats.indexOf('Winterness') >= 0 ||
                     selectedStats.indexOf('DOY_Max') >= 0);

  // Short product name for export descriptions
  var productShort = productKey.split(' ')[0];

  var firstImage = null;
  var firstVarName = '';
  var firstStatName = '';
  var firstYear = selectedYears[0];
  var exportCount = 0;

  // Process each year x variable x statistic combination
  for (var yr = 0; yr < selectedYears.length; yr++) {
    var year = selectedYears[yr];

    for (var v = 0; v < selectedVars.length; v++) {
      var varName = selectedVars[v];
      var imgCol = loadAndProcessCollection(productKey, varName, year, aoi, gapFillOptions, smoothingOptions, mwOptions, harmonicOptions);

      // Per-variable resolution override (e.g. Sentinel-2: 10m for NDVI/EVI/SAVI, 20m for rest)
      var varCfg = PRODUCTS[productKey].variables[varName];
      var effectiveScale = (varCfg && varCfg.resolution !== undefined)
        ? varCfg.resolution
        : scale;

      // Pre-compute DOY_Max if needed (cached per variable × year)
      var doyMaxImage = null;
      if (needsDoyMax) {
        doyMaxImage = viTSdateOfMax(imgCol);
      }

      for (var s = 0; s < selectedStats.length; s++) {
        var statName = selectedStats[s];
        var result = computeStatistic(imgCol, statName, doyMaxImage);

        if (result) {
          var desc = productShort + '_' + varName + '_' + statName + '_' + year +
            gapFillOptions.suffix + smoothingOptions.suffix + mwOptions.suffix + harmonicOptions.suffix;
          createExportTask(result, desc, aoi, crs, effectiveScale, folder, maxPx,
            productKey, varName, statName, exportOptions);
          exportCount++;

          if (!firstImage) {
            firstImage = result;
            firstVarName = varName;
            firstStatName = statName;
            firstYear = year;
          }
        }
      }
    }
  }

  // Add preview of first result to map
  if (firstImage) {
    // Remove previous preview layers
    var layers = Map.layers();
    for (var l = layers.length() - 1; l >= 0; l--) {
      if (layers.get(l).getName().indexOf('preview') >= 0) {
        layers.remove(layers.get(l));
      }
    }
    var visParams = getDefaultVisParams(firstVarName, firstStatName);
    var previewName = firstVarName + ' ' + firstStatName + ' ' + firstYear + ' (preview)';
    Map.addLayer(firstImage.clip(aoi), visParams, previewName);
    Map.centerObject(aoi);
  }

  statusLabel.style().set('color', '#27ae60');
  var exportPattern = productShort + '_{Variable}_{Statistic}_{Year}' +
    gapFillOptions.suffix + smoothingOptions.suffix + mwOptions.suffix + harmonicOptions.suffix;
  if (exportOptions.mode === 'compact') {
    exportPattern += '_{i16x10000|i32x10000|i16x1}';
  }
  var compactMsg = exportOptions.mode === 'compact'
    ? '\nCompact integer export enabled. Divide pixel values by the x factor in the filename.'
    : '';
  statusLabel.setValue(
    'Done! Created ' + exportCount + ' export task(s) for ' + yearRange + '.\n' +
    'Go to the Tasks tab (top right) to start them.\n' +
    'Each task: ' + exportPattern +
    compactMsg
  );
});


// ============================================================================
// SECTION 10: MAP INITIALIZATION
// ============================================================================

Map.setCenter(0, 20, 3);
Map.setOptions('HYBRID');
