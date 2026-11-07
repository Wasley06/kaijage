import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'assets', 'icon-3d.svg')
const svg = await readFile(source)
const generated = path.join(root, 'assets', 'generated')
const publicDir = path.join(root, 'public')
const androidRes = path.join(root, 'assets', 'platform', 'android', 'res')
const iosIcons = path.join(root, 'assets', 'platform', 'ios', 'AppIcon.appiconset')

await Promise.all([
  mkdir(generated, { recursive: true }),
  mkdir(publicDir, { recursive: true }),
  mkdir(androidRes, { recursive: true }),
  mkdir(iosIcons, { recursive: true }),
])

async function png(size, output, background = { r: 0, g: 0, b: 0, alpha: 0 }) {
  const image = await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background })
    .flatten({ background: '#F1FBFA' })
    .png()
    .toBuffer()
  await writeFile(output, image)
  return image
}

const iconPng = new Map()
for (const size of [16, 20, 24, 29, 32, 36, 40, 48, 58, 60, 64, 72, 76, 80, 83, 87, 96, 120, 128, 144, 152, 167, 180, 192, 256, 512, 1024]) {
  iconPng.set(size, await png(size, path.join(generated, `icon-${size}.png`)))
}

await Promise.all([
  copyFile(source, path.join(publicDir, 'favicon.svg')),
  writeFile(path.join(publicDir, 'kaijage-logo.png'), iconPng.get(512)),
  writeFile(path.join(publicDir, 'kaijage-icon-192.png'), iconPng.get(192)),
  writeFile(path.join(publicDir, 'kaijage-icon-512.png'), iconPng.get(512)),
  writeFile(path.join(publicDir, 'kaijage-icon-180.png'), iconPng.get(180)),
])

// A standards-based ICO containing PNG-backed sizes for modern Windows.
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoHeader = Buffer.alloc(6 + icoSizes.length * 16)
icoHeader.writeUInt16LE(0, 0)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(icoSizes.length, 4)
let offset = icoHeader.length
const icoParts = [icoHeader]
for (let index = 0; index < icoSizes.length; index += 1) {
  const size = icoSizes[index]
  const image = iconPng.get(size)
  const entry = 6 + index * 16
  icoHeader[entry] = size === 256 ? 0 : size
  icoHeader[entry + 1] = size === 256 ? 0 : size
  icoHeader.writeUInt16LE(1, entry + 4)
  icoHeader.writeUInt16LE(32, entry + 6)
  icoHeader.writeUInt32LE(image.length, entry + 8)
  icoHeader.writeUInt32LE(offset, entry + 12)
  icoParts.push(image)
  offset += image.length
}
await writeFile(path.join(generated, 'icon.ico'), Buffer.concat(icoParts))

// ICNS uses PNG payloads at the standard macOS icon sizes.
const icnsTypes = new Map([[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']])
const icnsChunks = [...icnsTypes].map(([size, type]) => {
  const image = iconPng.get(size)
  const chunk = Buffer.alloc(8 + image.length)
  chunk.write(type, 0, 4, 'ascii')
  chunk.writeUInt32BE(chunk.length, 4)
  image.copy(chunk, 8)
  return chunk
})
const icnsLength = 8 + icnsChunks.reduce((sum, chunk) => sum + chunk.length, 0)
const icnsHeader = Buffer.alloc(8)
icnsHeader.write('icns', 0, 4, 'ascii')
icnsHeader.writeUInt32BE(icnsLength, 4)
await writeFile(path.join(generated, 'icon.icns'), Buffer.concat([icnsHeader, ...icnsChunks]))

// Capacitor Android launcher resources at each legacy density plus adaptive icon.
const androidDensities = new Map([['ldpi', 36], ['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]])
for (const [density, size] of androidDensities) {
  const dir = path.join(androidRes, `mipmap-${density}`)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'ic_launcher.png'), iconPng.get(size))
  await writeFile(path.join(dir, 'ic_launcher_round.png'), iconPng.get(size))
  await writeFile(path.join(dir, 'ic_launcher_foreground.png'), iconPng.get(size))
}
const adaptiveDir = path.join(androidRes, 'mipmap-anydpi-v26')
await mkdir(adaptiveDir, { recursive: true })
await writeFile(path.join(adaptiveDir, 'ic_launcher.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>\n`)
await writeFile(path.join(adaptiveDir, 'ic_launcher_round.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>\n`)
const valuesDir = path.join(androidRes, 'values')
await mkdir(valuesDir, { recursive: true })
await writeFile(path.join(valuesDir, 'ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">#F1FBFA</color></resources>\n`)

// Capacitor iOS App Store and device icons.
const iosEntries = [
  ['20', '1x', 20], ['20', '2x', 40], ['20', '3x', 60],
  ['29', '1x', 29], ['29', '2x', 58], ['29', '3x', 87],
  ['40', '1x', 40], ['40', '2x', 80], ['40', '3x', 120],
  ['60', '2x', 120], ['60', '3x', 180],
  ['76', '1x', 76], ['76', '2x', 152],
  ['83.5', '2x', 167], ['1024', '1x', 1024],
]
const iosImages = []
for (const [size, scale, pixels] of iosEntries) {
  const filename = `AppIcon-${size.replace('.', '_')}-${scale}.png`
  await writeFile(path.join(iosIcons, filename), iconPng.get(pixels))
  iosImages.push({ filename, idiom: 'universal', platform: 'ios', size: `${size}x${size}`, scale })
}
await writeFile(path.join(iosIcons, 'Contents.json'), `${JSON.stringify({ images: iosImages, info: { author: 'xcode', version: 1 } }, null, 2)}\n`)

console.log('Generated Windows, macOS, web, Android, and iOS app icons from assets/icon-3d.svg')
