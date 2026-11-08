import assert from 'node:assert/strict'
import test from 'node:test'
import { crc32, createZip, dataUrlToBytes } from '../src/zip.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

test('writes a readable stored ZIP with a central directory', () => {
  const markdown = '# Paper\n\nEquation (1)\n'
  const image = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])
  const bytes = createZip(
    [
      { name: 'paper-bilingual.md', data: markdown },
      { name: 'equations/page4-equation1.png', data: image },
    ],
    { date: new Date(2024, 0, 2, 3, 4, 6) },
  )
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(view.getUint32(0, true), 0x04034b50)

  const end = bytes.length - 22
  assert.equal(view.getUint32(end, true), 0x06054b50)
  assert.equal(view.getUint16(end + 10, true), 2)
  const centralOffset = view.getUint32(end + 16, true)
  assert.equal(view.getUint32(centralOffset, true), 0x02014b50)

  const firstNameLength = view.getUint16(centralOffset + 28, true)
  const firstName = decoder.decode(
    bytes.slice(centralOffset + 46, centralOffset + 46 + firstNameLength),
  )
  assert.equal(firstName, 'paper-bilingual.md')
  assert.equal(view.getUint32(centralOffset + 16, true), crc32(encoder.encode(markdown)))

  const localOffset = view.getUint32(centralOffset + 42, true)
  assert.equal(view.getUint32(localOffset, true), 0x04034b50)
  const localNameLength = view.getUint16(localOffset + 26, true)
  const localExtraLength = view.getUint16(localOffset + 28, true)
  const dataStart = localOffset + 30 + localNameLength + localExtraLength
  assert.equal(
    decoder.decode(bytes.slice(dataStart, dataStart + markdown.length)),
    markdown,
  )

  const secondCentral =
    centralOffset +
    46 +
    firstNameLength +
    view.getUint16(centralOffset + 30, true) +
    view.getUint16(centralOffset + 32, true)
  assert.equal(view.getUint32(secondCentral, true), 0x02014b50)
  const secondNameLength = view.getUint16(secondCentral + 28, true)
  const secondName = decoder.decode(
    bytes.slice(secondCentral + 46, secondCentral + 46 + secondNameLength),
  )
  assert.equal(secondName, 'equations/page4-equation1.png')
  const secondLocal = view.getUint32(secondCentral + 42, true)
  const secondData =
    secondLocal +
    30 +
    view.getUint16(secondLocal + 26, true) +
    view.getUint16(secondLocal + 28, true)
  assert.deepEqual(
    [...bytes.slice(secondData, secondData + image.length)],
    [...image],
  )
})

test('decodes image data URLs into bytes', () => {
  const bytes = dataUrlToBytes('data:image/png;base64,AQIDBA==')
  assert.deepEqual([...bytes], [1, 2, 3, 4])
  assert.equal(crc32(new Uint8Array([1, 2, 3, 4])), 0xb63cfbcd)
})
