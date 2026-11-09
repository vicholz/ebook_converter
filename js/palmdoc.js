/**
 * PalmDOC (MOBI compression type 2). Each text record is compressed on its own.
 * Matches are limited to 3–10 bytes within the previous 2047 bytes, the same
 * window the PalmDOC decoder requires.
 */

function remember(heads, data, pos) {
  if (pos + 3 > data.length) return;
  const key = (data[pos] << 16) | (data[pos + 1] << 8) | data[pos + 2];
  let list = heads.get(key);
  if (!list) {
    list = [];
    heads.set(key, list);
  }
  list.push(pos);
  if (list.length > 32) list.shift();
}

export function palmdocCompress(input) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const out = [];
  const heads = new Map();
  let i = 0;
  const n = data.length;

  while (i < n) {
    let bestLen = 0;
    let bestDist = 0;
    if (i > 10 && n - i > 10 && i + 3 <= n) {
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      const list = heads.get(key);
      if (list) {
        const min = i - 2047;
        const max = Math.min(10, n - i);
        for (let p = list.length - 1; p >= 0; p--) {
          const j = list[p];
          if (j < min || j >= i) break;
          let len = 3;
          while (len < max && data[j + len] === data[i + len]) len += 1;
          if (len > bestLen) {
            bestLen = len;
            bestDist = i - j;
            if (bestLen === 10) break;
          }
        }
      }
    }

    if (bestLen >= 3 && bestDist > 0) {
      const code = 0x8000 + ((bestDist << 3) & 0x3ff8) + (bestLen - 3);
      out.push((code >> 8) & 0xff, code & 0xff);
      for (let k = 0; k < bestLen; k++) remember(heads, data, i + k);
      i += bestLen;
      continue;
    }

    const ch = data[i];
    i += 1;
    if (ch === 0x20 && i < n) {
      const next = data[i];
      if (next >= 0x40 && next < 0x80) {
        out.push(next ^ 0x80);
        remember(heads, data, i - 1);
        remember(heads, data, i);
        i += 1;
        continue;
      }
    }

    if (ch === 0 || (ch > 8 && ch < 0x80)) {
      out.push(ch);
      remember(heads, data, i - 1);
      continue;
    }

    const bin = [ch];
    while (i < n && bin.length < 8) {
      const c = data[i];
      if (c === 0 || (c > 8 && c < 0x80)) break;
      bin.push(c);
      i += 1;
    }
    out.push(bin.length);
    for (const byte of bin) out.push(byte);
    for (let k = 0; k < bin.length; k++) remember(heads, data, i - bin.length + k);
  }

  return Uint8Array.from(out);
}

export function palmdocDecompress(input) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const out = [];
  let i = 0;
  while (i < data.length) {
    const c = data[i];
    i += 1;
    if (c === 0 || (c > 8 && c < 0x80)) {
      out.push(c);
    } else if (c >= 1 && c <= 8) {
      for (let k = 0; k < c && i < data.length; k++) {
        out.push(data[i]);
        i += 1;
      }
    } else if (c >= 0xc0) {
      out.push(0x20, c ^ 0x80);
    } else {
      if (i >= data.length) break;
      const code = (c << 8) | data[i];
      i += 1;
      const len = (code & 7) + 3;
      const dist = (code >> 3) & 0x7ff;
      if (dist === 0 || dist > out.length) break;
      for (let k = 0; k < len; k++) out.push(out[out.length - dist]);
    }
  }
  return Uint8Array.from(out);
}
