/** Input extensions the drop zone accepts, and the three output containers. */

export const OUTPUT_FORMATS = {
  azw3: {
    id: 'azw3',
    label: 'AZW3',
    extension: 'azw3',
    mime: 'application/x-mobi8-ebook',
    blurb: 'Kindle',
  },
  epub: {
    id: 'epub',
    label: 'EPUB',
    extension: 'epub',
    mime: 'application/epub+zip',
    blurb: 'Most readers',
  },
  mobi: {
    id: 'mobi',
    label: 'MOBI',
    extension: 'mobi',
    mime: 'application/x-mobipocket-ebook',
    blurb: 'Older Kindles',
  },
};

export const OUTPUT_FORMAT_IDS = ['azw3', 'epub', 'mobi'];

export const FORMAT_BY_EXT = {
  epub: 'epub',
  mobi: 'mobi',
  prc: 'mobi',
  azw: 'mobi',
  azw3: 'azw3',
  cbz: 'cbz',
  cbr: 'cbr',
};

export const ACCEPTED_INPUT_LABEL = 'EPUB, MOBI, PRC, AZW, AZW3, CBZ, or CBR';

export function isOutputFormat(value) {
  return Object.prototype.hasOwnProperty.call(OUTPUT_FORMATS, value);
}
