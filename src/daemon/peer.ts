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
