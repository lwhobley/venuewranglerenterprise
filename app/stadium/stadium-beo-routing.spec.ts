import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { crmBeoRoute, crmEventBeoRoute, READINESS_ROW_ROUTES } from '../../lib/crm-routing';

describe('Stadium BEO Deep-Link Contract (Phase A Extract)', () => {
  it('routes specific BEO records to /stadium/beo-hub?beoId=...', () => {
    const route = crmBeoRoute('beo-nfl-9901');
    expect(route).toBe('/stadium/beo-hub?beoId=beo-nfl-9901');
    expect(route).not.toContain('(tabs)/guests');
    expect(route).not.toContain('crmView');
  });

  it('routes event BEO filters to /stadium/beo-hub?event=...', () => {
    const route = crmEventBeoRoute('Playoff Game');
    expect(route).toBe('/stadium/beo-hub?event=Playoff+Game');
    expect(route).not.toContain('(tabs)/guests');
    expect(route).not.toContain('crmView');
  });

  it('routes fallback event BEO route directly to /stadium/beo-hub', () => {
    expect(crmEventBeoRoute()).toBe('/stadium/beo-hub');
  });

  it('routes Luxury Suite BEO readiness row directly to /stadium/beo-hub', () => {
    expect(READINESS_ROW_ROUTES['Luxury Suite BEOs']).toBe('/stadium/beo-hub');
  });

  it('guarantees zero occurrences of (tabs)/guests or crmView in app/stadium screens', () => {
    const stadiumDir = join(__dirname);
    const files = readdirSync(stadiumDir).filter(
      (f) => (f.endsWith('.tsx') || f.endsWith('.ts')) && !f.includes('.spec.') && !f.includes('.test.')
    );

    for (const file of files) {
      const content = readFileSync(join(stadiumDir, file), 'utf-8');
      expect(content).not.toContain('(tabs)/guests');
      expect(content).not.toContain('crmView');
    }
  });
});
