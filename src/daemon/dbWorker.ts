// dbRead off the daemon's main thread (files.ts' dbOf): a database's count, a slow query or a huge row stalls this
// worker, never the daemon; files.ts ends it at DB_MS and caps its heap. Its own build entry (out/main/dbWorker.js);
// imported outside a worker (test/load-order.test.ts) it does nothing
import { parentPort, workerData } from 'node:worker_threads'
import { dbRead } from './db.ts'

if (parentPort)
  try {
    parentPort.postMessage({ r: dbRead(String(workerData.path), workerData.q) })
  } catch (e) {
    parentPort.postMessage({ err: (e as Error).message })
  }
