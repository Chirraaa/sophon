const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file))
function png(bytes, size) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(bytes.readUInt32BE(16), size)
  assert.equal(bytes.readUInt32BE(20), size)
  assert.equal(bytes[25], 6, 'RGBA transparency is preserved')
}
png(read('resources/icon.png'), 1024)
png(read('resources/icon-64.png'), 64)
assert.deepEqual(read('resources/icon.png'), read('build/icon.png'))
const ico = read('build/icon.ico')
assert.equal(ico.readUInt16LE(0), 0)
assert.equal(ico.readUInt16LE(2), 1)
const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
assert.equal(ico.readUInt16LE(4), sizes.length)
let offset = 6 + 16 * sizes.length
sizes.forEach((size, index) => {
  const entry = 6 + 16 * index
  assert.equal(ico[entry] || 256, size)
  assert.equal(ico[entry + 1] || 256, size)
  assert.equal(ico.readUInt16LE(entry + 6), 32)
  assert.equal(ico.readUInt32LE(entry + 12), offset)
  const length = ico.readUInt32LE(entry + 8)
  png(ico.subarray(offset, offset + length), size)
  offset += length
})
assert.equal(offset, ico.length)
const icns = read('build/icon.icns')
assert.equal(icns.subarray(0, 4).toString(), 'icns')
assert.equal(icns.readUInt32BE(4), icns.length)
const representations = {
  icp4: 16,
  icp5: 32,
  icp6: 64,
  ic07: 128,
  ic08: 256,
  ic09: 512,
  ic10: 1024,
  ic11: 32,
  ic12: 64,
  ic13: 256,
  ic14: 512
}
offset = 8
const seen = new Set()
while (offset < icns.length) {
  const type = icns.subarray(offset, offset + 4).toString()
  const length = icns.readUInt32BE(offset + 4)
  assert(length > 8 && offset + length <= icns.length)
  assert(type in representations && !seen.has(type))
  seen.add(type)
  png(icns.subarray(offset + 8, offset + length), representations[type])
  offset += length
}
assert.equal(offset, icns.length)
assert.equal(seen.size, Object.keys(representations).length)
console.log('PASS shared PNGs, Windows ICO frames, macOS ICNS representations and RGBA encoding')
