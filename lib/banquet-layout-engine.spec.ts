import { describe, expect, it } from 'vitest';
import {
  generateBanquetLayout,
  summarizeEquipment,
  generateSuggestedStaffRoster,
  extractCleanNotes,
  parseSavedBanquetData,
  buildBanquetNotesBlock,
} from './banquet-layout-engine';

describe('banquet-layout-engine', () => {
  it('generates banquet rounds of 10 correctly for 120 guests', () => {
    const layout = generateBanquetLayout({
      canvasWidth: 800,
      canvasHeight: 600,
      guestCount: 120,
      setupStyle: 'banquet_rounds_10',
      includeStage: true,
      includeDanceFloor: true,
      buffetStationCount: 2,
      barStationCount: 1,
    });

    expect(layout.length).toBeGreaterThan(12);

    // Verify stage and dance floor
    const stage = layout.find((e) => e.category === 'stage');
    expect(stage).toBeDefined();
    expect(stage?.label).toContain('STAGE');

    const danceFloor = layout.find((e) => e.category === 'dance_floor');
    expect(danceFloor).toBeDefined();

    // Verify buffet and bar
    const buffets = layout.filter((e) => e.category === 'buffet');
    expect(buffets.length).toBe(2);

    const bars = layout.filter((e) => e.category === 'bar');
    expect(bars.length).toBe(1);

    // Verify summary equipment
    const summary = summarizeEquipment(layout);
    expect(summary.totalSeats).toBeGreaterThanOrEqual(110);
    expect(summary.hasStage).toBe(true);
    expect(summary.hasDanceFloor).toBe(true);
    expect(summary.buffetCount).toBe(2);
  });

  it('generates classroom layout in rows', () => {
    const layout = generateBanquetLayout({
      canvasWidth: 800,
      canvasHeight: 600,
      guestCount: 60,
      setupStyle: 'classroom',
      includeStage: true,
    });

    const tables = layout.filter((e) => e.category === 'guest_table');
    expect(tables.length).toBeGreaterThanOrEqual(14);
    expect(tables.every((t) => t.shape === 'rect')).toBe(true);
    expect(tables.every((t) => t.seats === 4)).toBe(true);
  });

  it('generates theater seating with individual seats and center aisle', () => {
    const layout = generateBanquetLayout({
      canvasWidth: 800,
      canvasHeight: 600,
      guestCount: 50,
      setupStyle: 'theater',
      includeStage: true,
    });

    const chairs = layout.filter((e) => e.category === 'guest_table');
    expect(chairs.length).toBe(50);
    expect(chairs[0].seats).toBe(1);
  });

  it('generates cocktail reception with high-tops and bar stations', () => {
    const layout = generateBanquetLayout({
      canvasWidth: 800,
      canvasHeight: 600,
      guestCount: 80,
      setupStyle: 'cocktail',
      includeDanceFloor: true,
      barStationCount: 2,
    });

    const highTops = layout.filter((e) => e.category === 'guest_table');
    expect(highTops.length).toBeGreaterThanOrEqual(10);
    expect(highTops.every((t) => t.shape === 'round')).toBe(true);

    const bars = layout.filter((e) => e.category === 'bar');
    expect(bars.length).toBe(2);
  });

  it('generates head table when requested', () => {
    const layout = generateBanquetLayout({
      canvasWidth: 800,
      canvasHeight: 600,
      guestCount: 100,
      setupStyle: 'banquet_rounds_8',
      includeHeadTable: true,
      headTableSeats: 10,
    });

    const headTable = layout.find((e) => e.category === 'head_table');
    expect(headTable).toBeDefined();
    expect(headTable?.seats).toBe(10);
  });

  it('generates recommended staff roster with working titles based on BEO specifications', () => {
    const layout = generateBanquetLayout({
      canvasWidth: 800,
      canvasHeight: 600,
      guestCount: 150,
      setupStyle: 'banquet_rounds_10',
      includeStage: true,
      includeHeadTable: true,
      buffetStationCount: 2,
      barStationCount: 2,
    });
    const summary = summarizeEquipment(layout);
    const roster = generateSuggestedStaffRoster(150, summary);

    expect(roster.length).toBeGreaterThan(10);

    // Verify key working titles exist
    const captain = roster.find((r) => r.workingTitle === 'Banquet Captain');
    expect(captain).toBeDefined();
    expect(captain?.assignedStation).toContain('Floor');

    const supervisor = roster.find((r) => r.workingTitle === 'Catering Supervisor');
    expect(supervisor).toBeDefined();

    const attendants = roster.filter((r) => r.workingTitle === 'Banquet Attendant');
    expect(attendants.length).toBeGreaterThanOrEqual(7);

    const bartenders = roster.filter((r) => r.workingTitle === 'Lead Bartender');
    expect(bartenders.length).toBe(2);

    const buffetStaff = roster.filter((r) => r.workingTitle === 'Buffet Attendant');
    expect(buffetStaff.length).toBe(2);

    const headTableAttendant = roster.find((r) => r.workingTitle === 'VIP Suite Attendant');
    expect(headTableAttendant).toBeDefined();
  });

  it('serializes, cleans, and deserializes banquet layout notes blocks without unbounded duplication', () => {
    const originalNotes = 'Client requested gluten-free meals at Table 2.\nVIP contact: Jane Doe (555-0199).';
    const samplePayload = {
      version: 1 as const,
      guestCount: 120,
      setupStyle: 'banquet_rounds_10' as const,
      elements: [
        {
          id: 'table-1',
          label: 'T-1',
          shape: 'round' as const,
          x: 150,
          y: 200,
          width: 60,
          height: 60,
          seats: 10,
          section: 'main' as const,
          category: 'guest_table' as const,
        },
      ],
      staffRoster: [
        {
          id: 'staff-1',
          staffName: 'Chef Antoine',
          workingTitle: 'Banquet Captain',
          assignedStation: 'Main Dining',
        },
      ],
    };

    // First save
    const firstSavedNotes = buildBanquetNotesBlock(originalNotes, '[Layout Summary 1]', samplePayload);
    expect(firstSavedNotes).toContain(originalNotes);
    expect(firstSavedNotes).toContain('<!-- BANQUET_LAYOUT_START -->');
    expect(firstSavedNotes).toContain('<!-- BANQUET_LAYOUT_END -->');

    // Parse payload back
    const parsed = parseSavedBanquetData(firstSavedNotes);
    expect(parsed).toBeDefined();
    expect(parsed?.elements.length).toBe(1);
    expect(parsed?.elements[0].label).toBe('T-1');
    expect(parsed?.staffRoster[0].workingTitle).toBe('Banquet Captain');

    // Second save: clean notes should strip previous banquet block completely
    const cleanedNotes = extractCleanNotes(firstSavedNotes);
    expect(cleanedNotes).toBe(originalNotes);
    expect(cleanedNotes).not.toContain('<!-- BANQUET_LAYOUT_START -->');

    // Resaving with updated payload
    const secondSavedNotes = buildBanquetNotesBlock(cleanedNotes, '[Layout Summary 2]', {
      ...samplePayload,
      guestCount: 150,
    });

    // Verify it doesn't double-append
    const startOccurrences = (secondSavedNotes.match(/<!-- BANQUET_LAYOUT_START -->/g) || []).length;
    expect(startOccurrences).toBe(1);

    const parsedSecond = parseSavedBanquetData(secondSavedNotes);
    expect(parsedSecond?.guestCount).toBe(150);
  });
});
