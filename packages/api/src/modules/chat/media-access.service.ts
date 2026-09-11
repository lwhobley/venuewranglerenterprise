import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

export type MediaKind = 'chat-image' | 'checklist-photo';

/** Duration of one time bucket in seconds (3 minutes). */
const BUCKET_SECONDS = 180;

/**
 * Opaque, time-bucketed HMAC tokens for media access.
 *
 * React Native <Image> cannot send a bearer header, so image routes accept a
 * short-lived query-string token instead. Unlike the prior JWT approach, the
 * token is an opaque hex HMAC — no structured claims leak into logs,
 * screenshots, or shared links.
 *
 * Each token is valid for the current 3-minute time bucket plus the previous
 * one (to handle requests near a bucket boundary), giving an effective window
 * of 3–6 minutes.
 *
 * Prefer MEDIA_TOKEN_SECRET so media tokens can be rotated independently of
 * session JWTs. JWT_SECRET remains a compatible fallback.
 */
@Injectable()
export class MediaAccessService {
  private readonly secret: string;

  constructor(config: ConfigService) {
    const dedicated = config.get<string>('MEDIA_TOKEN_SECRET')?.trim();
    const fallback = config.get<string>('JWT_SECRET')?.trim();
    const secret = dedicated || fallback;
    if (!secret) {
      throw new Error('MEDIA_TOKEN_SECRET or JWT_SECRET is required for media access tokens');
    }
    if (!dedicated && process.env.NODE_ENV === 'production') {
      console.warn('[MediaAccess] MEDIA_TOKEN_SECRET is unset; falling back to JWT_SECRET. Set MEDIA_TOKEN_SECRET so media tokens can rotate independently.');
    }
    this.secret = secret;
  }

  createPath(kind: MediaKind, mediaId: string, venueId: string, path: string): string {
    const bucket = currentBucket();
    const token = this.computeHmac(kind, mediaId, venueId, bucket);
    return `${path}?token=${token}&t=${bucket}`;
  }

  assertToken(token: string | undefined, kind: MediaKind, mediaId: string, venueId: string): void {
    if (!token) throw new UnauthorizedException('Media access token is required');

    const now = currentBucket();

    // Accept current bucket or the immediately previous one (boundary grace).
    for (const bucket of [now, now - 1]) {
      const expected = this.computeHmac(kind, mediaId, venueId, bucket);
      if (safeCompare(token, expected)) return;
    }

    throw new UnauthorizedException('Media access token is invalid or expired');
  }

  private computeHmac(kind: string, mediaId: string, venueId: string, bucket: number): string {
    return createHmac('sha256', this.secret)
      .update(`media-access|${kind}|${mediaId}|${venueId}|${bucket}`)
      .digest('hex');
  }
}

function currentBucket(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / BUCKET_SECONDS);
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
