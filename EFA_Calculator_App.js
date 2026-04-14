/*
 * ============================================================================
 * EFA Calculator - MODIS Annual Statistics
 * ============================================================================
 *
 * Computes Ecosystem Functional Attributes (EFAs) from MODIS time series.
 * EFAs characterize ecosystem functioning through:
 *   - Magnitude: annual mean/median (productivity proxy)
 *   - Seasonality: CV, StdDev, IQR (variation intensity)
 *   - Phenology: DOY of peak activity with circular transforms
 *
 * Supports 10 MODIS products, 20+ spectral/biophysical variables,
 * and 17 annual statistics across 4 categories.
 *
 * References:
 *   Alcaraz-Segura et al. (2006) - EFA framework
 *   Paruelo et al. (2001) - Ecosystem functional types
 *   Schaaf et al. (2002) - BRDF/Albedo model
 *   Lobser & Cohen (2007) - MODIS Tasseled Cap coefficients
 *
 * Version: 1.0
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

// MOD09A1 cloud mask via StateQA bits 8-13
function maskQA_MOD09A1(image) {
  var QA = image.select('StateQA');
  var internalQuality = getQABits(QA, 8, 13, 'internal_quality_flag');
  return image.updateMask(internalQuality.eq(0));
}

// MOD09Q1 cloud mask via State bits 0-1 (00 = clear)
function maskQA_MOD09Q1(image) {
  var state = image.select('State');
  var cloudState = getQABits(state, 0, 1, 'cloud_state');
  return image.updateMask(cloudState.eq(0));
}

// MOD13Q1 mask via SummaryQA (0=good, 1=marginal, 2=snow, 3=cloudy)
function maskQA_MOD13Q1(image) {
  var qa = image.select('SummaryQA');
  return image.updateMask(qa.lte(1));
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
    qaMask: null,
    variables: {
      'LST_Day':   {band: 'LST_Day_1km',   scale: 0.02},
      'LST_Night': {band: 'LST_Night_1km',  scale: 0.02}
    }
  },

  'MOD11A2 (1km, 8-day)': {
    geeId: 'MODIS/061/MOD11A2',
    resolution: 1000,
    temporal: '8-day',
    qaMask: null,
    variables: {
      'LST_Day':   {band: 'LST_Day_1km',   scale: 0.02},
      'LST_Night': {band: 'LST_Night_1km',  scale: 0.02}
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
    qaMask: null,
    variables: {
      'GPP':    {band: 'Gpp',    scale: 0.0001},
      'PsnNet': {band: 'PsnNet', scale: 0.0001}
    }
  },

  'MCD43A1 (500m, Daily)': {
    geeId: 'MODIS/061/MCD43A1',
    resolution: 500,
    temporal: 'Daily',
    qaMask: null,
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
    qaMask: null,
    variables: {
      'ET': {band: 'ET', scale: 0.1}
    }
  },

  'MCD15A3H (500m, 4-day)': {
    geeId: 'MODIS/061/MCD15A3H',
    resolution: 500,
    temporal: '4-day',
    qaMask: null,
    variables: {
      'LAI':  {band: 'Lai',  scale: 0.1},
      'FPAR': {band: 'Fpar', scale: 0.01}
    }
  }
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

// Load, filter, mask, and process a MODIS collection for one variable and year
function loadAndProcessCollection(productKey, varName, year, aoi) {
  var product = PRODUCTS[productKey];
  var varConfig = product.variables[varName];

  var startDate = year + '-01-01';
  var endDate = (year + 1) + '-01-01';

  var col = ee.ImageCollection(product.geeId)
    .filterDate(startDate, endDate)
    .filterBounds(aoi);

  // Apply QA mask if defined
  if (product.qaMask) {
    col = col.map(product.qaMask);
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

  return col.sort('system:time_start');
}

// Create a single export task to Google Drive
function createExportTask(image, description, aoi, crs, scale, folder, maxPixels) {
  Export.image.toDrive({
    image: image.clip(aoi).toFloat(),
    description: description,
    folder: folder,
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
  if (varName.indexOf('LST') >= 0) {
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
  if (varName.indexOf('TCT') >= 0 || varName.indexOf('brightness') >= 0 ||
      varName.indexOf('greenness') >= 0 || varName.indexOf('wetness') >= 0) {
    return {min: -0.1, max: 0.5, palette: ['brown', 'yellow', 'green']};
  }
  if (varName === 'NBR' || varName === 'NDWI') {
    return {min: -0.5, max: 0.8, palette: ['brown', 'white', 'blue']};
  }
  return {min: 0, max: 1};
}


// ============================================================================
// SECTION 7: USER INTERFACE
// ============================================================================

// --- State ---
var variableCheckboxes = {};
var statisticCheckboxes = {};
var currentAssetAOI = null;

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
  'Ecosystem Functional Attributes from MODIS Annual Time Series', S.subtitle);

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

// ---- 2. Product Section ----
var productHeader = ui.Label('2. MODIS Product', S.section);
var productSelect = ui.Select({
  items: Object.keys(PRODUCTS),
  placeholder: 'Select a product...',
  style: {stretch: 'horizontal', fontSize: '12px'}
});
var productInfo = ui.Label('', {fontSize: '11px', color: '#7f8c8d'});

// ---- 3. Year Section ----
var yearHeader = ui.Label('3. Year', S.section);
var yearItems = [];
for (var y = 2001; y <= 2025; y++) { yearItems.push(String(y)); }
var yearSelect = ui.Select({
  items: yearItems,
  value: '2020',
  style: {stretch: 'horizontal', fontSize: '12px'}
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

// ---- 6. Export Settings Section ----
var exportHeader = ui.Label('6. Export Settings', S.section);

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

var exportPanel = ui.Panel([
  makeRow('CRS:', crsInput),
  makeRow('Scale (m):', scaleInput),
  makeRow('Drive folder:', folderInput),
  makeRow('Max pixels:', maxPixInput)
]);

// ---- Calculate Button ----
var calcButton = ui.Button({
  label: 'CALCULATE & EXPORT',
  style: {stretch: 'horizontal', fontSize: '14px', fontWeight: 'bold',
          color: 'white', backgroundColor: '#c0392b'}
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
  '  Centrality: Mean, Median, P05, P95, Min, Max\n' +
  '  Dispersion: StdDev, IQR(P95-P05), MAD, CV(StdDev/Mean)\n' +
  '  Phenology: DOY_Max, DOY_Min, Springness, Winterness, GSL\n' +
  '  Integration: CumSum (annual sum), Amplitude (Max-Min)\n\n' +
  'References: Alcaraz-Segura et al. (2006), Paruelo et al. (2001),\n' +
  'Schaaf et al. (2002), Lobser & Cohen (2007)',
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
    productHeader, productSelect, productInfo,
    yearHeader, yearSelect,
    ui.Panel({style: S.sep}),
    varsHeader, varsPanel, varsButtons,
    statsHeader, statsPanel, statsButtons,
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

  var infoText = product.resolution + 'm | ' + product.temporal +
    ' | ' + varNames.length + ' variable(s)';
  if (product.temporal === 'Daily') {
    infoText += '\n  Note: Daily product - computation may be slower.';
  }
  productInfo.setValue(infoText);
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

  // Validate year
  var year = parseInt(yearSelect.getValue(), 10);
  if (!year || year < 2000 || year > 2025) {
    statusLabel.style().set('color', 'red');
    statusLabel.setValue('ERROR: Select a valid year.');
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

  // Parse export settings
  var crs = crsInput.getValue().trim() || 'EPSG:4326';
  var scale = parseInt(scaleInput.getValue(), 10) || PRODUCTS[productKey].resolution;
  var folder = folderInput.getValue().trim() || 'GEE_EFA';
  var maxPx = parseFloat(maxPixInput.getValue()) || 1e9;

  // Task count
  var taskCount = selectedVars.length * selectedStats.length;
  statusLabel.style().set('color', '#333');
  var prepMsg = 'Preparing ' + taskCount + ' export task(s)...';
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
  var exportCount = 0;

  // Process each variable x statistic combination
  for (var v = 0; v < selectedVars.length; v++) {
    var varName = selectedVars[v];
    var imgCol = loadAndProcessCollection(productKey, varName, year, aoi);

    // Pre-compute DOY_Max if needed (cached per variable)
    var doyMaxImage = null;
    if (needsDoyMax) {
      doyMaxImage = viTSdateOfMax(imgCol);
    }

    for (var s = 0; s < selectedStats.length; s++) {
      var statName = selectedStats[s];
      var result = computeStatistic(imgCol, statName, doyMaxImage);

      if (result) {
        var desc = productShort + '_' + varName + '_' + statName + '_' + year;
        createExportTask(result, desc, aoi, crs, scale, folder, maxPx);
        exportCount++;

        if (!firstImage) {
          firstImage = result;
          firstVarName = varName;
          firstStatName = statName;
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
    var previewName = firstVarName + ' ' + firstStatName + ' ' + year + ' (preview)';
    Map.addLayer(firstImage.clip(aoi), visParams, previewName);
    Map.centerObject(aoi);
  }

  statusLabel.style().set('color', '#27ae60');
  statusLabel.setValue(
    'Done! Created ' + exportCount + ' export task(s).\n' +
    'Go to the Tasks tab (top right) to start them.\n' +
    'Each task: ' + productShort + '_{Variable}_{Statistic}_' + year
  );
});


// ============================================================================
// SECTION 10: MAP INITIALIZATION
// ============================================================================

Map.setCenter(0, 20, 3);
Map.setOptions('HYBRID');
