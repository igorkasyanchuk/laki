// M5 on Linux (core.ts' tabOfPeer): who's at the other end of a local connection, by /proc. Its own module: the tests
// read a made-up /proc through it, and core.ts can't be imported alone
import { readdir, readFile, readlink } from 'node:fs/promises'
import { join } from 'node:path'

// lsof and ps often aren't there: the client's socket in /proc/net/tcp (its port, ours at the other end,
// established), then the process holding that socket's inode among its fds. Only this user's processes are readable,
// which is who could be calling
export async function procPeer(port: number, ours: number, proc = '/proc') {
  const hex = (n: number) => `:${n.toString(16).toUpperCase().padStart(4, '0')}`
  const rows = (await readFile(join(proc, 'net', 'tcp'), 'utf8').catch(() => '')).split('\n').map(l => l.trim().split(/\s+/))
  const inode = rows.find(f => f[1]?.endsWith(hex(port)) && f[2]?.endsWith(hex(ours)) && f[3] === '01')?.[9]
  if (!inode || inode === '0') return
  for (const d of await readdir(proc).catch(() => [] as string[])) {
    if (!/^\d+$/.test(d)) continue // ours too: laki serve's daemon calls itself
    for (const fd of await readdir(join(proc, d, 'fd')).catch(() => [] as string[])) if ((await readlink(join(proc, d, 'fd', fd)).catch(() => '')) === `socket:[${inode}]`) return Number(d)
  }
}
// a process's parent: /proc/<pid>/stat's, after its name (which may hold spaces and parentheses): state, ppid
export const procParent = async (pid: number, proc = '/proc') => Number((await readFile(join(proc, String(pid), 'stat'), 'utf8').catch(() => '')).replace(/^[^]*\) /, '').split(' ')[1]) || 0
// S1: a process's controlling terminal: /proc/<pid>/stat's tty_nr (the field after the session's), '' for none
export const procTty = async (pid: number, proc = '/proc') => (n => (n && n !== '0' ? n : ''))((await readFile(join(proc, String(pid), 'stat'), 'utf8').catch(() => '')).replace(/^[^]*\) /, '').split(' ')[4])
// S1: a process's session: its leader's pid (the session id) and when that one started (stat's starttime, in ticks)
export async function procSession(pid: number, proc = '/proc') {
  const f = async (p: number) => (await readFile(join(proc, String(p), 'stat'), 'utf8').catch(() => '')).replace(/^[^]*\) /, '').split(' ')
  const leader = Number((await f(pid))[3]) || 0
  const start = leader ? (await f(leader))[19] : ''
  return leader && start ? { leader, start } : undefined
}
