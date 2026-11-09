const NULL_INDEX = 0xffffffff;
const DIGITS32 = '0123456789ABCDEFGHIJKLMNOPQRSTUV';

function readU16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes, offset) {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>>
    0
  );
}

function readU32LE(bytes, offset) {
  return (
    (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>>
    0
  );
}

function writeU16(bytes, offset, value) {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function writeU32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function u32Bytes(value) {
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function bytesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function imageKind(bytes) {
  if (!bytes || bytes.length < 8) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif';
  return null;
}

function isFontRecord(bytes) {
  return bytes && bytes.length >= 4 && bytes[0] === 0x46 && bytes[1] === 0x4f && bytes[2] === 0x4e && bytes[3] === 0x54;
}

function recordTag(bytes) {
  if (!bytes || bytes.length < 4) return '';
  return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
}

function isResourceRecord(bytes) {
  return Boolean(imageKind(bytes) || isFontRecord(bytes));
}

function base32_4(num) {
  const n = num >>> 0;
  return (
    DIGITS32[(n / 32768) % 32] +
    DIGITS32[(n / 1024) % 32] +
    DIGITS32[(n / 32) % 32] +
    DIGITS32[n % 32]
  );
}

export function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function joinPath(dir, href) {
  const raw = decodeXml(href).split('#')[0].replace(/\\/g, '/');
  if (!raw) return '';
  if (raw.startsWith('/')) return raw.replace(/^\/+/, '');
  const parts = dir ? dir.split('/').filter(Boolean) : [];
  for (const segment of raw.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment && segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findEocd(data) {
  const min = Math.max(0, data.length - 22 - 65535);
  for (let i = data.length - 22; i >= min; i--) {
    if (data[i] === 0x50 && data[i + 1] === 0x4b && data[i + 2] === 0x05 && data[i + 3] === 0x06) {
      return i;
    }
  }
  return -1;
}

export async function readZip(buffer) {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const eocd = findEocd(data);
  if (eocd < 0) throw new Error('Not a zip/epub archive');
  const count = readU16LE(data, eocd + 10);
  let offset = readU32LE(data, eocd + 16);
  const files = new Map();

  for (let i = 0; i < count; i++) {
    if (readU32LE(data, offset) !== 0x02014b50) break;
    const method = readU16LE(data, offset + 10);
    const compSize = readU32LE(data, offset + 20);
    const nameLen = readU16LE(data, offset + 28);
    const extraLen = readU16LE(data, offset + 30);
    const commentLen = readU16LE(data, offset + 32);
    const localOff = readU32LE(data, offset + 42);
    const name = new TextDecoder('utf-8').decode(data.subarray(offset + 46, offset + 46 + nameLen)).replace(/\\/g, '/');
    const localNameLen = readU16LE(data, localOff + 26);
    const localExtraLen = readU16LE(data, localOff + 28);
    const payloadOff = localOff + 30 + localNameLen + localExtraLen;
    const payload = data.subarray(payloadOff, payloadOff + compSize);
    let content = null;
    try {
      if (method === 0) content = payload.slice();
      else if (method === 8) content = await inflateRaw(payload);
    } catch {
      content = null;
    }
    if (content) files.set(name.replace(/^\/+/, ''), content);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

export function zipGet(files, path) {
  if (files.has(path)) return files.get(path);
  const lower = path.toLowerCase();
  for (const [name, data] of files) {
    if (name.toLowerCase() === lower) return data;
  }
  const base = path.split('/').pop();
  for (const [name, data] of files) {
    if (name.split('/').pop() === base) return data;
  }
  return null;
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function extractCoverHrefFromOpf(opfXml) {
  const items = [...opfXml.matchAll(/<item\b[^>]*>/gi)].map((m) => m[0]);
  const byId = new Map();
  for (const item of items) {
    const id = attr(item, 'id');
    if (id) byId.set(id, item);
  }

  const metaCover = opfXml.match(/<meta\b[^>]*name=["']cover["'][^>]*>/i) || opfXml.match(/<meta\b[^>]*content=["'][^"']+["'][^>]*name=["']cover["'][^>]*>/i);
  if (metaCover) {
    const id = attr(metaCover[0], 'content');
    const item = byId.get(id);
    if (item && attr(item, 'href')) return attr(item, 'href');
  }

  for (const item of items) {
    const props = attr(item, 'properties');
    if (/\bcover-image\b/i.test(props) && attr(item, 'href')) return attr(item, 'href');
  }

  for (const item of items) {
    const id = attr(item, 'id');
    const type = attr(item, 'media-type');
    if (/cover/i.test(id) && /^image\//i.test(type) && attr(item, 'href')) return attr(item, 'href');
  }

  const guide = opfXml.match(/<reference\b[^>]*type=["']cover["'][^>]*>/i);
  if (guide && attr(guide[0], 'href')) return attr(guide[0], 'href');
  return '';
}

function largestImage(files) {
  let best = null;
  for (const [name, data] of files) {
    if (!imageKind(data)) continue;
    if (!best || data.length > best.length) best = data;
  }
  return best;
}

export async function extractCoverFromEpub(bytes) {
  const files = await readZip(bytes);
  const container = zipGet(files, 'META-INF/container.xml');
  if (!container) return largestImage(files);
  const xml = new TextDecoder('utf-8').decode(container);
  const opfPathMatch = xml.match(/full-path=["']([^"']+)["']/i);
  if (!opfPathMatch) return largestImage(files);
  const opfPath = decodeXml(opfPathMatch[1]).replace(/\\/g, '/');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const opfBytes = zipGet(files, opfPath);
  if (!opfBytes) return largestImage(files);
  const opfXml = new TextDecoder('utf-8').decode(opfBytes);
  const href = extractCoverHrefFromOpf(opfXml);
  if (href) {
    const resolved = joinPath(opfDir, href);
    const direct = zipGet(files, resolved);
    if (direct && imageKind(direct)) return direct;
    if (direct && !imageKind(direct)) {
      const html = new TextDecoder('utf-8').decode(direct);
      const img = html.match(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/i);
      if (img) {
        const htmlDir = resolved.includes('/') ? resolved.slice(0, resolved.lastIndexOf('/')) : opfDir;
        const fromHtml = zipGet(files, joinPath(htmlDir, img[1]));
        if (fromHtml && imageKind(fromHtml)) return fromHtml;
      }
    }
  }
  return largestImage(files);
}

function parsePalm(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const nrec = readU16(bytes, 76);
  const records = [];
  for (let i = 0; i < nrec; i++) {
    const start = readU32(bytes, 78 + 8 * i);
    const end = i + 1 < nrec ? readU32(bytes, 78 + 8 * (i + 1)) : bytes.length;
    records.push(bytes.slice(start, end));
  }
  return { header: bytes.slice(0, 76), records };
}

function buildPalm(header, records) {
  const nrec = records.length;
  const dirSize = 78 + 8 * nrec + 2;
  let offset = dirSize;
  const offsets = [];
  for (const rec of records) {
    offsets.push(offset);
    offset += rec.length;
  }
  const out = new Uint8Array(offset);
  out.set(header.subarray(0, 76), 0);
  writeU16(out, 76, nrec);
  writeU32(out, 68, (2 * nrec - 1) >>> 0);
  for (let i = 0; i < nrec; i++) {
    writeU32(out, 78 + 8 * i, offsets[i]);
    const id = 2 * i;
    out[78 + 8 * i + 4] = 0;
    out[78 + 8 * i + 5] = (id >>> 16) & 0xff;
    out[78 + 8 * i + 6] = (id >>> 8) & 0xff;
    out[78 + 8 * i + 7] = id & 0xff;
  }
  let pos = dirSize;
  for (const rec of records) {
    out.set(rec, pos);
    pos += rec.length;
  }
  return out;
}

function parseExth(rec0) {
  if (rec0[16] !== 0x4d || rec0[17] !== 0x4f || rec0[18] !== 0x42 || rec0[19] !== 0x49) {
    throw new Error('MOBI header missing');
  }
  const headerLen = readU32(rec0, 20);
  let exthAt = 16 + headerLen;
  const looksLikeExth = (at) =>
    rec0[at] === 0x45 && rec0[at + 1] === 0x58 && rec0[at + 2] === 0x54 && rec0[at + 3] === 0x48;
  if (!looksLikeExth(exthAt)) {
    exthAt = -1;
    for (let i = 16; i < rec0.length - 4; i++) {
      if (looksLikeExth(i)) {
        exthAt = i;
        break;
      }
    }
  }
  if (exthAt < 0) throw new Error('EXTH header missing');
  const count = readU32(rec0, exthAt + 8);
  const records = [];
  let p = exthAt + 12;
  for (let i = 0; i < count; i++) {
    const type = readU32(rec0, p);
    const length = readU32(rec0, p + 4);
    records.push({ type, data: rec0.slice(p + 8, p + length) });
    p += length;
  }
  const titleOffset = readU32(rec0, 84);
  const titleLength = readU32(rec0, 88);
  const title = rec0.slice(titleOffset, titleOffset + titleLength);
  return { headerLen, exthAt, records, title };
}

function buildExth(records) {
  const content = [u32Bytes(records.length)];
  let contentLen = 4;
  for (const rec of records) {
    const recLen = 8 + rec.data.length;
    content.push(u32Bytes(rec.type), u32Bytes(recLen), rec.data);
    contentLen += recLen;
  }
  while (contentLen % 4 !== 0) {
    content.push(Uint8Array.of(0));
    contentLen += 1;
  }
  const length = 8 + contentLen;
  const out = new Uint8Array(length);
  out.set([0x45, 0x58, 0x54, 0x48], 0);
  writeU32(out, 4, length);
  let pos = 8;
  for (const part of content) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

function upsertExth(records, type, data) {
  const next = records.filter((rec) => rec.type !== type);
  next.push({ type, data });
  return next;
}

function patchRecord0(rec0, mutator) {
  const parsed = parseExth(rec0);
  const nextRecords = mutator(parsed.records.slice());
  const exth = buildExth(nextRecords);
  const titleOffset = 16 + parsed.headerLen + exth.length;
  const needed = titleOffset + parsed.title.length;
  const out = new Uint8Array(Math.max(rec0.length, needed + 16));
  out.set(rec0.subarray(0, parsed.exthAt));
  out.set(exth, parsed.exthAt);
  out.set(parsed.title, titleOffset);
  writeU32(out, 84, titleOffset);
  writeU32(out, 88, parsed.title.length);
  return out;
}

function firstResourceIndex(rec0) {
  return readU32(rec0, 108);
}

function setFirstResourceIndex(rec0, value) {
  writeU32(rec0, 108, value);
}

function resourceRange(records, firstRes) {
  if (firstRes === NULL_INDEX || firstRes >= records.length) {
    const fdst = records.findIndex((rec) => recordTag(rec) === 'FDST');
    return { start: fdst < 0 ? records.length - 4 : fdst, count: 0 };
  }
  let count = 0;
  for (let i = firstRes; i < records.length; i++) {
    if (!isResourceRecord(records[i])) break;
    count += 1;
  }
  return { start: firstRes, count };
}

function extractCoverFromMobi(bytes) {
  const palm = parsePalm(bytes);
  const rec0 = palm.records[0];
  let offset = null;
  try {
    const exth = parseExth(rec0);
    const rec = exth.records.find((item) => item.type === 201);
    if (rec && rec.data.length >= 4) offset = readU32(rec.data, 0);
  } catch {
    offset = null;
  }
  const firstRes = firstResourceIndex(rec0);
  if (offset !== null && firstRes !== NULL_INDEX) {
    const idx = firstRes + offset;
    if (palm.records[idx] && imageKind(palm.records[idx])) return palm.records[idx];
  }
  let best = null;
  for (const rec of palm.records) {
    if (!imageKind(rec)) continue;
    if (!best || rec.length > best.length) best = rec;
  }
  return best;
}

function uniqueAsin(bytes) {
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(bytes.length / 4096));
  for (let i = 0; i < bytes.length; i += step) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  hash ^= bytes.length;
  return `B0${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`.slice(0, 10);
}

/**
 * Copy the source cover into the converted AZW3 and tag EXTH 201/202/129
 * so Kindle/Calibre treat it as the book cover.
 */
export async function ensureAzw3Cover(sourceBytes, sourceFormat, azw3Bytes) {
  let cover = null;
  try {
    if (sourceFormat === 'epub') cover = await extractCoverFromEpub(sourceBytes);
    else cover = extractCoverFromMobi(sourceBytes);
  } catch {
    cover = null;
  }

  const palm = parsePalm(azw3Bytes);
  let rec0 = Uint8Array.from(palm.records[0]);
  palm.records[0] = rec0;

  let firstRes = firstResourceIndex(rec0);
  const hadResources = firstRes !== NULL_INDEX;
  let range = resourceRange(palm.records, firstRes);
  const imageBase = hadResources ? firstRes : range.start;

  let coverOffset = -1;
  if (cover) {
    if (hadResources) {
      for (let i = 0; i < range.count; i++) {
        if (bytesEqual(palm.records[imageBase + i], cover)) {
          coverOffset = i;
          break;
        }
      }
    }
    if (coverOffset < 0) {
      const insertAt = range.start + range.count;
      palm.records.splice(insertAt, 0, Uint8Array.from(cover));
      if (!hadResources) {
        firstRes = insertAt;
        coverOffset = 0;
      } else {
        coverOffset = insertAt - firstRes;
      }
      range = resourceRange(palm.records, firstRes === NULL_INDEX ? insertAt : firstRes);
    }
  } else if (hadResources) {
    let bestIdx = -1;
    let bestLen = 0;
    for (let i = 0; i < range.count; i++) {
      const rec = palm.records[firstRes + i];
      if (imageKind(rec) && rec.length > bestLen) {
        bestLen = rec.length;
        bestIdx = i;
      }
    }
    coverOffset = bestIdx;
  }

  if (coverOffset < 0) return azw3Bytes;
  if (firstRes === NULL_INDEX) return azw3Bytes;

  const imageCount = resourceRange(palm.records, firstRes).count;
  rec0 = patchRecord0(palm.records[0], (records) => {
    let next = records;
    next = upsertExth(next, 201, u32Bytes(coverOffset));
    next = upsertExth(next, 202, u32Bytes(coverOffset));
    next = upsertExth(next, 203, u32Bytes(0));
    next = upsertExth(next, 129, new TextEncoder().encode(`kindle:embed:${base32_4(coverOffset)}`));
    next = upsertExth(next, 125, u32Bytes(imageCount));
    next = upsertExth(next, 113, new TextEncoder().encode(uniqueAsin(azw3Bytes)));
    return next;
  });
  setFirstResourceIndex(rec0, firstRes);
  palm.records[0] = rec0;
  return buildPalm(palm.header, palm.records);
}
