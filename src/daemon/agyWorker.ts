// agyRead off the daemon's main thread (agentUsage.ts' agyWorker): an Antigravity conversation's DB past AGY_BIG, its
// clone (or copy) and its steps read here; agentUsage.ts ends it at AGY_MS and caps its heap. Its own build entry
// (out/main/agyWorker.js); imported outside a worker (test/load-order.test.ts) it does nothing
import { parentPort, workerData } from 'node:worker_threads'
import { agyRead } from './agentUsage.ts'

if (parentPort) parentPort.postMessage({ r: agyRead(String(workerData.db), Number(workerData.from) || 0) })
