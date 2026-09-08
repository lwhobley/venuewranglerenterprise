import { BadRequestException } from '@nestjs/common';

export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'heio',
  'hevm',
  'mif1',
  'msf1',
  'MiPr',
]);

/** Detect image MIME from magic bytes. Returns null when unrecognized. */
export function detectImageMime(data: Buffer): AllowedImageMime | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  // HEIC/HEIF: ISO BMFF with ftyp box and a recognized brand in major or compatible brands list.
  if (data.length >= 12 && data.toString('ascii', 4, 8) === 'ftyp') {
    const ftypLength = data.readUInt32BE(0);
    const boxEnd = Math.min(data.length, ftypLength > 0 ? ftypLength : data.length);
    for (let offset = 8; offset + 4 <= boxEnd; offset += 4) {
      if (offset === 12) continue; // minor_version field
      const brand = data.toString('ascii', offset, offset + 4);
      if (HEIC_BRANDS.has(brand)) {
        return 'image/heic';
      }
    }
  }
  return null;
}

/**
 * Validate claimed MIME against magic bytes. Returns the detected (trusted) MIME.
 * Rejects mismatches and unrecognized payloads.
 */
export function assertAllowedImageBytes(
  data: Buffer,
  claimedMime?: string | null,
): AllowedImageMime {
  const detected = detectImageMime(data);
  if (!detected) {
    throw new BadRequestException('Unsupported image type. Use JPEG, PNG, WebP, or HEIC.');
  }
  if (claimedMime && claimedMime !== detected) {
    // Treat heif as interchangeable with heic for client labels.
    const claimedNorm = claimedMime === 'image/heif' ? 'image/heic' : claimedMime;
    // On iOS, expo-image-picker may report image/jpeg or application/octet-stream for camera-roll HEIC photos.
    if (claimedNorm !== detected) {
      if (detected === 'image/heic' && (claimedMime === 'image/jpeg' || claimedMime === 'application/octet-stream')) {
        return 'image/heic';
      }
      throw new BadRequestException('Image content does not match the declared type.');
    }
  }
  return detected;
}
