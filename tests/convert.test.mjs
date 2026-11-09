import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import init from '../vendor/boko/boko.js';
import { convertBook } from '../js/convert.js';
import { friendlyConvertError } from '../js/errors.js';
import { FORMAT_BY_EXT, OUTPUT_FORMATS } from '../js/formats.js';
import { palmdocCompress, palmdocDecompress } from '../js/palmdoc.js';

const PHRASE_A = 'Chapter one unique phrase ALPHA-QUILL';
const PHRASE_B = 'Chapter two unique phrase BETA-QUILL';
const UNICODE = 'Café “harbor” — naïve';
const TITLE = 'Probe Harbor';
const AUTHOR = 'Ada Kindle';

test('PalmDOC compression round-trips text and the space shortcut', () => {
  assert.deepEqual(Buffer.from(palmdocCompress(Buffer.from(' A'))), Buffer.from([0xc1]));
  const samples = [
    Buffer.from(''),
    Buffer.from('Hello harbor'),
    Buffer.from(`${PHRASE_A} ${UNICODE} ${'harbor '.repeat(800)}`),
    Buffer.from(Array.from({ length: 300 }, (_, i) => i % 256)),
  ];
  for (const sample of samples) {
    const back = palmdocDecompress(palmdocCompress(sample));
    assert.deepEqual(Buffer.from(back), Buffer.from(sample));
  }
});

test('accepted inputs include AZW3 and outputs name real extensions', () => {
  assert.equal(FORMAT_BY_EXT.azw3, 'azw3');
  assert.equal(FORMAT_BY_EXT.prc, 'mobi');
  assert.equal(FORMAT_BY_EXT.azw, 'mobi');
  assert.equal(OUTPUT_FORMATS.mobi.extension, 'mobi');
  assert.equal(OUTPUT_FORMATS.epub.mime, 'application/epub+zip');
  assert.equal(OUTPUT_FORMATS.azw3.mime, 'application/x-mobi8-ebook');
  assert.match(friendlyConvertError(new Error('file is DRM-protected; boko does not decrypt')), /DRM-protected/);
});

test('EPUB, AZW3, and MOBI conversions keep text, cover, pictures, and chapters', async () => {
  await init({ module_or_path: readFileSync(new URL('../vendor/boko/boko_bg.wasm', import.meta.url)) });
  const jpeg = markerJpeg('COVER-MARKER-HARBOR');
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8ffff3f0005fe02fe9b3c2b8e0000000049454e44ae426082',
    'hex',
  );
  const epub = buildEpub({ jpeg, png });

  const azw3 = await convertBook(epub, 'epub', 'azw3', { name: 'probe.epub' });
  assert.equal(azw3.info.title, TITLE);
  assert.deepEqual(azw3.info.authors, [AUTHOR]);
  assert.ok(azw3.info.chapters >= 2);
  assert.ok(Buffer.from(azw3.bytes).includes(Buffer.from('BOOKMOBI')));
  assert.notEqual(Buffer.from(azw3.bytes.subarray(0, 2)).toString('latin1'), 'PK');
  assert.ok(Buffer.from(azw3.bytes).includes(jpeg), 'AZW3 output should contain the source cover bytes');
  assert.notDeepEqual(Buffer.from(azw3.bytes), epub);

  const fromAzw3 = await convertBook(azw3.bytes, 'azw3', 'epub', { name: 'probe.azw3' });
  const epubFiles = unzip(fromAzw3.bytes);
  const epubText = [...epubFiles.values()].map((file) => file.toString('utf8')).join('\n');
  assert.equal(epubFiles.get('mimetype').toString(), 'application/epub+zip');
  assert.match(epubText, new RegExp(PHRASE_A));
  assert.match(epubText, new RegExp(PHRASE_B));
  assert.match(epubText, /Café/);
  assert.match(epubText, /Arrival/);
  assert.match(epubText, /Departure/);
  assert.match(epubText, new RegExp(TITLE));
  assert.match(epubText, new RegExp(AUTHOR));
  assert.ok([...epubFiles.values()].some((file) => file.includes(png)));
  assert.ok([...epubFiles.values()].some((file) => file.includes(jpeg)));
  assert.equal(fromAzw3.info.title, TITLE);

  const mobi = await convertBook(azw3.bytes, 'azw3', 'mobi', { name: 'probe.azw3' });
  assert.notDeepEqual(Buffer.from(mobi.bytes), Buffer.from(azw3.bytes));
  assert.equal(mobi.info.title, TITLE);
  assert.deepEqual(mobi.info.authors, [AUTHOR]);
  assert.ok(mobi.info.chapters >= 2, `expected multiple MOBI chapters, got ${mobi.info && mobi.info.chapters}`);
  assert.ok(mobi.info.toc_entries >= 2, `expected MOBI contents entries, got ${mobi.info && mobi.info.toc_entries}`);
  const parsed = parseMobi(mobi.bytes);
  assert.equal(parsed.compression, 2);
  assert.equal(parsed.encryption, 0);
  assert.equal(parsed.creator, 'BOOKMOBI');
  assert.match(parsed.text, new RegExp(PHRASE_A));
  assert.match(parsed.text, new RegExp(PHRASE_B));
  assert.match(parsed.text, /Café/);
  assert.match(parsed.text, /Contents/);
  assert.match(parsed.text, /Arrival/);
  assert.match(parsed.text, /Departure/);
  assert.equal(parsed.exth.get(503).toString('utf8'), TITLE);
  assert.equal(parsed.exth.get(100).toString('utf8'), AUTHOR);
  assert.equal(parsed.exth.get(201).readUInt32BE(0), 0);
  assert.ok(parsed.images.some((image) => image.includes(png)));
  assert.ok(parsed.images.some((image) => image.includes(jpeg)));
  assert.ok(parsed.textRecords > 1, 'long chapter should span more than one MOBI text record');
  assert.notEqual(parsed.ncxIndex, 0xffffffff);
  assert.equal(parsed.records[parsed.ncxIndex].subarray(0, 4).toString('latin1'), 'INDX');

  const mobiRoundtrip = await convertBook(mobi.bytes, 'mobi', 'epub', { name: 'probe.mobi' });
  const roundFiles = unzip(mobiRoundtrip.bytes);
  const roundText = [...roundFiles.values()].map((file) => file.toString('utf8')).join('\n');
  assert.match(roundText, new RegExp(PHRASE_A));
  assert.match(roundText, new RegExp(PHRASE_B));
  assert.match(roundText, /Arrival/);
  assert.match(roundText, /Departure/);
  assert.ok([...roundFiles.values()].some((file) => file.includes(png)));

  const azw3FromMobi = await convertBook(mobi.bytes, 'mobi', 'azw3', { name: 'probe.mobi' });
  assert.equal(azw3FromMobi.info.title, TITLE);
  assert.ok(Buffer.from(azw3FromMobi.bytes).includes(Buffer.from('BOOKMOBI')));
  const azw3Text = [...unzip((await convertBook(azw3FromMobi.bytes, 'azw3', 'epub')).bytes).values()]
    .map((file) => file.toString('utf8'))
    .join('\n');
  assert.match(azw3Text, new RegExp(PHRASE_A));
  assert.match(azw3Text, new RegExp(PHRASE_B));
});

test('empty and unknown targets fail before writing a file', async () => {
  await assert.rejects(() => convertBook(new Uint8Array(), 'epub', 'azw3'), /empty/);
  await assert.rejects(() => convertBook(Uint8Array.of(1, 2, 3), 'epub', 'kfx'), /AZW3, EPUB, or MOBI/);
});

function markerJpeg(text) {
  const comment = Buffer.from(text);
  const len = comment.length + 2;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xfe, (len >> 8) & 255, len & 255]),
    comment,
    Buffer.from([0xff, 0xd9]),
  ]);
}

function u16(n) {
  return Buffer.from([n & 255, (n >>> 8) & 255]);
}

function u32(n) {
  return Buffer.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) c = (c >>> 8) ^ CRC[(c ^ byte) & 255];
  return ~c >>> 0;
}

const CRC = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[i] = c >>> 0;
}

function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const method = file.store ? 0 : 8;
    const payload = method === 0 ? data : deflateRawSync(data);
    const flags = file.store ? 0 : 0x800;
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0),
      u32(crc32(data)), u32(payload.length), u32(data.length),
      u16(name.length), u16(0), name, payload,
    ]);
    parts.push(local);
    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(flags), u16(method), u16(0), u16(0),
      u32(crc32(data)), u32(payload.length), u32(data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(directory.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...parts, directory, end]);
}

function unzip(bytes) {
  const data = Buffer.from(bytes);
  let eocd = -1;
  for (let i = data.length - 22; i >= 0; i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    const method = data.readUInt16LE(offset + 10);
    const compSize = data.readUInt32LE(offset + 20);
    const nameLen = data.readUInt16LE(offset + 28);
    const extraLen = data.readUInt16LE(offset + 30);
    const commentLen = data.readUInt16LE(offset + 32);
    const localOff = data.readUInt32LE(offset + 42);
    const name = data.subarray(offset + 46, offset + 46 + nameLen).toString();
    const localNameLen = data.readUInt16LE(localOff + 26);
    const localExtraLen = data.readUInt16LE(localOff + 28);
    const payloadOff = localOff + 30 + localNameLen + localExtraLen;
    const payload = data.subarray(payloadOff, payloadOff + compSize);
    files.set(name, method === 0 ? Buffer.from(payload) : inflateRawSync(payload));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function buildEpub({ jpeg, png }) {
  const long = `${'harbor '.repeat(900)}tail`;
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:probe-harbor</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:creator>${AUTHOR}</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>Quill Press</dc:publisher>
    <dc:description>A short harbor story.</dc:description>
    <meta name="cover" content="coverimg"/>
  </metadata>
  <manifest>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="coverimg" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="pic" href="pic.png" media-type="image/png"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`;
  const xhtml = (title, body) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${body}</body></html>`;
  return new Uint8Array(zip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/c1.xhtml', data: xhtml('One', `<h1>Arrival</h1><p>${PHRASE_A}</p><p>${UNICODE}</p><p><b>Bold</b> harbor.</p><img src="pic.png" alt="diagram"/>`) },
    { name: 'OEBPS/c2.xhtml', data: xhtml('Two', `<h1>Departure</h1><p>${PHRASE_B}</p><p>${long}</p>`) },
    { name: 'OEBPS/nav.xhtml', data: xhtml('Contents', '<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol><li><a href="c1.xhtml">Arrival</a></li><li><a href="c2.xhtml">Departure</a></li></ol></nav>') },
    { name: 'OEBPS/toc.ncx', data: `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:probe-harbor"/></head><docTitle><text>${TITLE}</text></docTitle><navMap><navPoint id="n1" playOrder="1"><navLabel><text>Arrival</text></navLabel><content src="c1.xhtml"/></navPoint><navPoint id="n2" playOrder="2"><navLabel><text>Departure</text></navLabel><content src="c2.xhtml"/></navPoint></navMap></ncx>` },
    { name: 'OEBPS/cover.jpg', data: jpeg },
    { name: 'OEBPS/pic.png', data: png },
  ]));
}

function readU16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function parseMobi(bytes) {
  const data = Buffer.from(bytes);
  const count = readU16(data, 76);
  const records = [];
  for (let i = 0; i < count; i++) {
    const start = readU32(data, 78 + 8 * i);
    const end = i + 1 < count ? readU32(data, 78 + 8 * (i + 1)) : data.length;
    records.push(data.subarray(start, end));
  }
  const rec0 = records[0];
  const compression = readU16(rec0, 0);
  const textLength = readU32(rec0, 4);
  const textRecords = readU16(rec0, 8);
  const encryption = readU16(rec0, 12);
  const chunks = [];
  for (let i = 1; i <= textRecords; i++) {
    chunks.push(compression === 2 ? Buffer.from(palmdocDecompress(records[i])) : Buffer.from(records[i]));
  }
  const text = Buffer.concat(chunks).subarray(0, textLength).toString('utf8');
  const headerLength = readU32(rec0, 20);
  const exthAt = 16 + headerLength;
  const exth = new Map();
  if (rec0.subarray(exthAt, exthAt + 4).toString('latin1') === 'EXTH') {
    const recordsInExth = readU32(rec0, exthAt + 8);
    let pos = exthAt + 12;
    for (let i = 0; i < recordsInExth; i++) {
      const type = readU32(rec0, pos);
      const length = readU32(rec0, pos + 4);
      const value = Buffer.from(rec0.subarray(pos + 8, pos + length));
      if (!exth.has(type)) exth.set(type, value);
      pos += length;
    }
  }
  const firstImage = readU32(rec0, 0x6c);
  const images = [];
  if (firstImage !== 0xffffffff) {
    for (let i = firstImage; i < records.length; i++) {
      const rec = records[i];
      const kind = rec[0] === 0xff && rec[1] === 0xd8 || rec[0] === 0x89 && rec[1] === 0x50 || rec[0] === 0x47 && rec[1] === 0x49;
      if (!kind) break;
      images.push(rec);
    }
  }
  return {
    compression,
    encryption,
    text,
    textRecords,
    exth,
    images,
    records,
    ncxIndex: readU32(rec0, 0xf4),
    creator: data.subarray(60, 68).toString('latin1'),
  };
}
