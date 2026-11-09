import { decodeXml, extractCoverFromEpub, joinPath, readZip, zipGet } from './cover.js';

function textOf(value) {
  return decodeXml(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? decodeXml(match[1]) : '';
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

function sliceElement(html, tag, from = 0) {
  const openRe = new RegExp(`<${tag}\\b`, 'i');
  const rest = html.slice(from);
  const rel = rest.search(openRe);
  if (rel < 0) return null;
  const openAt = from + rel;
  const openEnd = findTagEnd(html, openAt);
  const openTag = html.slice(openAt, openEnd + 1);
  if (/\/>\s*$/.test(openTag)) return { openTag, inner: '', end: openEnd + 1 };
  let depth = 1;
  let i = openEnd + 1;
  const openPat = new RegExp(`<${tag}\\b`, 'ig');
  const closePat = new RegExp(`</${tag}\\s*>`, 'ig');
  while (i < html.length && depth > 0) {
    openPat.lastIndex = i;
    closePat.lastIndex = i;
    const nextOpen = openPat.exec(html);
    const nextClose = closePat.exec(html);
    if (!nextClose) return null;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      i = findTagEnd(html, nextOpen.index) + 1;
    } else {
      depth -= 1;
      if (depth === 0) {
        return {
          openTag,
          inner: html.slice(openEnd + 1, nextClose.index),
          end: nextClose.index + nextClose[0].length,
        };
      }
      i = nextClose.index + nextClose[0].length;
    }
  }
  return null;
}

function allElements(html, tag) {
  const found = [];
  let cursor = 0;
  while (cursor < html.length) {
    const el = sliceElement(html, tag, cursor);
    if (!el) break;
    found.push(el);
    cursor = el.end;
  }
  return found;
}

function dcValues(opf, name) {
  const re = new RegExp(`<dc:${name}\\b[^>]*>([\\s\\S]*?)</dc:${name}>`, 'gi');
  return [...opf.matchAll(re)].map((match) => textOf(match[1])).filter(Boolean);
}

function dirOf(path) {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(0, slash) : '';
}

function parseLis(inner) {
  const items = [];
  for (const li of allElements(inner, 'li')) {
    const anchor = sliceElement(li.inner, 'a', 0);
    const title = textOf(anchor ? anchor.inner : li.inner);
    const href = anchor ? attr(anchor.openTag, 'href') : '';
    const nested = sliceElement(li.inner, 'ol', 0) || sliceElement(li.inner, 'ul', 0);
    const children = nested ? parseLis(nested.inner) : [];
    if (title || href) items.push({ title: title || 'Section', href, children });
  }
  return items;
}

function parseNav(xml) {
  const tocNav = xml.match(/<nav\b[^>]*\bepub:type\s*=\s*["'][^"']*\btoc\b[^"']*["'][^>]*>/i);
  const anyNav = tocNav || xml.match(/<nav\b[^>]*>/i);
  if (!anyNav) return [];
  const start = (anyNav.index || 0) + anyNav[0].length;
  const close = xml.toLowerCase().indexOf('</nav>', start);
  const inner = close >= 0 ? xml.slice(start, close) : xml.slice(start);
  const list = sliceElement(inner, 'ol', 0) || sliceElement(inner, 'ul', 0);
  return list ? parseLis(list.inner) : [];
}

function parseNavPoints(inner) {
  const items = [];
  for (const point of allElements(inner, 'navPoint')) {
    const label = point.inner.match(/<text\b[^>]*>([\s\S]*?)<\/text>/i);
    const src = point.inner.match(/<content\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
    items.push({
      title: textOf(label ? label[1] : '') || 'Section',
      href: src ? decodeXml(src[1]) : '',
      children: parseNavPoints(point.inner),
    });
  }
  return items;
}

function parseNcx(xml) {
  const map = sliceElement(xml, 'navMap', 0);
  return map ? parseNavPoints(map.inner) : [];
}

function isbnOf(values) {
  for (const value of values) {
    const compact = value.replace(/[^0-9Xx]/g, '');
    if (/^(97[89]\d{10}|\d{9}[\dXx])$/.test(compact)) return compact.toUpperCase();
  }
  return '';
}

function decodeBytes(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Read a DRM-free EPUB into metadata, spine documents, a table of contents, and a cover.
 * @param {Uint8Array} bytes
 */
export async function readEpubDocument(bytes) {
  const files = await readZip(bytes);
  const container = zipGet(files, 'META-INF/container.xml');
  if (!container) throw new Error('This EPUB is missing META-INF/container.xml.');
  const containerXml = decodeBytes(container);
  const opfPathMatch = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i);
  if (!opfPathMatch) throw new Error('This EPUB does not point at a package document.');
  const opfPath = decodeXml(opfPathMatch[1]).replace(/\\/g, '/').replace(/^\/+/, '');
  const opfBytes = zipGet(files, opfPath);
  if (!opfBytes) throw new Error('This EPUB package document could not be found.');
  const opf = decodeBytes(opfBytes);
  const opfDir = dirOf(opfPath);

  const manifest = new Map();
  for (const tag of opf.match(/<item\b[^>]*>/gi) || []) {
    const id = attr(tag, 'id');
    const href = attr(tag, 'href');
    if (!id || !href) continue;
    manifest.set(id, {
      href,
      path: joinPath(opfDir, href.split('#')[0]),
      mediaType: attr(tag, 'media-type').toLowerCase(),
      properties: attr(tag, 'properties'),
    });
  }

  const chapters = [];
  for (const tag of opf.match(/<itemref\b[^>]*>/gi) || []) {
    const id = attr(tag, 'idref');
    const item = manifest.get(id);
    if (!item) continue;
    if (item.mediaType.includes('dtbncx') || item.mediaType.includes('ncx')) continue;
    const file = zipGet(files, item.path);
    if (!file) continue;
    if (item.mediaType.startsWith('image/')) {
      const name = item.path.split('/').pop();
      chapters.push({
        path: item.path,
        dir: dirOf(item.path),
        html: `<html><body><img src="${name}" alt=""/></body></html>`,
      });
      continue;
    }
    if (item.mediaType && !/html|xml|svg/.test(item.mediaType)) continue;
    chapters.push({ path: item.path, dir: dirOf(item.path), html: decodeBytes(file) });
  }

  if (!chapters.length) throw new Error('This book has no chapters to convert.');

  let toc = [];
  let tocDir = opfDir;
  const navItem = [...manifest.values()].find((item) => /\bnav\b/i.test(item.properties));
  if (navItem) {
    const navFile = zipGet(files, navItem.path);
    if (navFile) {
      toc = parseNav(decodeBytes(navFile));
      tocDir = dirOf(navItem.path);
    }
  }
  if (!toc.length) {
    const ncxItem =
      [...manifest.values()].find((item) => item.mediaType.includes('ncx')) ||
      [...manifest.values()].find((item) => item.path.toLowerCase().endsWith('.ncx'));
    if (ncxItem) {
      const ncxFile = zipGet(files, ncxItem.path);
      if (ncxFile) {
        toc = parseNcx(decodeBytes(ncxFile));
        tocDir = dirOf(ncxItem.path);
      }
    }
  }

  const titles = dcValues(opf, 'title');
  const identifiers = dcValues(opf, 'identifier');
  let cover = null;
  try {
    cover = await extractCoverFromEpub(bytes);
  } catch {
    cover = null;
  }

  return {
    files,
    metadata: {
      title: titles[0] || 'Untitled',
      authors: dcValues(opf, 'creator'),
      language: dcValues(opf, 'language')[0] || 'en',
      publisher: dcValues(opf, 'publisher')[0] || '',
      description: dcValues(opf, 'description')[0] || '',
      subjects: dcValues(opf, 'subject'),
      date: dcValues(opf, 'date')[0] || '',
      rights: dcValues(opf, 'rights')[0] || '',
      isbn: isbnOf(identifiers),
    },
    chapters,
    toc,
    tocDir,
    cover,
  };
}
