const { app, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const source = path.join(root, 'resources/sophon-icon-simple.png')

function generate() {
  const image = nativeImage.createFromPath(source)
  if (image.isEmpty()) throw new Error('The approved icon source could not be loaded.')
  const size = image.getSize()
  if (size.width !== size.height || size.width < 1024)
    throw new Error('Use square source artwork at least 1024 pixels wide.')

  const inset = Math.floor(size.width * 0.06)
  const artwork = image.crop({
    x: inset,
    y: inset,
    width: size.width - inset * 2,
    height: size.height - inset * 2
  })
  const png = (size) => artwork.resize({ width: size, height: size, quality: 'best' }).toPNG()
  const write = (file, data) => fs.writeFileSync(path.join(root, file), data)
  const master = png(1024)
  write('resources/icon.png', master)
  write('build/icon.png', master)
  write('resources/icon-64.png', png(64))

  const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
  const frames = sizes.map(png)
  const directory = Buffer.alloc(6 + sizes.length * 16)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(sizes.length, 4)
  let offset = directory.length
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16
    directory[entry] = size === 256 ? 0 : size
    directory[entry + 1] = size === 256 ? 0 : size
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(frames[index].length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += frames[index].length
  })
  write('build/icon.ico', Buffer.concat([directory, ...frames]))

  const representations = [
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
    ['ic11', 32],
    ['ic12', 64],
    ['ic13', 256],
    ['ic14', 512]
  ]
  const chunks = representations.map(([type, size]) => {
    const pixels = png(size)
    const header = Buffer.alloc(8)
    header.write(type, 0, 'ascii')
    header.writeUInt32BE(pixels.length + 8, 4)
    return Buffer.concat([header, pixels])
  })
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(8 + chunks.reduce((length, chunk) => length + chunk.length, 0), 4)
  write('build/icon.icns', Buffer.concat([header, ...chunks]))
  console.log('Generated app PNG, UI PNG, Windows ICO and macOS ICNS from the approved S. artwork.')
}

app
  .whenReady()
  .then(() => {
    generate()
    app.quit()
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
