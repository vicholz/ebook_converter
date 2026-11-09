/**
 * MOBI NCX index (INDX + CNCX), laid out the way boko and Kindle read it.
 * Tag values are the MOBI6 TOC fields: text offset, length, label, depth, and parent.
 */

const encoder = new TextEncoder();
const CNCX_RECORD_LIMIT = 0xfbf8;
const MAX_RECORD = 0x10000;

function u16(n) {
  return Uint8Array.of((n >>> 8) & 0xff, n & 0xff);
}

function u32(n) {
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

function writeU32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function concat(parts) {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function align4(bytes) {
  const pad = (4 - (bytes.length % 4)) % 4;
  if (!pad) return bytes;
  const out = new Uint8Array(bytes.length + pad);
  out.set(bytes);
  return out;
}

function encint(value) {
  const val = value >>> 0;
  if (val === 0) return Uint8Array.of(0x80);
  const bytes = [];
  let v = val;
  while (v > 0) {
    bytes.push(v & 0x7f);
    v >>>= 7;
  }
  bytes[0] |= 0x80;
  bytes.reverse();
  return Uint8Array.from(bytes);
}

function idxtSize(entryCount) {
  return (4 + 2 * (entryCount + 1) + 3) & ~3;
}

const NCX_TAGS = [
  { tag: 1, values: 1, mask: 0x01, eof: 0 },
  { tag: 2, values: 1, mask: 0x02, eof: 0 },
  { tag: 3, values: 1, mask: 0x04, eof: 0 },
  { tag: 4, values: 1, mask: 0x08, eof: 0 },
  { tag: 21, values: 1, mask: 0x10, eof: 0 },
  { tag: 22, values: 1, mask: 0x20, eof: 0 },
  { tag: 23, values: 1, mask: 0x40, eof: 0 },
  { tag: 6, values: 2, mask: 0x80, eof: 0 },
  { tag: 0, values: 0, mask: 0x00, eof: 1 },
];

function buildTagx() {
  const size = 12 + 4 * NCX_TAGS.length;
  const bytes = [0x54, 0x41, 0x47, 0x58, ...u32(size), ...u32(1)];
  for (const tag of NCX_TAGS) bytes.push(tag.tag, tag.values, tag.mask, tag.eof);
  return Uint8Array.from(bytes);
}

function buildCncx(labels) {
  const records = [];
  let current = [];
  const offsets = [];
  for (const label of labels) {
    const bytes = encoder.encode(label);
    const prefix = encint(bytes.length);
    const rawLen = prefix.length + bytes.length;
    if (rawLen > CNCX_RECORD_LIMIT) {
      throw new Error('A table-of-contents label is too long to store.');
    }
    if (current.length + rawLen > CNCX_RECORD_LIMIT) {
      records.push(align4(Uint8Array.from(current)));
      current = [];
    }
    offsets.push(records.length * 0x10000 + current.length);
    current.push(...prefix, ...bytes);
  }
  if (current.length) records.push(align4(Uint8Array.from(current)));
  if (!records.length) records.push(new Uint8Array(4));
  return { records, offsets };
}

function tagDataFor(entry, labelOffset) {
  let ctrl = 0x0f;
  const hasParent = entry.parent >= 0;
  const hasFirst = entry.firstChild >= 0;
  const hasLast = entry.lastChild >= 0;
  if (hasParent) ctrl |= 0x10;
  if (hasFirst) ctrl |= 0x20;
  if (hasLast) ctrl |= 0x40;
  const parts = [Uint8Array.of(ctrl), encint(entry.pos >>> 0), encint(entry.length >>> 0), encint(labelOffset >>> 0), encint(entry.depth >>> 0)];
  if (hasParent) parts.push(encint(entry.parent >>> 0));
  if (hasFirst) parts.push(encint(entry.firstChild >>> 0));
  if (hasLast) parts.push(encint(entry.lastChild >>> 0));
  return concat(parts);
}

function buildEntries(entries) {
  const data = [];
  const offsets = [];
  for (const entry of entries) {
    offsets.push(192 + data.length);
    const name = encoder.encode(entry.name);
    if (name.length > 255) throw new Error('A table-of-contents entry name is too long.');
    data.push(name.length, ...name, ...entry.tagData);
  }
  return { data: Uint8Array.from(data), offsets };
}

function buildIdxt(offsets, entryDataLen) {
  const bytes = [0x49, 0x44, 0x58, 0x54];
  for (const offset of offsets) bytes.push(...u16(offset));
  const end = 192 + entryDataLen;
  bytes.push(...u16(end));
  return align4(Uint8Array.from(bytes));
}

function buildDataRecord(entryCount, entryData, idxt) {
  const record = new Uint8Array(192 + entryData.length + idxt.length);
  record.set([0x49, 0x4e, 0x44, 0x58], 0);
  writeU32(record, 4, 192);
  writeU32(record, 12, 1);
  writeU32(record, 20, 192 + entryData.length);
  writeU32(record, 24, entryCount);
  record.fill(0xff, 28, 36);
  record.set(entryData, 192);
  record.set(idxt, 192 + entryData.length);
  return align4(record);
}

function buildHeader(totalEntries, numCncx, lastIndices) {
  const tagx = align4(buildTagx());
  const geometry = [];
  const geomStart = 192 + tagx.length;
  const idxtEntries = [];
  for (const item of lastIndices) {
    idxtEntries.push(geomStart + geometry.length);
    const name = encoder.encode(item.name);
    geometry.push(name.length, ...name, (item.count >>> 8) & 0xff, item.count & 0xff);
  }
  const geometryBytes = align4(Uint8Array.from(geometry));
  const idxtInner = [0x49, 0x44, 0x58, 0x54];
  for (const offset of idxtEntries) idxtInner.push(...u16(offset));
  const idxtBytes = align4(Uint8Array.from(idxtInner));
  const idxtBlockOffset = 192 + tagx.length + geometryBytes.length;
  const header = new Uint8Array(192);
  header.set([0x49, 0x4e, 0x44, 0x58], 0);
  writeU32(header, 4, 192);
  writeU32(header, 16, 2);
  writeU32(header, 20, idxtBlockOffset);
  writeU32(header, 24, lastIndices.length);
  writeU32(header, 28, 65001);
  writeU32(header, 32, 0xffffffff);
  writeU32(header, 36, totalEntries);
  writeU32(header, 52, numCncx);
  writeU32(header, 180, 192);
  return concat([header, tagx, geometryBytes, idxtBytes]);
}

/**
 * @param {{pos: number, length: number, label: string, depth: number, parent: number, firstChild: number, lastChild: number}[]} entries
 * @returns {Uint8Array[]} INDX header, INDX data records, then CNCX records
 */
export function buildNcxIndx(entries) {
  if (!entries.length) return [];
  const labels = entries.map((entry) => entry.label || 'Section');
  const { records: cncx, offsets } = buildCncx(labels);
  const encoded = entries.map((entry, index) => ({
    name: String(index).padStart(4, '0'),
    tagData: tagDataFor(entry, offsets[index] || 0),
  }));

  const ranges = [];
  let start = 0;
  let length = 0;
  let count = 0;
  for (let i = 0; i < encoded.length; i++) {
    const size = 1 + encoder.encode(encoded[i].name).length + encoded[i].tagData.length;
    if (192 + size + idxtSize(1) > MAX_RECORD) {
      throw new Error('A table-of-contents entry is too large to store.');
    }
    if (count > 0 && 192 + length + size + idxtSize(count + 1) > MAX_RECORD) {
      ranges.push([start, i]);
      start = i;
      length = 0;
      count = 0;
    }
    length += size;
    count += 1;
  }
  ranges.push([start, encoded.length]);

  const dataRecords = [];
  const lastIndices = [];
  for (const [from, to] of ranges) {
    const slice = encoded.slice(from, to);
    const built = buildEntries(slice);
    const idxt = buildIdxt(built.offsets, built.data.length);
    dataRecords.push(buildDataRecord(slice.length, built.data, idxt));
    lastIndices.push({ name: slice[slice.length - 1].name, count: slice.length });
  }

  return [buildHeader(encoded.length, cncx.length, lastIndices), ...dataRecords, ...cncx];
}
