/**
 * Minimal ZIP writer (store method, no compression).
 *
 * The Markdown export bundles the document with an `equations/` image folder;
 * a stored ZIP keeps this dependency-free and works offline in every browser.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

export function crc32(bytes) {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) return new Uint8Array(value)
  return new TextEncoder().encode(String(value ?? ''))
}

export function dataUrlToBytes(dataUrl) {
  const value = String(dataUrl ?? '')
  const comma = value.indexOf(',')
  if (comma < 0) return new Uint8Array(0)
  const header = value.slice(0, comma)
  const payload = value.slice(comma + 1)
  if (!/;base64/i.test(header)) return new TextEncoder().encode(decodeURIComponent(payload))
  if (typeof atob !== 'function') return new Uint8Array(0)
  const decoded = atob(payload)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index) & 0xff
  }
  return bytes
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear())
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time: dosTime & 0xffff, date: dosDate & 0xffff }
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value & 0xffff, true)
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true)
}

function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

/**
 * Build a ZIP archive. `entries` is `[{ name, data, date? }]`; `data` may be a
 * string, Uint8Array, or ArrayBuffer.
 */
export function createZip(entries, options = {}) {
  const encoder = new TextEncoder()
  const now = options.date instanceof Date ? options.date : new Date()
  const { time, date } = dosDateTime(now)
  const chunks = []
  const central = []
  let offset = 0

  for (const entry of entries) {
    const name = String(entry?.name ?? '').replace(/^[/\\]+/, '')
    if (name === '') continue
    const nameBytes = encoder.encode(name)
    const data = toBytes(entry.data)
    const crc = crc32(data)
    const local = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(local.buffer)
    writeUint32(localView, 0, 0x04034b50)
    writeUint16(localView, 4, 20)
    writeUint16(localView, 6, 0x0800)
    writeUint16(localView, 8, 0)
    writeUint16(localView, 10, time)
    writeUint16(localView, 12, date)
    writeUint32(localView, 14, crc)
    writeUint32(localView, 18, data.length)
    writeUint32(localView, 22, data.length)
    writeUint16(localView, 26, nameBytes.length)
    writeUint16(localView, 28, 0)
    local.set(nameBytes, 30)
    chunks.push(local, data)

    const header = new Uint8Array(46 + nameBytes.length)
    const headerView = new DataView(header.buffer)
    writeUint32(headerView, 0, 0x02014b50)
    writeUint16(headerView, 4, 20)
    writeUint16(headerView, 6, 20)
    writeUint16(headerView, 8, 0x0800)
    writeUint16(headerView, 10, 0)
    writeUint16(headerView, 12, time)
    writeUint16(headerView, 14, date)
    writeUint32(headerView, 16, crc)
    writeUint32(headerView, 20, data.length)
    writeUint32(headerView, 24, data.length)
    writeUint16(headerView, 28, nameBytes.length)
    writeUint16(headerView, 30, 0)
    writeUint16(headerView, 32, 0)
    writeUint16(headerView, 34, 0)
    writeUint16(headerView, 36, 0)
    writeUint32(headerView, 38, 0)
    writeUint32(headerView, 42, offset)
    header.set(nameBytes, 46)
    central.push(header)

    offset += local.length + data.length
  }

  const centralBytes = concat(central)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  writeUint32(endView, 0, 0x06054b50)
  writeUint16(endView, 4, 0)
  writeUint16(endView, 6, 0)
  writeUint16(endView, 8, central.length)
  writeUint16(endView, 10, central.length)
  writeUint32(endView, 12, centralBytes.length)
  writeUint32(endView, 16, offset)
  writeUint16(endView, 20, 0)

  return concat([...chunks, centralBytes, end])
}
