const FILE_TYPE = 32768;
const DIR_TYPE = 16384;
const MAX_ENTRY_BYTES = 80 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

let modulePromise = null;

export function preloadArchive() {
  return loadModule();
}

function loadModule() {
  if (!modulePromise) {
    const wasmUrl = new URL('../vendor/libarchive/libarchive.wasm', import.meta.url);
    modulePromise = import('../vendor/libarchive/libarchive.js')
      .then(({ default: libarchiveFactory }) =>
        libarchiveFactory({
          locateFile(path) {
            if (String(path).endsWith('.wasm')) return wasmUrl.href;
            return path;
          },
        }),
      )
      .catch((err) => {
        modulePromise = null;
        throw err;
      });
  }
  return modulePromise;
}

function wrap(module) {
  const cwrap = module.cwrap.bind(module);
  const errorString = cwrap('archive_error_string', 'string', ['number']);
  const readData = cwrap('archive_read_data', 'number', ['number', 'number', 'number']);
  const skipData = cwrap('archive_read_data_skip', 'number', ['number']);
  return {
    module,
    open: cwrap('archive_read_new_memory', 'number', ['number', 'number', 'string']),
    next: cwrap('archive_read_next_entry', 'number', ['number']),
    pathname: cwrap('archive_entry_pathname_utf8', 'string', ['number']),
    size: cwrap('archive_entry_size', 'number', ['number']),
    filetype: cwrap('archive_entry_filetype', 'number', ['number']),
    encrypted: cwrap('archive_entry_is_encrypted', 'number', ['number']),
    errorString,
    read(archive, ptr, size) {
      const n = readData(archive, ptr, size);
      if (n < 0) throw new Error(errorString(archive) || 'Could not read a file in this archive.');
      return n;
    },
    skip(archive) {
      const code = skipData(archive);
      if (code !== 0) throw new Error(errorString(archive) || 'Could not skip a file in this archive.');
    },
    free: cwrap('archive_read_free', 'number', ['number']),
  };
}

function concatChunks(chunks, total) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function readEntry(lib, archive, size) {
  if (size > MAX_ENTRY_BYTES) throw new Error('A file in this comic is larger than 80 MB.');
  const malloc = lib.module._malloc;
  const free = lib.module._free;
  if (size > 0) {
    const ptr = malloc(size);
    try {
      const n = lib.read(archive, ptr, size);
      return lib.module.HEAPU8.slice(ptr, ptr + Math.max(0, n));
    } finally {
      free(ptr);
    }
  }

  const chunkSize = 256 * 1024;
  const ptr = malloc(chunkSize);
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const n = lib.read(archive, ptr, chunkSize);
      if (!n) break;
      if (total + n > MAX_ENTRY_BYTES) throw new Error('A file in this comic is larger than 80 MB.');
      chunks.push(lib.module.HEAPU8.slice(ptr, ptr + n));
      total += n;
    }
  } finally {
    free(ptr);
  }
  return concatChunks(chunks, total);
}

/**
 * Extract a ZIP, RAR, or other libarchive-supported archive from memory.
 * `include(path)` may return false to skip an entry's bytes (the entry is
 * still consumed, which solid RAR requires).
 * @param {Uint8Array|ArrayBuffer} bytes
 * @param {(path: string) => boolean} [include]
 * @returns {Promise<{path: string, bytes: Uint8Array}[]>}
 */
export async function extractArchive(bytes, include) {
  const module = await loadModule();
  const lib = wrap(module);
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!data.length) throw new Error('This comic archive is empty.');

  const ptr = lib.module._malloc(data.length);
  lib.module.HEAPU8.set(data, ptr);
  let archive = 0;
  const entries = [];
  let total = 0;
  try {
    archive = lib.open(ptr, data.length, null);
    if (!archive) throw new Error('Could not open this comic archive. Use a CBZ (ZIP) or CBR (RAR) file.');
    for (;;) {
      const entryPtr = lib.next(archive);
      if (!entryPtr) {
        const message = lib.errorString(archive) || '';
        if (/encrypt|password|passphrase/i.test(message)) {
          throw new Error('This comic archive is encrypted. Password-protected CBZ and CBR files are not supported.');
        }
        if (message) throw new Error(message);
        break;
      }
      const path = (lib.pathname(entryPtr) || '').replaceAll('\\', '/').replace(/^\/+/, '');
      const filetype = lib.filetype(entryPtr) >>> 0;
      if (lib.encrypted(entryPtr)) {
        throw new Error('This comic archive is encrypted. Password-protected CBZ and CBR files are not supported.');
      }
      const isDir = filetype === DIR_TYPE || path.endsWith('/');
      const isFile = filetype === FILE_TYPE || filetype === 0;
      if (!path || isDir || !isFile || (include && !include(path))) {
        lib.skip(archive);
        continue;
      }
      const size = lib.size(entryPtr);
      let fileBytes;
      try {
        fileBytes = readEntry(lib, archive, size > 0 ? size : 0);
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        if (/encrypt|password|passphrase/i.test(message)) {
          throw new Error('This comic archive is encrypted. Password-protected CBZ and CBR files are not supported.');
        }
        throw err;
      }
      total += fileBytes.length;
      if (total > MAX_TOTAL_BYTES) throw new Error('This comic is larger than 1 GB uncompressed.');
      entries.push({ path, bytes: fileBytes });
    }
  } finally {
    if (archive) {
      try {
        lib.free(archive);
      } catch {
        /* The archive is discarded either way. */
      }
    }
    lib.module._free(ptr);
  }
  return entries;
}
