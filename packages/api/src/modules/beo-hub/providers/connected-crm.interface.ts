import type { CanonicalBeoInput } from '../adapters/canonical-beo.types';

export interface ConnectedCrmListResult {
  beos: CanonicalBeoInput[];
  nextCursor?: string;
}

export interface ConnectedCrmProvider {
  readonly name: string;
  readonly enabled: boolean;

  /**
   * Fetches BEOs modified or created since the provided cursor/timestamp.
   */
  listBeosSince(venueId: string, cursor?: string): Promise<ConnectedCrmListResult>;

  /**
   * Fetches a single BEO by external ID from the provider.
   */
  getBeo(venueId: string, externalId: string): Promise<CanonicalBeoInput | null>;

  /**
   * Subscribes the venue to webhook event callbacks for live change notifications.
   */
  subscribeWebhook?(venueId: string, callbackUrl: string): Promise<{ subscriptionId: string }>;
}
