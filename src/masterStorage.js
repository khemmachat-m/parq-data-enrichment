// =============================================================================
//  masterStorage.js  –  IndexedDB persistence for PARQ Master Data files
//
//  Why IndexedDB (not localStorage):
//    • Assets alone has 10,000+ rows → JSON too large for localStorage (~5 MB limit)
//    • IndexedDB handles 100 MB+ with no issue
//    • Persists across browser sessions (until user clears site data)
// =============================================================================

const DB_NAME    = 'PARQ_MasterData'
const DB_VERSION = 1
const STORE      = 'masterFiles'

/** Open (or create) the IndexedDB database */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = e => resolve(e.target.result)
    req.onerror   = e => reject(e.target.error)
  })
}

/**
 * Save master data rows to IndexedDB.
 * @param {string} key      – slot key, e.g. 'priorities'
 * @param {Array}  rows     – parsed CSV row objects
 * @param {string} filename – original filename (stored for display)
 * @param {number} rowCount
 */
export async function saveMaster(key, rows, filename, rowCount) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).put({
      key,
      rows,
      filename,
      rowCount,
      savedAt: new Date().toISOString(),
    })
    req.onsuccess = () => resolve()
    req.onerror   = e => reject(e.target.error)
  })
}

/**
 * Load one master data entry from IndexedDB.
 * Returns null if not stored yet.
 */
export async function loadMaster(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = e => resolve(e.target.result || null)
    req.onerror   = e => reject(e.target.error)
  })
}

/**
 * Load ALL stored master entries at once.
 * Returns a Map<key → entry>.
 */
export async function loadAllMasters() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = e => {
      const map = new Map()
      for (const entry of e.target.result) map.set(entry.key, entry)
      resolve(map)
    }
    req.onerror = e => reject(e.target.error)
  })
}

/**
 * Delete one master data entry (user forced a fresh re-upload).
 */
export async function deleteMaster(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).delete(key)
    req.onsuccess = () => resolve()
    req.onerror   = e => reject(e.target.error)
  })
}

/**
 * Wipe ALL stored master data.
 */
export async function clearAllMasters() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).clear()
    req.onsuccess = () => resolve()
    req.onerror   = e => reject(e.target.error)
  })
}

/**
 * Format a savedAt ISO string to a human-readable label.
 */
export function formatSavedAt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
