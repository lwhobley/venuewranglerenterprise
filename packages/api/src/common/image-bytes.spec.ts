import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { assertAllowedImageBytes, detectImageMime } from './image-bytes';
import { unpaidBreakMs } from './break-duration';
import { htmlEscape } from './html-escape';

describe('detectImageMime', () => {
  it('detects jpeg', () => {
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('detects png', () => {
    expect(detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
  });

  it('detects heic/heif from ftyp box with various brands', () => {
    // 24 bytes ftyp box: length 24 (0x18), 'ftyp', major 'mif1', minor 0, compatible 'heic'
    const buf = Buffer.alloc(24);
    buf.writeUInt32BE(24, 0);
    buf.write('ftyp', 4, 'ascii');
    buf.write('mif1', 8, 'ascii');
    buf.writeUInt32BE(0, 12);
    buf.write('heic', 16, 'ascii');
    expect(detectImageMime(buf)).toBe('image/heic');

    // Major brand heix
    const bufHeix = Buffer.alloc(16);
    bufHeix.writeUInt32BE(16, 0);
    bufHeix.write('ftyp', 4, 'ascii');
    bufHeix.write('heix', 8, 'ascii');
    expect(detectImageMime(bufHeix)).toBe('image/heic');
  });

  it('rejects mismatch between claim and bytes, but permits iOS camera-roll claimed jpeg for heic', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(() => assertAllowedImageBytes(jpeg, 'image/png')).toThrow(BadRequestException);
    expect(assertAllowedImageBytes(jpeg, 'image/jpeg')).toBe('image/jpeg');

    const heicBuf = Buffer.alloc(16);
    heicBuf.writeUInt32BE(16, 0);
    heicBuf.write('ftyp', 4, 'ascii');
    heicBuf.write('heic', 8, 'ascii');

    // Accepts image/heic
    expect(assertAllowedImageBytes(heicBuf, 'image/heic')).toBe('image/heic');
    // Normalizes image/heif
    expect(assertAllowedImageBytes(heicBuf, 'image/heif')).toBe('image/heic');
    // Accepts iOS image picker defaulting to image/jpeg
    expect(assertAllowedImageBytes(heicBuf, 'image/jpeg')).toBe('image/heic');
  });
});

describe('unpaidBreakMs', () => {
  it('handles numeric and string timestamps', () => {
    expect(unpaidBreakMs(1000, 4000)).toBe(3000);
    expect(unpaidBreakMs('1000', '4000')).toBe(3000);
  });

  it('returns 0 for invalid or inverted ranges', () => {
    expect(unpaidBreakMs('not-a-date', 4000)).toBe(0);
    expect(unpaidBreakMs(5000, 1000)).toBe(0);
  });
});

describe('htmlEscape', () => {
  it('escapes HTML special characters', () => {
    expect(htmlEscape(`a<b>"c"&d`)).toBe('a&lt;b&gt;&quot;c&quot;&amp;d');
  });
});
