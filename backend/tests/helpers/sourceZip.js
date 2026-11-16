const zlib = require('zlib')
const { crc32 } = require('../../src/services/sourceArchive')
function makeZip(entries) {
  const locals = [], central = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path)
    const data = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content || '')
    const compressed = entry.deflate ? zlib.deflateRawSync(data) : data
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(entry.encrypted ? 1 : 0, 6)
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8); local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26)
    locals.push(local, name, compressed)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(0x0314, 4); header.writeUInt16LE(20, 6)
    header.writeUInt16LE(entry.encrypted ? 1 : 0, 8); header.writeUInt16LE(entry.deflate ? 8 : 0, 10)
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(compressed.length, 20); header.writeUInt32LE(data.length, 24)
    header.writeUInt16LE(name.length, 28); header.writeUInt32LE(((entry.mode || 0x81a4) * 65536) >>> 0, 38); header.writeUInt32LE(offset, 42)
    central.push(header, name); offset += local.length + name.length + compressed.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
module.exports = { makeZip }
