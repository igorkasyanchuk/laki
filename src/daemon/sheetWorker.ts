// readSheets off the daemon's main thread (files.ts' sheetsOf): a crafted workbook stalls this worker, never the
// daemon; files.ts ends it at 3 s and caps its heap. Its own build entry (out/main/sheetWorker.js)
import { readFileSync } from 'node:fs'
import { parentPort, workerData } from 'node:worker_threads'
import { readSheets } from './sheet.ts'

try {
  parentPort!.postMessage({ sheets: readSheets(readFileSync(String(workerData.path))) })
} catch (e) {
  parentPort!.postMessage({ err: (e as Error).message })
}
