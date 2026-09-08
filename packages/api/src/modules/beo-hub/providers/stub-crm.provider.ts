import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CanonicalBeoInput } from '../adapters/canonical-beo.types';
import type { ConnectedCrmListResult, ConnectedCrmProvider } from './connected-crm.interface';

@Injectable()
export class StubCrmProvider implements ConnectedCrmProvider {
  readonly name = 'tripleseat';
  private readonly logger = new Logger(StubCrmProvider.name);

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return this.config.get<string>('ENABLE_CONNECTED_CRM_PROVIDER') === 'true';
  }

  async listBeosSince(_venueId: string, _cursor?: string): Promise<ConnectedCrmListResult> {
    if (!this.enabled) {
      this.logger.debug?.('Connected CRM provider disabled by config flag.');
      return { beos: [] };
    }
    // Stub implementation returning empty list when enabled
    return { beos: [] };
  }

  async getBeo(_venueId: string, _externalId: string): Promise<CanonicalBeoInput | null> {
    if (!this.enabled) return null;
    return null;
  }

  async subscribeWebhook(_venueId: string, _callbackUrl: string): Promise<{ subscriptionId: string }> {
    if (!this.enabled) {
      throw new Error('Connected CRM provider disabled.');
    }
    return { subscriptionId: `sub_stub_${Date.now()}` };
  }
}
