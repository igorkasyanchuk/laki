// readSheets off the daemon's main thread (files.ts' sheetsOf): a crafted workbook stalls this worker, never the
// daemon; files.ts ends it at 3 s and caps its heap. Its own build entry (out/main/sheetWorker.js); imported outside a
// worker (test/load-order.test.ts) it does nothing
import { readFileSync } from 'node:fs'
import { parentPort, workerData } from 'node:worker_threads'
import { readSheets } from './sheet.ts'

if (parentPort)
  try {
    parentPort.postMessage({ sheets: readSheets(readFileSync(String(workerData.path))) })
  } catch (e) {
    parentPort.postMessage({ err: (e as Error).message })
  }
