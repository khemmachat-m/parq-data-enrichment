// =============================================================================
//  enrichment.js  –  PARQ Data Enrichment  v2
//  JavaScript port of Combine_CWO_and_Master_Data_v2.py
//
//  v2 Changes vs v1:
//    – Added PPM Work Orders transaction slot + enrichment (Section 7)
//    – Added Service Category master table (optional)
//    – Added Frequency Type master table (optional)
//    – Added Status_Label derivation for PPM (StatusId → human-readable)
//    – 3 output files: CWO, Cases, PPM
// =============================================================================

// ---------------------------------------------------------------------------
//  File slot definitions  (mirrors SECTION 1 of Python script)
// ---------------------------------------------------------------------------
export const MASTER_SLOTS = [
  {
    key: 'priorities',
    label: 'Priorities',
    hint: 'MZ_PARQ_Priorities_[date].csv',
    prefix: 'MZ_PARQ_Priorities',
    role: 'master',
    optional: false,
  },
  {
    key: 'assets',
    label: 'Assets',
    hint: 'MZ_PARQ_Assets_[date].csv',
    prefix: 'MZ_PARQ_Assets',
    role: 'master',
    optional: false,
  },
  {
    key: 'locations',
    label: 'Locations',
    hint: 'MZ_PARQ_Locations_[date].csv',
    prefix: 'MZ_PARQ_Locations',
    role: 'master',
    optional: false,
  },
  {
    key: 'eventTypes',
    label: 'Event Types',
    hint: 'MZ_PARQ_Event Types_[date].csv',
    prefix: 'MZ_PARQ_Event',
    role: 'master',
    optional: false,
  },
  {
    key: 'problemTypes',
    label: 'Problem Types Template',
    hint: 'MZ_PARQ_ProblemTypesTemplate.csv',
    prefix: 'MZ_PARQ_ProblemTypes',
    role: 'master',
    optional: false,
  },
  {
    key: 'serviceCategories',
    label: 'Service Categories',
    hint: 'MZ_PARQ_ServiceCategories.csv',
    prefix: 'MZ_PARQ_ServiceCategories',
    role: 'master',
    optional: true,                           // ← graceful skip if missing
  },
  {
    key: 'frequencyTypes',
    label: 'Frequency Types',
    hint: 'MZ_PARQ_FrequencyTypes.csv',
    prefix: 'MZ_PARQ_FrequencyTypes',
    role: 'master',
    optional: true,                           // ← graceful skip if missing
  },
]

export const TXN_SLOTS = [
  {
    key: 'cwo',
    label: 'Corrective Work Orders',
    hint: 'MZ_PARQ_Corrective Work Orders_[date].csv',
    prefix: 'MZ_PARQ_Corrective',
    role: 'transaction',
  },
  {
    key: 'cases',
    label: 'Cases',
    hint: 'MZ_PARQ_Cases_[date].csv',
    prefix: 'MZ_PARQ_Cases',
    role: 'transaction',
  },
  {
    key: 'ppm',
    label: 'PPM Work Orders',
    hint: 'MZ_PARQ_PPM Work Orders_[date].csv',
    prefix: 'MZ_PARQ_PPM',
    role: 'transaction',
  },
]

export const FILE_SLOTS = [...TXN_SLOTS, ...MASTER_SLOTS]

// ---------------------------------------------------------------------------
//  PPM Status label map  (mirrors Section 7e of Python script)
//  Update values here if your Mozart system uses different StatusIds
// ---------------------------------------------------------------------------
const PPM_STATUS_MAP = {
  1: 'Scheduled',
  2: 'In Progress',
  3: 'Overdue',
  4: 'Completed',
  5: 'Cancelled',
}

// ---------------------------------------------------------------------------
//  Utilities
// ---------------------------------------------------------------------------
function normaliseColumns(rows) {
  if (!rows || !rows.length) return []
  return rows.map(row => {
    const cleaned = {}
    for (const [k, v] of Object.entries(row)) cleaned[k.trim()] = v
    return cleaned
  })
}

function toInt(val) {
  const n = parseInt(val, 10)
  return isNaN(n) ? null : n
}

function buildLookup(rows, idCol = 'Id') {
  const map = new Map()
  for (const row of rows) {
    const id = toInt(row[idCol])
    if (id !== null) map.set(id, row)
  }
  return map
}

/** Left-join: merge pickCols from lookupMap into every row of left */
function leftJoin(left, lookupMap, leftKey, pickCols, prefix) {
  return left.map(row => {
    const id     = toInt(row[leftKey])
    const master = id !== null ? lookupMap.get(id) : undefined
    const extras = {}
    for (const col of pickCols) {
      extras[`${prefix}_${col}`] = master ? (master[col] ?? '') : ''
    }
    return { ...row, ...extras }
  })
}

/** Extract English name from bilingual description (text before " - ") */
function extractEnName(desc) {
  if (!desc) return ''
  return desc.split(' - ')[0].trim()
}

// ---------------------------------------------------------------------------
//  Main enrichment function
// ---------------------------------------------------------------------------
export function enrich(datasets) {
  const log  = []
  const push = msg => { log.push(msg); console.log(msg) }

  // ── Section 3: Load & normalise master data ──────────────────────────────
  push('='.repeat(62))
  push('  Loading & Normalising Master Data')
  push('='.repeat(62))

  const priorities   = normaliseColumns(datasets.priorities   || [])
  const assets       = normaliseColumns(datasets.assets       || [])
  const locations    = normaliseColumns(datasets.locations    || [])
  const eventTypes   = normaliseColumns(datasets.eventTypes   || [])
  const problemTypes = normaliseColumns(datasets.problemTypes || [])
    .map(r => ({
      ...r,
      Name           : (r.Name                              || '').trim(),
      Priority       : (r[' Priority']        || r.Priority        || '').trim(),
      ServiceCategory: (r[' ServiceCategory'] || r.ServiceCategory || '').trim(),
      Checklist      : (r[' Checklist']       || r.Checklist       || '').trim(),
    }))

  // Optional masters (graceful empty fallback — mirrors try_load_csv in Python)
  const serviceCategories = normaliseColumns(datasets.serviceCategories || [])
  const frequencyTypes    = normaliseColumns(datasets.frequencyTypes    || [])

  push(`  Priorities       : ${priorities.length.toLocaleString()} rows`)
  push(`  Assets           : ${assets.length.toLocaleString()} rows`)
  push(`  Locations        : ${locations.length.toLocaleString()} rows`)
  push(`  Event Types      : ${eventTypes.length.toLocaleString()} rows`)
  push(`  Problem Types    : ${problemTypes.length.toLocaleString()} rows`)
  push(`  Service Categories: ${serviceCategories.length.toLocaleString()} rows${serviceCategories.length === 0 ? '  (optional – skipped)' : ''}`)
  push(`  Frequency Types  : ${frequencyTypes.length.toLocaleString()} rows${frequencyTypes.length === 0 ? '  (optional – skipped)' : ''}`)

  // Build lookup maps
  const prioMap     = buildLookup(priorities)
  const assetMap    = buildLookup(assets)
  const locationMap = buildLookup(locations)
  const eventMap    = buildLookup(eventTypes)
  const svcCatMap   = buildLookup(serviceCategories)
  const freqMap     = buildLookup(frequencyTypes)

  // Problem type name → row (name-based, no numeric Id)
  const ptNameMap = new Map()
  for (const pt of problemTypes) {
    if (pt.Name) ptNameMap.set(pt.Name.trim(), pt)
  }

  // ── Section 4: Load transaction rows ─────────────────────────────────────
  push('\n' + '='.repeat(62))
  push('  Loading Transaction Files')
  push('='.repeat(62))

  const cwoRaw   = normaliseColumns(datasets.cwo   || [])
  const casesRaw = normaliseColumns(datasets.cases || [])
  const ppmRaw   = normaliseColumns(datasets.ppm   || [])

  push(`  CWO   : ${cwoRaw.length.toLocaleString()} rows`)
  push(`  Cases : ${casesRaw.length.toLocaleString()} rows`)
  push(`  PPM   : ${ppmRaw.length.toLocaleString()} rows`)

  // ── Section 5: Enrich CWO ─────────────────────────────────────────────────
  push('\n' + '='.repeat(62))
  push('  Enriching Corrective Work Orders  (Section 5)')
  push('='.repeat(62))

  let cwo = cwoRaw.map(r => ({ ...r }))

  // 5a. Priority
  cwo = leftJoin(cwo, prioMap, 'PriorityId',
    ['Name', 'ColorCode', 'IsCritical'], 'Priority')
  push('  ✓ 5a  Priority       (PriorityId → Priority_Name)')

  // 5b. Location
  cwo = leftJoin(cwo, locationMap, 'LocationId',
    ['Name', 'FullName', 'LocationCode', 'FloorNo'], 'Location')
  push('  ✓ 5b  Location       (LocationId → Location_Name / LocationCode)')

  // 5c. Top Location
  cwo = leftJoin(cwo, locationMap, 'TopLocationId',
    ['Name', 'FullName', 'LocationCode'], 'TopLocation')
  push('  ✓ 5c  Top Location   (TopLocationId → TopLocation_Name)')

  // 5d. Asset
  cwo = leftJoin(cwo, assetMap, 'AssetId',
    ['Name', 'EquipmentTag', 'Manufacturer', 'Model', 'OperationalStatus'], 'Asset')
  push('  ✓ 5d  Asset          (AssetId → Asset_Name / Asset_EquipmentTag)')

  // 5e. Problem Type via Event Type
  cwo = leftJoin(cwo, eventMap, 'ProblemTypeId',
    ['Code', 'Description', 'EventCategoryId'], 'ProblemType')
  push('  ✓ 5e  Problem Type   (ProblemTypeId → ProblemType_Description)')

  // 5f. Problem Type Template metadata (name-based)
  cwo = cwo.map(row => {
    const enName = extractEnName(row['ProblemType_Description'])
    const pt     = ptNameMap.get(enName)
    return {
      ...row,
      ProblemType_ServiceCategory : pt ? pt.ServiceCategory : '',
      ProblemType_TemplatePriority: pt ? pt.Priority        : '',
      ProblemType_Checklist       : pt ? pt.Checklist       : '',
    }
  })
  push('  ✓ 5f  Problem Type Template (ServiceCategory / Checklist)')

  // ── Section 6: Enrich Cases ───────────────────────────────────────────────
  push('\n' + '='.repeat(62))
  push('  Enriching Cases  (Section 6)')
  push('='.repeat(62))

  let cases = casesRaw.map(r => ({ ...r }))

  // 6a. Priority
  cases = leftJoin(cases, prioMap, 'PriorityLevelId',
    ['Name', 'ColorCode', 'IsCritical'], 'Priority')
  push('  ✓ 6a  Priority       (PriorityLevelId → Priority_Name)')

  // 6b. Location
  cases = leftJoin(cases, locationMap, 'LocationId',
    ['Name', 'FullName', 'LocationCode', 'FloorNo'], 'Location')
  push('  ✓ 6b  Location       (LocationId → Location_Name / LocationCode)')

  // 6c. Event Type
  cases = leftJoin(cases, eventMap, 'EventTypeId',
    ['Code', 'Description', 'EventCategoryId', 'PriorityLevelId', 'IsCritical'], 'EventType')
  push('  ✓ 6c  Event Type     (EventTypeId → EventType_Code / EventType_Description)')

  // 6d. Event Sub Type
  cases = leftJoin(cases, eventMap, 'EventSubTypeId',
    ['Code', 'Description'], 'EventSubType')
  push('  ✓ 6d  Event Sub Type (EventSubTypeId → EventSubType_Code)')

  // ── Section 7: Enrich PPM Work Orders ─────────────────────────────────────
  push('\n' + '='.repeat(62))
  push('  Enriching PPM Work Orders  (Section 7)')
  push('='.repeat(62))

  let ppm = ppmRaw.map(r => ({ ...r }))

  // 7a. Location
  ppm = leftJoin(ppm, locationMap, 'LocationId',
    ['Name', 'FullName', 'LocationCode', 'FloorNo'], 'Location')
  push('  ✓ 7a  Location       (LocationId → Location_Name / LocationCode)')

  // 7b. Top Location
  ppm = leftJoin(ppm, locationMap, 'TopLocationId',
    ['Name', 'FullName', 'LocationCode'], 'TopLocation')
  push('  ✓ 7b  Top Location   (TopLocationId → TopLocation_Name)')

  // 7c. Service Category (optional)
  if (serviceCategories.length > 0) {
    ppm = leftJoin(ppm, svcCatMap, 'ServiceCategoryId',
      ['Name', 'Code'], 'ServiceCategory')
    push('  ✓ 7c  Service Category (ServiceCategoryId → ServiceCategory_Name)')
  } else {
    push('  –  7c  Service Category skipped (master file not uploaded)')
  }

  // 7d. Frequency Type (optional)
  if (frequencyTypes.length > 0) {
    ppm = leftJoin(ppm, freqMap, 'FrequencyTypeId',
      ['Name', 'Code'], 'FrequencyType')
    push('  ✓ 7d  Frequency Type   (FrequencyTypeId → FrequencyType_Name)')
  } else {
    push('  –  7d  Frequency Type skipped (master file not uploaded)')
  }

  // 7e. Derive Status_Label from StatusId
  ppm = ppm.map(row => ({
    ...row,
    Status_Label: PPM_STATUS_MAP[toInt(row['StatusId'])] || 'Unknown',
  }))
  push('  ✓ 7e  Status Label   (StatusId → Status_Label)')

  // ── Join rate helper ──────────────────────────────────────────────────────
  const joinRate = (rows, idCol, resultCol) => {
    const valid   = rows.filter(r => { const v = toInt(r[idCol]); return v !== null && v !== 0 })
    const matched = valid.filter(r => r[resultCol] && r[resultCol] !== '')
    const rate    = valid.length ? (matched.length / valid.length * 100).toFixed(1) : 'N/A'
    return { matched: matched.length, total: valid.length, rate }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const summary = {
    cwo: {
      rows : cwo.length,
      cols : Object.keys(cwo[0]   || {}).length,
      joins: {
        Priority   : joinRate(cwo,   'PriorityId',    'Priority_Name'),
        Location   : joinRate(cwo,   'LocationId',    'Location_Name'),
        Asset      : joinRate(cwo,   'AssetId',       'Asset_Name'),
        ProblemType: joinRate(cwo,   'ProblemTypeId', 'ProblemType_Description'),
      },
    },
    cases: {
      rows : cases.length,
      cols : Object.keys(cases[0] || {}).length,
      joins: {
        Priority : joinRate(cases, 'PriorityLevelId', 'Priority_Name'),
        Location : joinRate(cases, 'LocationId',      'Location_Name'),
        EventType: joinRate(cases, 'EventTypeId',     'EventType_Description'),
      },
    },
    ppm: {
      rows : ppm.length,
      cols : Object.keys(ppm[0]   || {}).length,
      joins: {
        Location    : joinRate(ppm, 'LocationId',        'Location_Name'),
        TopLocation : joinRate(ppm, 'TopLocationId',     'TopLocation_Name'),
        ...(serviceCategories.length > 0 && {
          ServiceCategory: joinRate(ppm, 'ServiceCategoryId', 'ServiceCategory_Name'),
        }),
        ...(frequencyTypes.length > 0 && {
          FrequencyType  : joinRate(ppm, 'FrequencyTypeId',   'FrequencyType_Name'),
        }),
      },
    },
  }

  push('\n' + '='.repeat(62))
  push('  Enrichment Summary  (Section 9)')
  push('='.repeat(62))
  push(`\n  CWO   → ${cwo.length.toLocaleString()} rows  |  ${summary.cwo.cols} columns`)
  for (const [k, v] of Object.entries(summary.cwo.joins))
    push(`    ${k.padEnd(16)}: ${v.matched.toLocaleString()}/${v.total.toLocaleString()}  (${v.rate}%)`)
  push(`\n  Cases → ${cases.length.toLocaleString()} rows  |  ${summary.cases.cols} columns`)
  for (const [k, v] of Object.entries(summary.cases.joins))
    push(`    ${k.padEnd(16)}: ${v.matched.toLocaleString()}/${v.total.toLocaleString()}  (${v.rate}%)`)
  push(`\n  PPM   → ${ppm.length.toLocaleString()} rows  |  ${summary.ppm.cols} columns`)
  for (const [k, v] of Object.entries(summary.ppm.joins))
    push(`    ${k.padEnd(16)}: ${v.matched.toLocaleString()}/${v.total.toLocaleString()}  (${v.rate}%)`)
  push('\n' + '='.repeat(62) + '\n  Done.\n' + '='.repeat(62))

  return { cwo, cases, ppm, summary, log }
}
