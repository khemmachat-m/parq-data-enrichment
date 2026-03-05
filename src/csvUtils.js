// =============================================================================
//  csvUtils.js  –  CSV parse and export helpers
// =============================================================================
import Papa from 'papaparse'

/** Parse a File object → Promise<{data, meta, errors}> */
export function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      encoding: 'UTF-8',
      complete: result => resolve(result),
      error: err => reject(err),
    })
  })
}

/** Parse a raw CSV string (used for server-fetched files) */
export function parseCSVText(text) {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
  })
  return result.data
}

/** Array of row objects → CSV string */
export function rowsToCSV(rows) {
  return Papa.unparse(rows, { header: true })
}

/** Trigger browser download of a CSV string (UTF-8 BOM for Excel) */
export function downloadCSV(csvString, filename) {
  const BOM  = '\uFEFF'
  const blob = new Blob([BOM + csvString], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Auto-detect which FILE_SLOT a filename belongs to by prefix */
export function detectSlot(filename, slots) {
  const name = filename.toLowerCase().replace(/\s+/g, '')
  for (const slot of slots) {
    const prefix = slot.prefix.toLowerCase().replace(/\s+/g, '')
    if (name.startsWith(prefix)) return slot.key
  }
  return null
}
