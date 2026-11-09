import init, { book_info, convert } from '../vendor/boko/boko.js';
import { comicToEpub } from './comic.js';
import { ensureAzw3Cover } from './cover.js';
import { friendlyConvertError } from './errors.js';
import { isOutputFormat } from './formats.js';
import { epubToMobi } from './mobi.js';

const SOURCES = new Set(['epub', 'mobi', 'azw3', 'cbz', 'cbr']);

export async function initConverter() {
  await init();
}

function parseInfo(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function safeInfo(bytes, format) {
  try {
    return parseInfo(book_info(bytes, format));
  } catch {
    return null;
  }
}

function mergeInfo(info, fallback) {
  if (!fallback) return info;
  const base = info || {};
  return {
    ...base,
    title: base.title || fallback.title || '',
    authors: base.authors && base.authors.length ? base.authors : fallback.authors || [],
    language: base.language || fallback.language || '',
    pages: fallback.pages || base.pages,
  };
}

function bokoConvert(bytes, from, to) {
  try {
    return convert(bytes, from, to);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    if (from === 'azw3' && /MobiImporter|not a KF8/i.test(message)) return convert(bytes, 'mobi', to);
    if (from === 'mobi' && /Azw3Importer|KF8\/AZW3|not a MOBI/i.test(message)) return convert(bytes, 'azw3', to);
    throw err;
  }
}

function copyBytes(bytes) {
  return Uint8Array.from(bytes);
}

async function convertInner(input, from, to, options) {
  if (!SOURCES.has(from)) throw new Error('This file is not a supported ebook or comic.');
  if (!isOutputFormat(to)) throw new Error('Choose AZW3, EPUB, or MOBI.');
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.byteLength) throw new Error('This file is empty.');

  const notify = options.onProgress || (() => {});
  const name = options.name || 'book';
  let source = bytes;
  let sourceFormat = from;
  let comicInfo = null;

  if (from === 'cbz' || from === 'cbr') {
    notify(`Reading ${name}…`);
    const comic = await comicToEpub(bytes, {
      filename: name,
      onProgress(update) {
        notify(`Preparing page ${update.done} of ${update.total}…`);
      },
    });
    source = comic.bytes;
    sourceFormat = 'epub';
    comicInfo = comic.info;
    if (to === 'epub') return { bytes: copyBytes(source), info: comicInfo };
  }

  if (to === 'epub' && from === 'epub') {
    return { bytes: copyBytes(bytes), info: safeInfo(bytes, 'epub') };
  }

  if (to === 'azw3') {
    notify(`Converting ${name} to AZW3…`);
    let output = bokoConvert(source, sourceFormat, 'azw3');
    output = await ensureAzw3Cover(source, sourceFormat, output);
    return { bytes: copyBytes(output), info: mergeInfo(safeInfo(output, 'azw3'), comicInfo) };
  }

  if (to === 'epub') {
    notify(`Converting ${name} to EPUB…`);
    const output = bokoConvert(source, sourceFormat, 'epub');
    return { bytes: copyBytes(output), info: mergeInfo(safeInfo(output, 'epub'), comicInfo) };
  }

  notify(`Converting ${name} to MOBI…`);
  const epubBytes = sourceFormat === 'epub' ? source : bokoConvert(source, sourceFormat, 'epub');
  const output = await epubToMobi(epubBytes);
  return { bytes: copyBytes(output), info: mergeInfo(safeInfo(output, 'mobi'), comicInfo) };
}

/**
 * Convert one book in the browser. `from` is epub, mobi, azw3, cbz, or cbr.
 * `to` is azw3, epub, or mobi.
 * @param {Uint8Array} bytes
 * @param {string} from
 * @param {string} to
 * @param {{name?: string, onProgress?: (message: string) => void}} [options]
 */
export async function convertBook(bytes, from, to, options = {}) {
  try {
    return await convertInner(bytes, from, to, options);
  } catch (err) {
    throw new Error(friendlyConvertError(err));
  }
}
