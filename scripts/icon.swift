// Renders the mark (src/renderer/src/icon.svg) to build/icon.icns, the app icon electron-builder takes as it is
// (a PNG it would convert with a download): every size, the mark in Apple's grid (824 of 1024), drawn by macOS's
// own SVG support, packed by iconutil. swift scripts/icon.swift
import AppKit

let root = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().appendingPathComponent("..")
guard let svg = NSImage(contentsOf: root.appendingPathComponent("src/renderer/src/icon.svg")) else { fatalError("can't read the mark") }
let set = root.appendingPathComponent("build/icon.iconset")
try? FileManager.default.removeItem(at: set)
try! FileManager.default.createDirectory(at: set, withIntermediateDirectories: true)

func png(_ size: Int, _ name: String) {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
                             hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let s = CGFloat(size)
  svg.draw(in: NSRect(x: s * 100 / 1024, y: s * 100 / 1024, width: s * 824 / 1024, height: s * 824 / 1024))
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: set.appendingPathComponent(name))
}
for p in [16, 32, 128, 256, 512] {
  png(p, "icon_\(p)x\(p).png")
  png(p * 2, "icon_\(p)x\(p)@2x.png")
}
let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", set.path, "-o", root.appendingPathComponent("build/icon.icns").path]
try! iconutil.run()
iconutil.waitUntilExit()
try! FileManager.default.removeItem(at: set)
if iconutil.terminationStatus != 0 { fatalError("iconutil failed") }
