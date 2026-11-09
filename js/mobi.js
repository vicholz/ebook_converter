/**
 * Build a DRM-free MOBI6 book from an EPUB.
 * boko can read MOBI but does not write it, so this emits the PalmDB, PalmDOC
 * text, EXTH metadata, image records, and NCX index in the browser.
 */
import { joinPath, zipGet } from './cover.js';
import { readEpubDocument } from './epubdoc.js';
import { buildNcxIndx } from './indx.js';
import { palmdocCompress } from './palmdoc.js';

const encoder = new TextEncoder();
const FILEPOS = '##########';
const RECORD_SIZE = 4096;
const NULL_INDEX = 0xffffffff;
const DIGITS32 = '0123456789ABCDEFGHIJKLMNOPQRSTUV';

const LOCALES = {
  en: 1033,
  'en-us': 1033,
  'en-gb': 2057,
  fr: 1036,
  de: 1031,
  es: 1034,
  'es-mx': 2058,
  it: 1040,
  pt: 2070,
  'pt-br': 1046,
  nl: 1043,
  pl: 1045,
  ru: 1049,
  ja: 1041,
  ko: 1042,
  zh: 2052,
  'zh-cn': 2052,
  'zh-tw': 1028,
  sv: 1053,
  da: 1030,
  fi: 1035,
  no: 1044,
  nb: 1044,
  cs: 1029,
  hu: 1038,
  tr: 1055,
  ar: 1025,
  he: 1037,
  el: 1032,
  ro: 1048,
  uk: 1058,
  hi: 1081,
  th: 1054,
  vi: 1066,
  id: 1057,
};

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeXml(value) {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => fromCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => fromCode(Number(num)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function fromCode(n) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  return String.fromCodePoint(n);
}

function plain(value, limit = 4000) {
  return decodeXml(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function bytesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
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

function u32(value) {
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
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

function findTagEnd(html, start) {
  let quote = '';
  for (let i = start + 1; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return html.length - 1;
}

function attr(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function tagName(tag) {
  const match = String(tag).match(/^<\/?\s*([a-zA-Z][\w:-]*)/);
  return match ? match[1].toLowerCase() : '';
}

function isClose(tag) {
  return /^<\s*\//.test(tag);
}

function extractBody(html) {
  const lower = html.toLowerCase();
  const bodyAt = lower.indexOf('<body');
  if (bodyAt < 0) return html;
  const start = findTagEnd(html, bodyAt) + 1;
  const end = lower.lastIndexOf('</body>');
  if (end > start) return html.slice(start, end);
  return html.slice(start);
}

const KEEP = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'b', 'i', 'em', 'strong', 'u', 'br', 'hr',
  'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'div', 'span', 'table', 'tr', 'td', 'th',
  'sup', 'sub', 'center', 'big', 'small', 'pre', 'code', 'cite', 'br',
]);
const SKIP = new Set(['script', 'style', 'svg', 'math', 'iframe', 'object', 'video', 'audio', 'head']);
const VOID = new Set(['br', 'hr', 'img']);

function sanitizeBody(html, resolveImage) {
  const body = extractBody(html);
  let out = '';
  let i = 0;
  const skipStack = [];
  while (i < body.length) {
    if (body.startsWith('<!--', i)) {
      const end = body.indexOf('-->', i + 4);
      i = end < 0 ? body.length : end + 3;
      continue;
    }
    if (body.startsWith('<![CDATA[', i)) {
      const end = body.indexOf(']]>', i + 9);
      if (skipStack.length === 0 && end >= 0) out += xmlEscape(body.slice(i + 9, end));
      i = end < 0 ? body.length : end + 3;
      continue;
    }
    if (body[i] !== '<') {
      const next = body.indexOf('<', i);
      const text = body.slice(i, next < 0 ? body.length : next);
      if (skipStack.length === 0) out += text;
      i = next < 0 ? body.length : next;
      continue;
    }
    const end = findTagEnd(body, i);
    const raw = body.slice(i, end + 1);
    i = end + 1;
    const name = tagName(raw);
    if (!name) continue;
    if (isClose(raw)) {
      if (skipStack.length) {
        if (skipStack[skipStack.length - 1] === name) skipStack.pop();
        continue;
      }
      if (KEEP.has(name) && !VOID.has(name)) out += `</${name}>`;
      continue;
    }
    if (SKIP.has(name)) {
      if (!/\/>\s*$/.test(raw)) skipStack.push(name);
      continue;
    }
    if (skipStack.length) continue;
    if (name === 'img') {
      const rec = resolveImage(attr(raw, 'src'));
      if (!rec) continue;
      const alt = attr(raw, 'alt');
      out += `<img recindex="${rec}"${alt ? ` alt="${xmlEscape(alt)}"` : ''}/>`;
      continue;
    }
    if (!KEEP.has(name)) continue;
    if (VOID.has(name)) {
      out += `<${name}/>`;
      continue;
    }
    const id = attr(raw, 'id');
    const idAttr = id ? ` id="${xmlEscape(id)}"` : '';
    if (name === 'a') {
      const href = attr(raw, 'href');
      const safe = /^(https?:|mailto:)/i.test(href) ? ` href="${xmlEscape(href)}"` : '';
      out += `<a${idAttr}${safe}>`;
      continue;
    }
    out += `<${name}${idAttr}>`;
  }
  return out.trim();
}

function firstHeading(html) {
  const match = html.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i);
  return match ? plain(match[1], 180) : '';
}

function resolveToc(nodes, tocDir, chapterIndex) {
  const kept = [];
  for (const node of nodes || []) {
    const children = resolveToc(node.children, tocDir, chapterIndex);
    const { path, fragment } = splitHref(node.href);
    const resolvedPath = path ? joinPath(tocDir, path) : '';
    const index = chapterIndex.get(resolvedPath.toLowerCase());
    if (index === undefined && !children.length) continue;
    kept.push({
      title: plain(node.title, 180) || 'Section',
      href: index === undefined ? children[0].href : node.href,
      fragment: index === undefined ? '' : fragment,
      children,
    });
  }
  return kept;
}

function flattenToc(nodes, depth, parent, out) {
  for (const node of nodes) {
    const index = out.length;
    const entry = {
      title: plain(node.title, 180) || 'Section',
      href: node.href || '',
      depth,
      parent,
      firstChild: -1,
      lastChild: -1,
    };
    out.push(entry);
    if (node.children && node.children.length) {
      const childStart = out.length;
      flattenToc(node.children, depth + 1, index, out);
      entry.firstChild = childStart;
      entry.lastChild = out.length - 1;
    }
  }
  return out;
}

function splitHref(href) {
  const raw = String(href || '').trim();
  const hash = raw.indexOf('#');
  if (hash < 0) return { path: raw, fragment: '' };
  let fragment = raw.slice(hash + 1);
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    /* Keep the raw fragment. */
  }
  return { path: raw.slice(0, hash), fragment };
}

function localeOf(language) {
  const tag = String(language || 'en').trim().toLowerCase().replace(/_/g, '-');
  if (LOCALES[tag]) return LOCALES[tag];
  const primary = tag.split('-')[0];
  return LOCALES[primary] || 1033;
}

function languageTag(language) {
  const tag = String(language || 'en').trim().replace(/_/g, '-');
  return tag || 'en';
}

function asinFor(bytes) {
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(bytes.length / 4096));
  for (let i = 0; i < bytes.length; i += step) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  hash ^= bytes.length;
  return `B0${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`.slice(0, 10);
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

function buildExth(records) {
  const parts = [u32(records.length)];
  for (const rec of records) {
    parts.push(u32(rec.type), u32(8 + rec.data.length), rec.data);
  }
  let contentLen = 0;
  for (const part of parts) contentLen += part.length;
  const headerLen = 8 + contentLen;
  const pad = (4 - (headerLen % 4)) % 4;
  const out = new Uint8Array(headerLen + pad);
  out.set([0x45, 0x58, 0x54, 0x48], 0);
  writeU32(out, 4, headerLen);
  let pos = 8;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

function exthString(type, value) {
  const data = encoder.encode(value);
  return data.length ? { type, data } : null;
}

function buildRecord0(options) {
  const titleBytes = encoder.encode(options.title);
  const exth = buildExth(options.exth);
  const fullNameOffset = 16 + 0xe8 + exth.length;
  const mobi = new Uint8Array(0xe8);
  mobi.set([0x4d, 0x4f, 0x42, 0x49], 0);
  writeU32(mobi, 4, 0xe8);
  writeU32(mobi, 8, 2);
  writeU32(mobi, 12, 65001);
  writeU32(mobi, 16, options.uniqueId);
  writeU32(mobi, 20, 6);
  for (let i = 0; i < 10; i++) writeU32(mobi, 24 + i * 4, NULL_INDEX);
  writeU32(mobi, 64, options.firstNonBook);
  writeU32(mobi, 68, fullNameOffset);
  writeU32(mobi, 72, titleBytes.length);
  writeU32(mobi, 76, options.locale);
  writeU32(mobi, 88, 6);
  writeU32(mobi, 92, options.firstImage);
  writeU32(mobi, 112, 0x50);
  writeU32(mobi, 148, NULL_INDEX);
  writeU32(mobi, 152, NULL_INDEX);
  writeU16(mobi, 176, 1);
  writeU16(mobi, 178, options.lastContent);
  writeU32(mobi, 180, 1);
  writeU32(mobi, 184, options.fcisRecord);
  writeU32(mobi, 188, 1);
  writeU32(mobi, 192, options.flisRecord);
  writeU32(mobi, 196, 1);
  writeU32(mobi, 208, NULL_INDEX);
  writeU32(mobi, 224, 0);
  writeU32(mobi, 228, options.ncxIndex);

  const palm = new Uint8Array(16);
  writeU16(palm, 0, 2);
  writeU32(palm, 4, options.textLength);
  writeU16(palm, 8, options.textRecords);
  writeU16(palm, 10, RECORD_SIZE);
  const tailLen = titleBytes.length + 2;
  const pad = (4 - (tailLen % 4)) % 4;
  const tail = new Uint8Array(tailLen + pad);
  tail.set(titleBytes, 0);
  return concat([palm, mobi, exth, tail]);
}

function flisRecord() {
  const bytes = new Uint8Array(36);
  bytes.set([0x46, 0x4c, 0x49, 0x53], 0);
  writeU32(bytes, 4, 8);
  writeU16(bytes, 8, 65);
  writeU32(bytes, 16, NULL_INDEX);
  writeU16(bytes, 20, 1);
  writeU16(bytes, 22, 3);
  writeU32(bytes, 24, 3);
  writeU32(bytes, 28, 1);
  writeU32(bytes, 32, NULL_INDEX);
  return bytes;
}

function fcisRecord(textLength) {
  const bytes = new Uint8Array(52);
  bytes.set([0x46, 0x43, 0x49, 0x53], 0);
  writeU32(bytes, 4, 20);
  writeU32(bytes, 8, 16);
  writeU32(bytes, 12, 2);
  writeU32(bytes, 20, textLength);
  writeU32(bytes, 28, 40);
  writeU32(bytes, 36, 40);
  writeU32(bytes, 40, 8);
  writeU16(bytes, 44, 1);
  writeU16(bytes, 46, 1);
  return bytes;
}

function buildPalm(name, records) {
  const count = records.length;
  const dirSize = 78 + 8 * count + 2;
  let cursor = dirSize;
  const offsets = records.map((record) => {
    const at = cursor;
    cursor += record.length;
    return at;
  });
  const out = new Uint8Array(cursor);
  const ascii = name.replace(/[^\x20-\x7e]/g, ' ').trim().slice(0, 31) || 'Book';
  encoder.encodeInto(ascii, out);
  const now = (Math.floor(Date.now() / 1000) + 2082844800) >>> 0;
  writeU32(out, 36, now);
  writeU32(out, 40, now);
  out.set([0x42, 0x4f, 0x4f, 0x4b], 60);
  out.set([0x4d, 0x4f, 0x42, 0x49], 64);
  writeU32(out, 68, (2 * count - 1) >>> 0);
  writeU16(out, 76, count);
  for (let i = 0; i < count; i++) {
    writeU32(out, 78 + 8 * i, offsets[i]);
    out[78 + 8 * i + 7] = i & 0xff;
    out[78 + 8 * i + 6] = (i >>> 8) & 0xff;
    out[78 + 8 * i + 5] = (i >>> 16) & 0xff;
  }
  let pos = dirSize;
  for (const record of records) {
    out.set(record, pos);
    pos += record.length;
  }
  return out;
}

function fillFilepos(bytes, values) {
  const needle = encoder.encode(`filepos="${FILEPOS}"`);
  const out = bytes.slice();
  let from = 0;
  for (const value of values) {
    const at = indexOfBytes(out, needle, from);
    if (at < 0) throw new Error('Could not place a table-of-contents link.');
    const digits = encoder.encode(String(value >>> 0).padStart(10, '0'));
    out.set(digits, at + 'filepos="'.length);
    from = at + needle.length;
  }
  return out;
}

function indexOfBytes(haystack, needle, from) {
  outer: for (let i = from; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function sentinelOffset(bytes, marker) {
  return indexOfBytes(bytes, encoder.encode(marker), 0);
}

/**
 * @param {Uint8Array} epubBytes
 * @returns {Promise<Uint8Array>}
 */
export async function epubToMobi(epubBytes) {
  const doc = await readEpubDocument(epubBytes);
  const images = [];
  function addImage(bytes) {
    if (!imageKind(bytes)) return '';
    const existing = images.findIndex((image) => bytesEqual(image, bytes));
    if (existing >= 0) return String(existing + 1).padStart(5, '0');
    images.push(Uint8Array.from(bytes));
    return String(images.length).padStart(5, '0');
  }
  if (doc.cover) addImage(doc.cover);

  const chapters = doc.chapters.map((chapter, index) => {
    const html = sanitizeBody(chapter.html, (src) => {
      if (!src || src.startsWith('data:')) return dataImage(src, addImage);
      const path = joinPath(chapter.dir, src.split('#')[0]);
      const file = zipGet(doc.files, path);
      return file ? addImage(file) : '';
    });
    return {
      html: html || '<p></p>',
      title: firstHeading(html) || `Chapter ${index + 1}`,
      path: chapter.path,
    };
  });

  const chapterIndex = new Map(chapters.map((chapter, index) => [chapter.path.toLowerCase(), index]));
  const keptToc = resolveToc(doc.toc, doc.tocDir, chapterIndex);
  const toc = flattenToc(
    keptToc.length
      ? keptToc
      : chapters.map((chapter) => ({ title: chapter.title, href: chapter.path, children: [] })),
    0,
    -1,
    [],
  ).map((entry) => {
    const { path, fragment } = splitHref(entry.href);
    const resolvedPath = path ? joinPath(entry.href.startsWith('/') ? '' : doc.tocDir, path) : '';
    const index = chapterIndex.get(resolvedPath.toLowerCase());
    const direct = chapterIndex.get(String(path || '').toLowerCase());
    return {
      ...entry,
      chapter: index !== undefined ? index : direct !== undefined ? direct : 0,
      fragment: index !== undefined || direct !== undefined ? fragment : '',
    };
  });

  const coverRec = doc.cover && imageKind(doc.cover) ? '00001' : '';
  const parts = [];
  parts.push('<?xml version="1.0" encoding="utf-8"?>\n<html>\n<head>\n<guide>\n');
  parts.push(`<reference type="toc" title="Contents" filepos="${FILEPOS}"/>\n`);
  parts.push(`<reference type="text" title="Start" filepos="${FILEPOS}"/>\n`);
  parts.push('</guide>\n</head>\n<body>\n');
  if (coverRec) parts.push(`<img recindex="${coverRec}" alt="Cover"/>\n<mbp:pagebreak/>\n`);
  parts.push('<!--@toc-->\n<h1>Contents</h1>\n');
  for (const entry of toc) {
    const indent = entry.depth ? ' '.repeat(Math.min(entry.depth, 6) * 2) : '';
    parts.push(`${indent}<p><a filepos="${FILEPOS}">${xmlEscape(entry.title)}</a></p>\n`);
  }
  parts.push('<mbp:pagebreak/>\n');
  chapters.forEach((chapter, index) => {
    parts.push(`<!--@c${index}-->\n${chapter.html}\n`);
    if (index + 1 < chapters.length) parts.push('<mbp:pagebreak/>\n');
  });
  parts.push('</body>\n</html>\n');

  const draft = encoder.encode(parts.join(''));
  const tocAt = sentinelOffset(draft, '<!--@toc-->');
  const chapterAt = chapters.map((_, index) => sentinelOffset(draft, `<!--@c${index}-->`));
  if (tocAt < 0 || chapterAt.some((offset) => offset < 0)) {
    throw new Error('Could not build the MOBI table of contents.');
  }
  const positions = toc.map((entry) => {
    const start = chapterAt[entry.chapter];
    const end = chapterAt[entry.chapter + 1] ?? draft.length;
    if (!entry.fragment) return start;
    const idNeedle = encoder.encode(`id="${entry.fragment}"`);
    const at = indexOfBytes(draft, idNeedle, start);
    if (at >= 0 && at < end) return at;
    return start;
  });
  const fileposValues = [tocAt, chapterAt[0], ...positions];
  const html = fillFilepos(draft, fileposValues);
  const textRecords = [];
  for (let offset = 0; offset < html.length; offset += RECORD_SIZE) {
    textRecords.push(palmdocCompress(html.subarray(offset, offset + RECORD_SIZE)));
  }
  if (!textRecords.length) textRecords.push(new Uint8Array(0));

  const ncxEntries = toc.map((entry, index) => {
    const pos = positions[index];
    const next = positions.slice(index + 1).find((value) => value > pos);
    return {
      pos,
      length: Math.max(1, (next ?? html.length) - pos),
      label: entry.title,
      depth: entry.depth,
      parent: entry.parent,
      firstChild: entry.firstChild,
      lastChild: entry.lastChild,
    };
  });
  const ncxRecords = buildNcxIndx(ncxEntries);

  const firstImage = images.length ? textRecords.length + 1 : NULL_INDEX;
  const imageEnd = images.length ? firstImage + images.length - 1 : textRecords.length;
  const ncxIndex = ncxRecords.length ? textRecords.length + 1 + images.length : NULL_INDEX;
  const flisIndex = textRecords.length + 1 + images.length + ncxRecords.length;
  const fcisIndex = flisIndex + 1;
  const title = plain(doc.metadata.title, 400) || 'Untitled';
  const exth = [];
  const push = (record) => {
    if (record) exth.push(record);
  };
  push(exthString(503, title));
  for (const author of doc.metadata.authors) push(exthString(100, plain(author, 200)));
  push(exthString(101, plain(doc.metadata.publisher, 200)));
  push(exthString(103, plain(doc.metadata.description)));
  push(exthString(104, doc.metadata.isbn));
  for (const subject of doc.metadata.subjects) push(exthString(105, plain(subject, 200)));
  push(exthString(106, plain(doc.metadata.date, 80)));
  push(exthString(109, plain(doc.metadata.rights, 400)));
  push(exthString(524, languageTag(doc.metadata.language)));
  push(exthString(501, 'EBOK'));
  push(exthString(113, asinFor(html)));
  if (images.length) exth.push({ type: 125, data: u32(images.length) });
  if (doc.cover && imageKind(doc.cover)) {
    exth.push({ type: 201, data: u32(0) });
    exth.push({ type: 202, data: u32(0) });
    exth.push({ type: 203, data: u32(0) });
    push(exthString(129, `kindle:embed:${base32_4(0)}`));
  }
  exth.push({ type: 116, data: u32(chapterAt[0] || 0) });

  const record0 = buildRecord0({
    title,
    exth,
    uniqueId: parseInt(asinFor(html).slice(2), 16) || 1,
    locale: localeOf(doc.metadata.language),
    textLength: html.length,
    textRecords: textRecords.length,
    firstNonBook: textRecords.length + 1,
    firstImage,
    lastContent: imageEnd,
    fcisRecord: fcisIndex,
    flisRecord: flisIndex,
    ncxIndex,
  });

  const records = [
    record0,
    ...textRecords,
    ...images,
    ...ncxRecords,
    flisRecord(),
    fcisRecord(html.length),
    Uint8Array.of(0xe9, 0x8e, 0x0d, 0x0a),
  ];
  return buildPalm(title, records);
}

function dataImage(src, addImage) {
  if (!src || !src.startsWith('data:image/')) return '';
  const comma = src.indexOf(',');
  if (comma < 0) return '';
  const meta = src.slice(5, comma);
  const payload = src.slice(comma + 1);
  try {
    const binary = meta.includes(';base64') ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return addImage(bytes);
  } catch {
    return '';
  }
}
