// Settings › Appearance › Dock icon: the mark (icon.svg, the app's own) or one of five others (icons/). The picked one
// goes to main as a PNG (bridge.dockIcon: app.dock.setIcon), which keeps it in userData for the next start; Finder
// keeps the app's own (ponytail: build/icon.icns isn't swapped)
import laki from './icon.svg?raw'
import bubbles from './icons/bubbles.svg?raw'
import dawn from './icons/dawn.svg?raw'
import glacier from './icons/glacier.svg?raw'
import neon from './icons/neon.svg?raw'
import terminal from './icons/terminal.svg?raw'

const url = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` // a data URL: a canvas it's drawn on stays readable
export const DOCK_ICONS: [id: string, name: string, src: string][] = [
  ['laki', 'Laki', url(laki)],
  ['dawn', 'Dawn', url(dawn)],
  ['terminal', 'Terminal', url(terminal)],
  ['glacier', 'Glacier', url(glacier)],
  ['bubbles', 'Bubbles', url(bubbles)],
  ['neon', 'Neon', url(neon)],
]

// the icon as a 1024px PNG in Apple's grid (the tile 824 of it, as scripts/icon.swift draws the app's)
export async function dockPng(src: string) {
  const img = new Image(824, 824)
  img.src = src
  await img.decode()
  const c = document.createElement('canvas')
  c.width = c.height = 1024
  c.getContext('2d')!.drawImage(img, 100, 100, 824, 824)
  return c.toDataURL('image/png')
}
