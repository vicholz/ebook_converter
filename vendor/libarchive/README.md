# Vendored libarchive-wasm

CBZ and CBR comics are unpacked with [libarchive-wasm](https://github.com/ofk/libarchive-wasm) 1.2.0 before ebook_converter builds a page-by-page EPUB and converts it with boko.

- Package: https://www.npmjs.com/package/libarchive-wasm
- Version: 1.2.0
- Wrapper license: MIT (see `LICENSE`)
- libarchive license: BSD-2-Clause (see `LICENSE-libarchive.txt`)
- Formats used here: ZIP (CBZ, including Zip64) and RAR v4 / RAR v5 (CBR)

`libarchive.wasm` is the unmodified build from that package. `libarchive.js` is the upstream Emscripten glue with one added line, `export default libarchive`, so the static site can import it as an ES module. ebook_converter does not otherwise modify the extractor.

The wasm build statically links libarchive and the compression libraries it was compiled with (including zlib). Those components keep their own permissive licenses.
