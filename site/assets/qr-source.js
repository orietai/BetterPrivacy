// Browser entry point. qr-vendor.js is checked in and rebuilt by build:site.
// Only the encoder is bundled; no scanner, camera, network or DOM helpers.
import encodeQR from 'qr';

export const MAX_URL_BYTES = 256;
export function canEncode(link) {
  return typeof link === 'string' && link.length <= MAX_URL_BYTES &&
    /^https:\/\/betterprivacy\.app\/m#v1\.[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/.test(link);
}
export function svg(link) {
  if (!canEncode(link)) throw new Error('QR_SHORT_SINGLE_LINK_ONLY');
  // Four white modules on every side; explicit white background also survives
  // SVG downloads opened outside the site's dark theme. Module rectangles
  // keep the downloadable vector straightforward to inspect and rasterize.
  return encodeQR(link, 'svg', { ecc: 'medium', border: 4, optimize: false })
    .replace('><rect', '><rect width="100%" height="100%" fill="white"/><rect');
}
