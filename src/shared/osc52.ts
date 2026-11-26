// OSC 52 (a program's copy: vim's, tmux's, one over ssh): ESC ] 52 ; <targets> ; <base64> BEL, as xterm.js hands its
// data over ("<targets>;<base64>"). The text to put on the Mac's clipboard, or none: a read request ("?": never
// answered), a target set that isn't the clipboard (c), the selection (s) or empty (the default, c), base64 that isn't,
// over OSC52_MAX once decoded, or nothing at all. The text is the user's, as it is
export const OSC52_MAX = 100 * 1024 // bytes, decoded
const B64 = /^[A-Za-z0-9+/]*={0,2}$/
export function osc52(data: string): { text: string } | undefined {
  const at = data.indexOf(';')
  if (at < 0) return
  const targets = data.slice(0, at)
  const b64 = data.slice(at + 1).replace(/\s+/g, '')
  if (b64 === '?' || !/^[cpqs0-7]*$/.test(targets) || (targets && !/[cs]/.test(targets))) return
  if (!b64 || b64.length > Math.ceil(OSC52_MAX / 3) * 4 || b64.length % 4 === 1 || !B64.test(b64)) return
  let bin: string
  try {
    bin = atob(b64)
  } catch {
    return
  }
  if (bin.length > OSC52_MAX) return
  const text = new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
  return text ? { text } : undefined
}
