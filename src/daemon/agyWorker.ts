// agyRead (or ocRead: a session given) off the daemon's main thread (agentUsage.ts' agyWorker): an Antigravity conversation's or OpenCode's DB past AGY_BIG, its
// clone (or copy) and its steps read here; agentUsage.ts ends it at AGY_MS and caps its heap. Its own build entry
// (out/main/agyWorker.js); imported outside a worker (test/load-order.test.ts) it does nothing
import { parentPort, workerData } from 'node:worker_threads'
import { agyRead, ocRead } from './agentUsage.ts'

if (parentPort) parentPort.postMessage({ r: workerData.session ? ocRead(String(workerData.db), String(workerData.session), Number(workerData.from) || 0) : agyRead(String(workerData.db), Number(workerData.from) || 0) })
