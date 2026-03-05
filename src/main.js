// =============================================================================
//  main.js  –  PARQ Data Enrichment Web App  v2
//
//  Master Data flow:
//    1. On load → fetch from /master-data/*.csv  (bundled server files)
//    2. Fail    → fall back to IndexedDB cache
//    3. User can override any master slot via ↑ Update button
//
//  v2 additions:
//    – PPM Work Orders transaction slot
//    – Service Category & Frequency Type master slots (optional)
//    – Third download button for PPM output
// =============================================================================

import './style.css'
import { FILE_SLOTS, MASTER_SLOTS, TXN_SLOTS } from './enrichment.js'
import { parseCSV, rowsToCSV, downloadCSV, detectSlot } from './csvUtils.js'
import { enrich } from './enrichment.js'
import { saveMaster, loadAllMasters, deleteMaster, formatSavedAt } from './masterStorage.js'

// ---------------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------------
const MASTER_BASE  = './master-data'
const MASTER_KEYS  = new Set(MASTER_SLOTS.map(s => s.key))
const TXN_KEYS     = new Set(TXN_SLOTS.map(s => s.key))
const REQUIRED_MASTER_KEYS = new Set(MASTER_SLOTS.filter(s => !s.optional).map(s => s.key))

// ---------------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------------
const state = { files: {}, results: null, manifest: null }

// ---------------------------------------------------------------------------
//  DOM refs
// ---------------------------------------------------------------------------
const masterSection = document.getElementById('master-section')
const txnSection    = document.getElementById('txn-section')
const runBtn        = document.getElementById('run-btn')
const resetTxnBtn   = document.getElementById('reset-txn-btn')
const logPanel      = document.getElementById('log-panel')
const logContent    = document.getElementById('log-content')
const resultsPanel  = document.getElementById('results-panel')
const dlCwo         = document.getElementById('dl-cwo')
const dlCases       = document.getElementById('dl-cases')
const dlPpm         = document.getElementById('dl-ppm')
const summaryEl     = document.getElementById('summary-cards')
const progressBar   = document.getElementById('progress-bar')
const masterStatus  = document.getElementById('master-status')
const dropZone      = document.getElementById('drop-zone')

// ---------------------------------------------------------------------------
//  Build all cards
// ---------------------------------------------------------------------------
function buildCards() {
  masterSection.innerHTML = ''
  txnSection.innerHTML    = ''

  for (const slot of MASTER_SLOTS) {
    const card = document.createElement('div')
    card.className = `file-card master${slot.optional ? ' optional' : ''}`
    card.dataset.key = slot.key
    card.id = `card-${slot.key}`
    card.innerHTML = `
      <div class="card-top">
        <span class="card-badge master-badge">
          ${slot.optional ? 'OPTIONAL' : 'MASTER DATA'}
        </span>
        <div class="server-tag loading" id="stag-${slot.key}">
          <span class="stag-icon">◌</span>
          <span class="stag-text">${slot.optional ? 'Optional' : 'Loading…'}</span>
        </div>
      </div>
      <div class="card-label">${slot.label}</div>
      <div class="card-hint" id="hint-${slot.key}">${slot.hint}</div>
      <div class="card-status ${slot.optional ? 'optional-idle' : 'loading'}" id="status-${slot.key}">
        <span class="status-icon">${slot.optional ? '◎' : '◌'}</span>
        <span class="status-text">${slot.optional ? 'Optional — upload if available' : 'Fetching from server…'}</span>
      </div>
      <div class="card-footer">
        <label class="override-btn" title="${slot.optional ? 'Upload this file' : 'Upload a newer version'}">
          ↑ ${slot.optional ? 'Upload' : 'Update'}
          <input type="file" accept=".csv" data-slot="${slot.key}" class="hidden-input">
        </label>
        <button class="revert-btn hidden" id="revert-${slot.key}" title="Revert to server file">
          ↺ Revert
        </button>
      </div>`
    masterSection.appendChild(card)
  }

  for (const slot of TXN_SLOTS) {
    const card = document.createElement('div')
    card.className = 'file-card transaction'
    card.dataset.key = slot.key
    card.id = `card-${slot.key}`
    card.innerHTML = `
      <div class="card-top">
        <span class="card-badge txn-badge">TRANSACTION</span>
      </div>
      <div class="card-label">${slot.label}</div>
      <div class="card-hint">${slot.hint}</div>
      <div class="card-status idle" id="status-${slot.key}">
        <span class="status-icon">○</span>
        <span class="status-text">Awaiting upload…</span>
      </div>
      <label class="card-pick">
        Browse
        <input type="file" accept=".csv" data-slot="${slot.key}" class="hidden-input">
      </label>`
    txnSection.appendChild(card)
  }

  wireMasterInputs()
  wireTxnInputs()
  wireRevertBtns()
}

function wireMasterInputs() {
  masterSection.querySelectorAll('.hidden-input').forEach(input => {
    input.addEventListener('change', e => {
      if (e.target.files[0]) handleFileUpload(e.target.files[0], e.target.dataset.slot)
    })
  })
}

function wireTxnInputs() {
  txnSection.querySelectorAll('.hidden-input').forEach(input => {
    input.addEventListener('change', e => {
      if (e.target.files[0]) handleFileUpload(e.target.files[0], e.target.dataset.slot)
    })
  })
}

function wireRevertBtns() {
  document.querySelectorAll('.revert-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.id.replace('revert-', '')
      await deleteMaster(key)
      const slot = MASTER_SLOTS.find(s => s.key === key)
      if (slot?.optional) {
        state.files[key] = null
        setCardStatus(key, 'optional-idle', 'Optional — upload if available')
        setServerTag(key, 'loading', 'Optional')
        hideRevert(key)
      } else {
        await fetchMasterSlot(key, state.manifest)
      }
    })
  })
}

// ---------------------------------------------------------------------------
//  Manifest
// ---------------------------------------------------------------------------
async function loadManifest() {
  try {
    const res = await fetch(`${MASTER_BASE}/manifest.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch { return null }
}

// ---------------------------------------------------------------------------
//  Fetch one master slot from server
// ---------------------------------------------------------------------------
async function fetchMasterSlot(key, manifest) {
  const slot     = MASTER_SLOTS.find(s => s.key === key)
  const entry    = manifest?.masterData?.find(m => m.key === key)
  const filename = entry?.file || `MZ_PARQ_${key}.csv`
  const url      = `${MASTER_BASE}/${filename}`

  if (!slot?.optional) {
    setCardStatus(key, 'loading', `Fetching ${filename}…`)
    setServerTag(key, 'loading', 'Fetching…')
  }

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    const data = parseCSVText(text)

    state.files[key] = { rows: data, name: filename, rowCount: data.length, source: 'server' }
    await saveMaster(key, data, filename, data.length)

    const lastUpdated = manifest?.lastUpdated || ''
    setCardStatus(key, 'server', `${filename}  ·  ${data.length.toLocaleString()} rows`)
    setServerTag(key, 'server', lastUpdated ? `Server · ${lastUpdated}` : 'Server')
    if (entry?.sourceFile) setHint(key, `Source: ${entry.sourceFile}`)
    hideRevert(key)
    return true
  } catch {
    if (slot?.optional) {
      // Optional file not on server — that's fine
      state.files[key] = null
      setCardStatus(key, 'optional-idle', 'Optional — upload if available')
      setServerTag(key, 'loading', 'Optional')
      return true
    }
    return loadMasterFromCache(key)
  }
}

// ---------------------------------------------------------------------------
//  Load from IndexedDB cache (offline fallback)
// ---------------------------------------------------------------------------
async function loadMasterFromCache(key) {
  try {
    const all   = await loadAllMasters()
    const entry = all.get(key)
    if (!entry) throw new Error('not cached')
    state.files[key] = { rows: entry.rows, name: entry.filename, rowCount: entry.rowCount, source: 'cached' }
    setCardStatus(key, 'cached', `${entry.filename}  ·  ${entry.rowCount.toLocaleString()} rows`)
    setServerTag(key, 'cached', `Cached · ${formatSavedAt(entry.savedAt)}`)
    hideRevert(key)
    return true
  } catch {
    const slot = MASTER_SLOTS.find(s => s.key === key)
    state.files[key] = null
    if (slot?.optional) {
      setCardStatus(key, 'optional-idle', 'Optional — upload if available')
      setServerTag(key, 'loading', 'Optional')
    } else {
      setCardStatus(key, 'error', 'Not available — upload manually using Update button')
      setServerTag(key, 'error', 'Unavailable')
    }
    return false
  }
}

// ---------------------------------------------------------------------------
//  Handle file upload
// ---------------------------------------------------------------------------
async function handleFileUpload(file, slotKey) {
  setCardStatus(slotKey, 'loading', `Parsing ${file.name}…`)
  try {
    const result = await parseCSV(file)
    state.files[slotKey] = { rows: result.data, name: file.name, rowCount: result.data.length, source: 'upload' }
    setCardStatus(slotKey, 'upload', `${file.name}  ·  ${result.data.length.toLocaleString()} rows`)

    if (MASTER_KEYS.has(slotKey)) {
      await saveMaster(slotKey, result.data, file.name, result.data.length)
      setServerTag(slotKey, 'override', '▲ Override active')
      showRevert(slotKey)
    }
  } catch (err) {
    setCardStatus(slotKey, 'error', `Error: ${err.message}`)
  }
  updateMasterStatusBar()
  updateRunButton()
}

// ---------------------------------------------------------------------------
//  Drag-and-drop
// ---------------------------------------------------------------------------
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over') })
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
dropZone.addEventListener('drop', async e => {
  e.preventDefault()
  dropZone.classList.remove('drag-over')
  const files = [...e.dataTransfer.files].filter(f => f.name.endsWith('.csv'))
  for (const file of files) {
    const slotKey = detectSlot(file.name, FILE_SLOTS)
    if (slotKey) await handleFileUpload(file, slotKey)
    else showToast(`⚠ Could not detect slot for "${file.name}"`, true)
  }
})

// ---------------------------------------------------------------------------
//  Run enrichment
// ---------------------------------------------------------------------------
runBtn.addEventListener('click', async () => {
  runBtn.disabled = true
  runBtn.textContent = 'Processing…'
  progressBar.style.width = '0%'
  progressBar.classList.add('active')
  logPanel.classList.remove('hidden')
  logContent.textContent = ''
  resultsPanel.classList.add('hidden')

  let pct = 0
  const ticker = setInterval(() => {
    pct = Math.min(pct + Math.random() * 10, 88)
    progressBar.style.width = pct + '%'
  }, 120)

  await new Promise(r => setTimeout(r, 40))

  try {
    const datasets = {}
    for (const slot of FILE_SLOTS) {
      datasets[slot.key] = state.files[slot.key]?.rows || []
    }

    state.results = enrich(datasets)

    clearInterval(ticker)
    progressBar.style.width = '100%'
    setTimeout(() => progressBar.classList.remove('active'), 600)

    logContent.textContent = state.results.log.join('\n')
    renderSummary(state.results.summary)
    updateDownloadButtons()
    resultsPanel.classList.remove('hidden')
    runBtn.textContent = '▶ Run Enrichment'
    runBtn.disabled = false
    showToast('✓ Enrichment complete — files ready to download!')
    resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (err) {
    clearInterval(ticker)
    progressBar.classList.remove('active')
    logContent.textContent += `\n\nERROR: ${err.message}\n${err.stack}`
    runBtn.textContent = '▶ Run Enrichment'
    runBtn.disabled = false
    showToast(`✕ Error: ${err.message}`, true)
  }
})

// ---------------------------------------------------------------------------
//  Reset transaction files only
// ---------------------------------------------------------------------------
resetTxnBtn.addEventListener('click', () => {
  for (const key of TXN_KEYS) delete state.files[key]
  txnSection.innerHTML = ''
  for (const slot of TXN_SLOTS) {
    const card = document.createElement('div')
    card.className = 'file-card transaction'
    card.dataset.key = slot.key
    card.id = `card-${slot.key}`
    card.innerHTML = `
      <div class="card-top"><span class="card-badge txn-badge">TRANSACTION</span></div>
      <div class="card-label">${slot.label}</div>
      <div class="card-hint">${slot.hint}</div>
      <div class="card-status idle" id="status-${slot.key}">
        <span class="status-icon">○</span>
        <span class="status-text">Awaiting upload…</span>
      </div>
      <label class="card-pick">Browse
        <input type="file" accept=".csv" data-slot="${slot.key}" class="hidden-input">
      </label>`
    txnSection.appendChild(card)
  }
  wireTxnInputs()
  resultsPanel.classList.add('hidden')
  logPanel.classList.add('hidden')
  state.results = null
  updateRunButton()
})

// ---------------------------------------------------------------------------
//  Download buttons
// ---------------------------------------------------------------------------
function updateDownloadButtons() {
  if (!state.results) return
  const hasPpm = state.results.ppm?.length > 0
  dlPpm.style.display = hasPpm ? 'inline-flex' : 'none'
}

const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')

dlCwo.addEventListener('click', () => {
  if (!state.results) return
  downloadCSV(rowsToCSV(state.results.cwo), `MZ_PARQ_CWO_Enriched_${today()}.csv`)
})
dlCases.addEventListener('click', () => {
  if (!state.results) return
  downloadCSV(rowsToCSV(state.results.cases), `MZ_PARQ_Cases_Enriched_${today()}.csv`)
})
dlPpm.addEventListener('click', () => {
  if (!state.results) return
  downloadCSV(rowsToCSV(state.results.ppm), `MZ_PARQ_PPM_Enriched_${today()}.csv`)
})

// ---------------------------------------------------------------------------
//  Summary cards
// ---------------------------------------------------------------------------
function renderSummary(summary) {
  summaryEl.innerHTML = ''

  const tables = [
    { label: 'CWO Enriched',   key: 'cwo',   clr: '--accent'  },
    { label: 'Cases Enriched', key: 'cases', clr: '--accent2' },
    { label: 'PPM Enriched',   key: 'ppm',   clr: '--accent3' },
  ]

  for (const t of tables) {
    const s = summary[t.key]
    if (!s || s.rows === 0) continue

    const rows = Object.entries(s.joins).map(([dim, v]) => `
      <tr>
        <td>${dim}</td>
        <td class="mono">${v.matched.toLocaleString()} / ${v.total.toLocaleString()}</td>
        <td class="rate ${parseFloat(v.rate) >= 95 ? 'good' : parseFloat(v.rate) >= 80 ? 'warn' : 'bad'}">${v.rate}%</td>
      </tr>`).join('')

    const card = document.createElement('div')
    card.className = 'summary-card'
    card.innerHTML = `
      <div class="sc-header" style="border-color:var(${t.clr})">
        <span class="sc-title">${t.label}</span>
        <span class="sc-meta mono">${s.rows.toLocaleString()} rows · ${s.cols} cols</span>
      </div>
      <table class="join-table">
        <thead><tr><th>Dimension</th><th>Matched</th><th>Rate</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`
    summaryEl.appendChild(card)
  }
}

// ---------------------------------------------------------------------------
//  Master status bar
// ---------------------------------------------------------------------------
function updateMasterStatusBar() {
  const requiredSlots = MASTER_SLOTS.filter(s => !s.optional)
  const loaded        = requiredSlots.filter(s => state.files[s.key]?.rows?.length)
  const sources       = loaded.map(s => state.files[s.key]?.source)
  const hasOverride   = sources.some(s => s === 'upload')
  const hasCached     = sources.some(s => s === 'cached')
  const allServer     = loaded.length === requiredSlots.length && sources.every(s => s === 'server')

  // Count optional slots that have been uploaded
  const optionalLoaded = MASTER_SLOTS.filter(s => s.optional && state.files[s.key]?.rows?.length)

  let icon, text, cls
  if (loaded.length < requiredSlots.length) {
    icon = '◌'; text = `Loading master data… (${loaded.length}/${requiredSlots.length} required ready)`; cls = 'loading'
  } else if (allServer) {
    icon = '●'
    text = `All ${requiredSlots.length} required master tables loaded from server`
    if (optionalLoaded.length > 0) text += `  ·  ${optionalLoaded.length} optional`
    cls = 'server'
  } else if (hasOverride) {
    icon = '▲'; text = `Master data ready — override active`; cls = 'override'
  } else if (hasCached) {
    icon = '◆'; text = `Master data ready — loaded from browser cache`; cls = 'cached'
  } else {
    icon = '●'; text = `All required master tables ready`; cls = 'server'
  }

  masterStatus.className = `master-status-bar ${cls}`
  masterStatus.innerHTML = `<span class="msb-icon">${icon}</span><span>${text}</span>`
}

// ---------------------------------------------------------------------------
//  Run button gating
// ---------------------------------------------------------------------------
function updateRunButton() {
  const txnOk    = [...TXN_KEYS].every(k => state.files[k]?.rows?.length)
  const masterOk = [...REQUIRED_MASTER_KEYS].every(k => state.files[k]?.rows?.length)
  const ok = txnOk && masterOk
  runBtn.disabled = !ok
  runBtn.classList.toggle('ready', ok)
}

// ---------------------------------------------------------------------------
//  Card UI helpers
// ---------------------------------------------------------------------------
const STATUS_ICONS = { idle:'○', loading:'◌', server:'●', cached:'◆', upload:'▲', error:'✕', 'optional-idle':'◎' }
const STATUS_TYPE  = { idle:'idle', loading:'loading', server:'server', cached:'cached', upload:'upload', error:'error', 'optional-idle':'optional-idle' }

function setCardStatus(key, type, text) {
  const el = document.getElementById(`status-${key}`)
  if (!el) return
  el.className = `card-status ${STATUS_TYPE[type] || 'idle'}`
  el.innerHTML = `<span class="status-icon">${STATUS_ICONS[type] || '○'}</span>
                  <span class="status-text" title="${text}">${text}</span>`
  updateMasterStatusBar()
  updateRunButton()
}

function setServerTag(key, type, text) {
  const el = document.getElementById(`stag-${key}`)
  if (!el) return
  const icons = { server:'⬡', cached:'◆', override:'▲', loading:'◌', error:'✕' }
  el.className = `server-tag ${type}`
  el.innerHTML = `<span class="stag-icon">${icons[type] || '◌'}</span>
                  <span class="stag-text">${text}</span>`
}

function setHint(key, text) {
  const el = document.getElementById(`hint-${key}`)
  if (el) el.textContent = text
}

function showRevert(key) {
  const btn = document.getElementById(`revert-${key}`)
  if (btn) btn.classList.remove('hidden')
}

function hideRevert(key) {
  const btn = document.getElementById(`revert-${key}`)
  if (btn) btn.classList.add('hidden')
}

// ---------------------------------------------------------------------------
//  Server CSV text parser
// ---------------------------------------------------------------------------
function parseCSVText(text) {
  const Papa = window._Papa
  if (Papa) return Papa.parse(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
  if (!lines.length) return []
  const headers = splitLine(lines[0])
  return lines.slice(1).map(l => {
    const vals = splitLine(l)
    const row = {}
    headers.forEach((h, i) => { row[h] = vals[i] ?? '' })
    return row
  })
}

function splitLine(line) {
  const r = []; let c = ''; let q = false
  for (const ch of line) {
    if (ch === '"') { q = !q }
    else if (ch === ',' && !q) { r.push(c.trim()); c = '' }
    else { c += ch }
  }
  r.push(c.trim()); return r
}

// ---------------------------------------------------------------------------
//  Toast
// ---------------------------------------------------------------------------
function showToast(msg, isError = false) {
  const t = document.createElement('div')
  t.className = `toast ${isError ? 'toast-error' : 'toast-ok'}`
  t.textContent = msg
  document.body.appendChild(t)
  requestAnimationFrame(() => t.classList.add('show'))
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400) }, 3500)
}

// ---------------------------------------------------------------------------
//  Init
// ---------------------------------------------------------------------------
async function init() {
  const PapaMod = await import('papaparse')
  window._Papa = PapaMod.default || PapaMod

  buildCards()
  updateMasterStatusBar()
  updateRunButton()

  state.manifest = await loadManifest()

  // Fetch required masters in parallel, optional ones after
  const required = MASTER_SLOTS.filter(s => !s.optional)
  const optional = MASTER_SLOTS.filter(s => s.optional)

  await Promise.all(required.map(s => fetchMasterSlot(s.key, state.manifest)))
  await Promise.all(optional.map(s => fetchMasterSlot(s.key, state.manifest)))

  updateMasterStatusBar()
  updateRunButton()
}

init()
