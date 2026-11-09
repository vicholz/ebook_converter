# toazw3

**Use it here: [https://vicholz.github.io/toazw3/](https://vicholz.github.io/toazw3/)**

Browser-only converter for **EPUB**, **MOBI** (also PRC / AZW), **AZW3**, **CBZ**, and **CBR**. Pick an output of Kindle **AZW3**, **EPUB**, or older Kindle **MOBI**. Drop one file or a whole stack. Conversion happens in this tab with WebAssembly. Nothing is uploaded.

## Features

- Output format picker: AZW3, EPUB, or MOBI. AZW3 stays the default
- DRM-free AZW3 can be converted to EPUB or MOBI, and the other way around where the engine supports it
- Bulk queue: add many ebooks or comics, convert them one after another
- Per-file download plus **Download all as ZIP**
- Cover images, chapter lists, and embedded pictures are kept when the destination format can hold them
- CBZ and CBR comics become one page per image, with the first page used as the cover
- DRM-free files only — encrypted Kindle books, Adobe DRM EPUBs, and password-protected comics will fail
- Works from any static web server, including GitHub Pages. There is no upload service

## Run locally

Any static file server is enough. From this directory:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). Opening `index.html` as a `file://` URL will not load the converter.

Check the converters with:

```bash
node --test tests/convert.test.mjs
node tests/browser.mjs
```

The browser script needs Chrome. It converts a CBZ fixture to AZW3, EPUB, and MOBI and checks the format picker.

## How it works

The UI is vanilla HTML, CSS, and JavaScript. A Web Worker loads a vendored [boko](https://github.com/zacharydenton/boko) WASM module. boko reads EPUB, AZW3, MOBI, and KFX, and writes AZW3 and EPUB. It does not write MOBI. MOBI output is a MOBI6 PalmDB built in this page from the book’s EPUB form: metadata, a table of contents, PalmDOC-compressed HTML, and JPEG, PNG, or GIF images.

CBZ (ZIP) and CBR (RAR) comics are unpacked in the browser with vendored [libarchive](https://github.com/ofk/libarchive-wasm), turned into a page-by-page EPUB, then converted to the selected output. JPEG, PNG, and GIF pages are kept; WebP, BMP, and AVIF pages are re-encoded as JPEG. Bulk ZIP files are built in the browser with uncompressed (STORE) zip records.

Choosing EPUB for a file that is already an EPUB keeps the original bytes. Every other selected output is a newly built file.

## Limits

- DRM is not removed. Amazon-encrypted AZW3/MOBI/KFX and Adobe-encrypted EPUB fail with an error.
- MOBI output is the older MOBI6 format used by early Kindles. It keeps the title, authors, language, cover, chapter list, basic headings and paragraphs, and embedded JPEG/PNG/GIF images. It does not keep CSS, fixed-layout pages, or embedded fonts. AZW3 remains the fuller Kindle format.
- KFX can be read by the engine, but this page does not offer KFX as an output or as a file you can drop in.
- Very large comics are capped at 2000 pages.

## License

GPL-3.0-or-later, because the conversion engine is boko (GPL-3.0-or-later). The comic unpacker is libarchive-wasm (MIT) with libarchive (BSD-2-Clause). See `LICENSE`, `vendor/boko/`, and `vendor/libarchive/`.
