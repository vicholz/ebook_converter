/**
 * Turn converter exceptions into a sentence the queue can show.
 * DRM and unsupported-format failures stay explicit; other messages pass through.
 */
export function friendlyConvertError(err) {
  const raw = err && err.message ? err.message : String(err || 'Conversion failed.');
  if (/drm-protected|drm protected|\bDRM\b/i.test(raw)) {
    return 'This file is DRM-protected. Only DRM-free books can be converted.';
  }
  if (/password-protected CBZ|password-protected comics|archive is encrypted/i.test(raw)) {
    return raw;
  }
  if (/format not supported as output/i.test(raw)) {
    return 'That output format is not available for this file.';
  }
  if (/format not supported as input|unknown format|unsupported format/i.test(raw)) {
    return 'This file is not a supported ebook or comic.';
  }
  return raw;
}
