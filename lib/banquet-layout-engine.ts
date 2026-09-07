export type BanquetSetupStyle =
  | 'banquet_rounds_10'
  | 'banquet_rounds_8'
  | 'classroom'
  | 'theater'
  | 'cocktail'
  | 'u_shape'
  | 'boardroom';

export type TableShapeType = 'round' | 'square' | 'rect' | 'booth';
export type TableSectionType = 'main' | 'patio' | 'bar' | 'vip';

export type PlacedElement = {
  id: string;
  label: string;
  shape: TableShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  seats: number;
  section: TableSectionType;
  category: 'guest_table' | 'head_table' | 'stage' | 'dance_floor' | 'buffet' | 'bar' | 'av';
  notes?: string;
};

export type BanquetLayoutOptions = {
  canvasWidth: number;
  canvasHeight: number;
  guestCount: number;
  setupStyle: BanquetSetupStyle;
  includeStage?: boolean;
  includeDanceFloor?: boolean;
  includeHeadTable?: boolean;
  headTableSeats?: number;
  buffetStationCount?: number;
  barStationCount?: number;
};

export type EquipmentSummary = {
  totalSeats: number;
  guestTableCount: number;
  roundTableCount: number;
  rectTableCount: number;
  buffetCount: number;
  barCount: number;
  hasStage: boolean;
  hasDanceFloor: boolean;
  hasHeadTable: boolean;
};

/**
 * Automatically calculates and places tables and architectural elements
 * based on BEO specifications and room geometry.
 */
export function generateBanquetLayout(options: BanquetLayoutOptions): PlacedElement[] {
  const {
    canvasWidth = 800,
    canvasHeight = 600,
    guestCount = 0,
    setupStyle = 'banquet_rounds_10',
    includeStage = false,
    includeDanceFloor = false,
    includeHeadTable = false,
    headTableSeats = 8,
    buffetStationCount = 0,
    barStationCount = 0,
  } = options;

  if (guestCount <= 0) {
    return [];
  }

  const elements: PlacedElement[] = [];
  const safeLeft = 60;
  const safeRight = canvasWidth - 60;
  let usableTop = 50;
  const safeBottom = canvasHeight - 60;

  // 1. Place Stage / Podium (Front Center)
  if (includeStage) {
    const stageWidth = Math.min(220, canvasWidth * 0.35);
    const stageHeight = 55;
    const stageX = (canvasWidth - stageWidth) / 2;
    const stageY = usableTop;
    elements.push({
      id: 'elem-stage-1',
      label: 'STAGE / PODIUM',
      shape: 'rect',
      x: Math.round(stageX),
      y: Math.round(stageY),
      width: Math.round(stageWidth),
      height: stageHeight,
      seats: 0,
      section: 'vip',
      category: 'stage',
      notes: 'AV Screen & Podium Front Stage',
    });
    usableTop += stageHeight + 25;
  }

  // 2. Place Head Table (VIP front row)
  if (includeHeadTable) {
    const headWidth = Math.min(200, Math.max(120, headTableSeats * 18));
    const headHeight = 44;
    const headX = (canvasWidth - headWidth) / 2;
    const headY = usableTop;
    elements.push({
      id: 'elem-head-table',
      label: 'HEAD TABLE',
      shape: 'rect',
      x: Math.round(headX),
      y: Math.round(headY),
      width: Math.round(headWidth),
      height: headHeight,
      seats: headTableSeats,
      section: 'vip',
      category: 'head_table',
      notes: `VIP / Speaker Seating (${headTableSeats} seats)`,
    });
    usableTop += headHeight + 25;
  }

  // 3. Place Dance Floor (Center)
  let danceFloorBounds: { x: number; y: number; width: number; height: number } | null = null;
  if (includeDanceFloor) {
    const dfSize = Math.min(140, Math.min(canvasWidth, canvasHeight) * 0.28);
    const dfX = (canvasWidth - dfSize) / 2;
    const dfY = usableTop + (canvasHeight - usableTop - 80 - dfSize) * 0.35;
    danceFloorBounds = {
      x: Math.round(dfX),
      y: Math.round(dfY),
      width: Math.round(dfSize),
      height: Math.round(dfSize),
    };
    elements.push({
      id: 'elem-dance-floor',
      label: 'DANCE FLOOR',
      shape: 'square',
      x: danceFloorBounds.x,
      y: danceFloorBounds.y,
      width: danceFloorBounds.width,
      height: danceFloorBounds.height,
      seats: 0,
      section: 'main',
      category: 'dance_floor',
      notes: 'Center Dance Floor Area',
    });
  }

  // 4. Place Perimeter Buffet Stations (Left Wall)
  if (buffetStationCount > 0) {
    const stationHeight = 40;
    const stationWidth = 90;
    for (let b = 0; b < buffetStationCount; b++) {
      const bY = usableTop + 30 + b * (stationHeight + 25);
      if (bY + stationHeight < safeBottom) {
        elements.push({
          id: `elem-buffet-${b + 1}`,
          label: `BUFFET ${String.fromCharCode(65 + b)}`,
          shape: 'rect',
          x: 18,
          y: Math.round(bY),
          width: stationWidth,
          height: stationHeight,
          rotation: 90,
          seats: 0,
          section: 'main',
          category: 'buffet',
          notes: '8ft Catering Service Line',
        });
      }
    }
  }

  // 5. Place Perimeter Bar Stations (Rear Corners)
  if (barStationCount > 0) {
    const barWidth = 80;
    const barHeight = 42;
    // Bar 1 in bottom-right corner
    elements.push({
      id: 'elem-bar-1',
      label: 'MAIN BAR',
      shape: 'rect',
      x: Math.round(canvasWidth - barWidth - 20),
      y: Math.round(canvasHeight - barHeight - 20),
      width: barWidth,
      height: barHeight,
      seats: 0,
      section: 'bar',
      category: 'bar',
      notes: 'Full Service Beverage Station',
    });

    // Bar 2 in bottom-left corner if requested
    if (barStationCount > 1) {
      elements.push({
        id: 'elem-bar-2',
        label: 'SATELLITE BAR',
        shape: 'rect',
        x: 20,
        y: Math.round(canvasHeight - barHeight - 20),
        width: barWidth,
        height: barHeight,
        seats: 0,
        section: 'bar',
        category: 'bar',
        notes: 'Satellite Beer & Wine Station',
      });
    }
  }

  // Calculate guest table area boundaries
  const tableAreaLeft = buffetStationCount > 0 ? 120 : safeLeft;
  const tableAreaRight = safeRight;
  const tableAreaTop = usableTop + 10;
  const tableAreaBottom = barStationCount > 0 ? canvasHeight - 90 : safeBottom;

  // Remaining guests after head table
  const guestsRemaining = Math.max(1, guestCount - (includeHeadTable ? headTableSeats : 0));

  // 6. Generate Guest Tables based on Setup Style
  switch (setupStyle) {
    case 'banquet_rounds_10':
    case 'banquet_rounds_8': {
      const seatsPerTable = setupStyle === 'banquet_rounds_10' ? 10 : 8;
      const numTables = Math.ceil(guestsRemaining / seatsPerTable);
      const diameter = setupStyle === 'banquet_rounds_10' ? 62 : 54;
      const spacingX = diameter + 32;
      const spacingY = diameter + 32;

      const availWidth = tableAreaRight - tableAreaLeft;
      const availHeight = tableAreaBottom - tableAreaTop;
      const cols = Math.max(1, Math.floor(availWidth / spacingX));

      let placed = 0;
      let row = 0;
      let col = 0;

      while (placed < numTables) {
        const x = tableAreaLeft + col * spacingX + (spacingX - diameter) / 2;
        const y = tableAreaTop + row * spacingY + (spacingY - diameter) / 2;

        // Check dance floor collision
        const collidesWithDanceFloor =
          danceFloorBounds &&
          x + diameter > danceFloorBounds.x - 20 &&
          x < danceFloorBounds.x + danceFloorBounds.width + 20 &&
          y + diameter > danceFloorBounds.y - 20 &&
          y < danceFloorBounds.y + danceFloorBounds.height + 20;

        if (!collidesWithDanceFloor && x + diameter <= canvasWidth - 20 && y + diameter <= canvasHeight - 20) {
          placed++;
          elements.push({
            id: `table-round-${placed}`,
            label: `T-${placed}`,
            shape: 'round',
            x: Math.round(x),
            y: Math.round(y),
            width: diameter,
            height: diameter,
            seats: seatsPerTable,
            section: 'main',
            category: 'guest_table',
          });
        }

        col++;
        if (col >= cols) {
          col = 0;
          row++;
          // Safety escape if canvas runs out of space
          if (row > 20) break;
        }
      }
      break;
    }

    case 'classroom': {
      // Rectangular 6-8ft tables in rows facing stage with 3-4 seats each
      const seatsPerTable = 4;
      const numTables = Math.ceil(guestsRemaining / seatsPerTable);
      const tWidth = 90;
      const tHeight = 36;
      const spacingX = tWidth + 28;
      const spacingY = tHeight + 36;
      const availWidth = tableAreaRight - tableAreaLeft;
      const cols = Math.max(1, Math.floor(availWidth / spacingX));

      let placed = 0;
      let row = 0;
      let col = 0;

      while (placed < numTables) {
        const x = tableAreaLeft + col * spacingX + 10;
        const y = tableAreaTop + row * spacingY + 10;

        if (x + tWidth <= canvasWidth - 20 && y + tHeight <= canvasHeight - 20) {
          placed++;
          elements.push({
            id: `table-class-${placed}`,
            label: `C-${placed}`,
            shape: 'rect',
            x: Math.round(x),
            y: Math.round(y),
            width: tWidth,
            height: tHeight,
            seats: seatsPerTable,
            section: 'main',
            category: 'guest_table',
          });
        }

        col++;
        if (col >= cols) {
          col = 0;
          row++;
          if (row > 25) break;
        }
      }
      break;
    }

    case 'theater': {
      // Rows of seats (individual chairs represented as mini square blocks)
      const seatsPerRow = Math.min(14, Math.max(6, Math.floor((tableAreaRight - tableAreaLeft) / 28)));
      const numRows = Math.ceil(guestsRemaining / seatsPerRow);
      const chairSize = 22;
      const aisleSpacing = 28;

      let seatsPlaced = 0;
      for (let r = 0; r < numRows; r++) {
        const y = tableAreaTop + r * (chairSize + 14);
        if (y + chairSize > tableAreaBottom) break;

        for (let c = 0; c < seatsPerRow; c++) {
          if (seatsPlaced >= guestsRemaining) break;
          // Center aisle after half seats
          const centerAisle = c >= Math.floor(seatsPerRow / 2) ? 36 : 0;
          const x = tableAreaLeft + c * aisleSpacing + centerAisle;

          seatsPlaced++;
          elements.push({
            id: `chair-th-${seatsPlaced}`,
            label: `${String.fromCharCode(65 + r)}${c + 1}`,
            shape: 'square',
            x: Math.round(x),
            y: Math.round(y),
            width: chairSize,
            height: chairSize,
            seats: 1,
            section: 'main',
            category: 'guest_table',
          });
        }
      }
      break;
    }

    case 'cocktail': {
      // Mix of high-top cocktail rounds of 4 + some perimeter booths
      const numHighTops = Math.max(4, Math.ceil((guestsRemaining * 0.7) / 4));
      const dia = 42;
      const spacingX = dia + 45;
      const spacingY = dia + 45;
      const availWidth = tableAreaRight - tableAreaLeft;
      const cols = Math.max(1, Math.floor(availWidth / spacingX));

      let placed = 0;
      let row = 0;
      let col = 0;

      while (placed < numHighTops) {
        const x = tableAreaLeft + col * spacingX + 20;
        const y = tableAreaTop + row * spacingY + 20;

        const collidesWithDanceFloor =
          danceFloorBounds &&
          x + dia > danceFloorBounds.x - 15 &&
          x < danceFloorBounds.x + danceFloorBounds.width + 15 &&
          y + dia > danceFloorBounds.y - 15 &&
          y < danceFloorBounds.y + danceFloorBounds.height + 15;

        if (!collidesWithDanceFloor && x + dia <= canvasWidth - 20 && y + dia <= canvasHeight - 20) {
          placed++;
          elements.push({
            id: `cocktail-${placed}`,
            label: `High-Top ${placed}`,
            shape: 'round',
            x: Math.round(x),
            y: Math.round(y),
            width: dia,
            height: dia,
            seats: 4,
            section: 'main',
            category: 'guest_table',
          });
        }

        col++;
        if (col >= cols) {
          col = 0;
          row++;
          if (row > 20) break;
        }
      }
      break;
    }

    case 'u_shape': {
      // U-shape setup facing top
      const tableW = 85;
      const tableH = 34;
      const centerX = canvasWidth / 2;
      const topY = tableAreaTop + 20;

      // Top horizontal table
      elements.push({
        id: 'u-top-1',
        label: 'U-Center',
        shape: 'rect',
        x: Math.round(centerX - tableW / 2),
        y: Math.round(topY),
        width: tableW,
        height: tableH,
        seats: 4,
        section: 'main',
        category: 'guest_table',
      });

      // Left wing
      const wingLength = Math.min(4, Math.ceil(guestsRemaining / 6));
      for (let w = 0; w < wingLength; w++) {
        elements.push({
          id: `u-left-${w + 1}`,
          label: `U-L${w + 1}`,
          shape: 'rect',
          x: Math.round(centerX - tableW / 2 - tableH - 10),
          y: Math.round(topY + tableH + 10 + w * (tableW + 12)),
          width: tableH,
          height: tableW,
          seats: 3,
          section: 'main',
          category: 'guest_table',
        });
      }

      // Right wing
      for (let w = 0; w < wingLength; w++) {
        elements.push({
          id: `u-right-${w + 1}`,
          label: `U-R${w + 1}`,
          shape: 'rect',
          x: Math.round(centerX + tableW / 2 + 10),
          y: Math.round(topY + tableH + 10 + w * (tableW + 12)),
          width: tableH,
          height: tableW,
          seats: 3,
          section: 'main',
          category: 'guest_table',
        });
      }
      break;
    }

    case 'boardroom': {
      // Central large conference hollow/solid setup
      const confWidth = Math.min(320, canvasWidth * 0.6);
      const confHeight = Math.min(160, canvasHeight * 0.4);
      const cX = (canvasWidth - confWidth) / 2;
      const cY = (canvasHeight - confHeight) / 2;

      elements.push({
        id: 'conf-table-main',
        label: 'BOARDROOM TABLE',
        shape: 'rect',
        x: Math.round(cX),
        y: Math.round(cY),
        width: Math.round(confWidth),
        height: Math.round(confHeight),
        seats: Math.min(30, Math.max(12, guestCount)),
        section: 'vip',
        category: 'guest_table',
      });
      break;
    }
  }

  return elements;
}

/**
 * Summarizes the equipment and seat counts for the banquet setup crew.
 */
export function summarizeEquipment(elements: PlacedElement[]): EquipmentSummary {
  let totalSeats = 0;
  let guestTableCount = 0;
  let roundTableCount = 0;
  let rectTableCount = 0;
  let buffetCount = 0;
  let barCount = 0;
  let hasStage = false;
  let hasDanceFloor = false;
  let hasHeadTable = false;

  for (const el of elements) {
    totalSeats += el.seats;
    if (el.category === 'guest_table') guestTableCount++;
    if (el.category === 'buffet') buffetCount++;
    if (el.category === 'bar') barCount++;
    if (el.category === 'stage') hasStage = true;
    if (el.category === 'dance_floor') hasDanceFloor = true;
    if (el.category === 'head_table') hasHeadTable = true;

    if (el.shape === 'round') roundTableCount++;
    if (el.shape === 'rect') rectTableCount++;
  }

  return {
    totalSeats,
    guestTableCount,
    roundTableCount,
    rectTableCount,
    buffetCount,
    barCount,
    hasStage,
    hasDanceFloor,
    hasHeadTable,
  };
}

export const STANDARD_WORKING_TITLES = [
  'Banquet Captain',
  'Catering Supervisor',
  'Head Server',
  'Banquet Attendant',
  'Lead Bartender',
  'Beverage Attendant',
  'Buffet Attendant',
  'VIP Suite Attendant',
  'Chef / Carver',
  'Runner',
] as const;

export type StandardWorkingTitle = (typeof STANDARD_WORKING_TITLES)[number];

export type EventStaffAssignment = {
  id: string;
  staffName: string;
  workingTitle: string;
  assignedStation: string;
  shiftHours?: string;
  notes?: string;
};

/**
 * Recommends optimal staffing ratios and working titles based on BEO
 * guest count and equipment configuration.
 */
export function generateSuggestedStaffRoster(
  guestCount: number,
  equipment: EquipmentSummary
): EventStaffAssignment[] {
  const roster: EventStaffAssignment[] = [];
  let idCounter = 1;

  // 1. Banquet Captain (Always 1 lead per event)
  roster.push({
    id: `staff-sugg-${idCounter++}`,
    staffName: 'Unassigned',
    workingTitle: 'Banquet Captain',
    assignedStation: 'Overall Floor & Timeline Lead',
    shiftHours: '3:30 PM - 11:30 PM',
    notes: 'Floor commander & BEO primary contact',
  });

  // 2. Catering Supervisor (for 80+ guests)
  if (guestCount >= 80) {
    roster.push({
      id: `staff-sugg-${idCounter++}`,
      staffName: 'Unassigned',
      workingTitle: 'Catering Supervisor',
      assignedStation: 'Kitchen & Back of House Liaison',
      shiftHours: '4:00 PM - 11:00 PM',
      notes: 'Course timing & culinary temperature control',
    });
  }

  // 3. Banquet Attendants / Servers (1 per 2-3 tables of 10, or 1 per ~20 guests)
  const serverCount = Math.max(2, Math.ceil(guestCount / 20));
  for (let s = 0; s < serverCount; s++) {
    const tableStart = s * 2 + 1;
    const tableEnd = Math.min(equipment.guestTableCount, tableStart + 1);
    roster.push({
      id: `staff-sugg-${idCounter++}`,
      staffName: 'Unassigned',
      workingTitle: 'Banquet Attendant',
      assignedStation:
        tableEnd >= tableStart
          ? `Tables ${tableStart}–${tableEnd}`
          : `Dining Section ${String.fromCharCode(65 + s)}`,
      shiftHours: '4:30 PM - 11:00 PM',
      notes: 'Plated table service, wine pouring & bussing',
    });
  }

  // 4. Bartenders & Beverage Attendants (1 per bar, plus barback if >= 100 guests)
  for (let b = 0; b < equipment.barCount; b++) {
    roster.push({
      id: `staff-sugg-${idCounter++}`,
      staffName: 'Unassigned',
      workingTitle: 'Lead Bartender',
      assignedStation: `Bar Station ${b + 1}`,
      shiftHours: '4:00 PM - 11:30 PM',
      notes: 'Craft cocktail & beverage service',
    });
    if (guestCount >= 100) {
      roster.push({
        id: `staff-sugg-${idCounter++}`,
        staffName: 'Unassigned',
        workingTitle: 'Beverage Attendant',
        assignedStation: `Bar Station ${b + 1} (Barback)`,
        shiftHours: '4:30 PM - 11:00 PM',
        notes: 'Glassware, ice replenishment & restock',
      });
    }
  }

  // 5. Buffet Attendants & Carvers
  for (let bf = 0; bf < equipment.buffetCount; bf++) {
    roster.push({
      id: `staff-sugg-${idCounter++}`,
      staffName: 'Unassigned',
      workingTitle: 'Buffet Attendant',
      assignedStation: `Buffet Line ${String.fromCharCode(65 + bf)}`,
      shiftHours: '5:00 PM - 9:30 PM',
      notes: 'Chafing dish replenishment & carving service',
    });
  }

  // 6. VIP Head Table Attendant (if head table present)
  if (equipment.hasHeadTable) {
    roster.push({
      id: `staff-sugg-${idCounter++}`,
      staffName: 'Unassigned',
      workingTitle: 'VIP Suite Attendant',
      assignedStation: 'Head Table',
      shiftHours: '4:30 PM - 11:00 PM',
      notes: 'Dedicated VIP guest service',
    });
  }

  return roster;
}

export const BANQUET_LAYOUT_START = '<!-- BANQUET_LAYOUT_START -->';
export const BANQUET_LAYOUT_END = '<!-- BANQUET_LAYOUT_END -->';
export const BANQUET_DATA_PREFIX = '<!-- BANQUET_DATA_JSON:';
export const BANQUET_DATA_SUFFIX = ':END_BANQUET_DATA -->';

export interface SavedBanquetPayload {
  version: 1;
  guestCount: number;
  setupStyle: BanquetSetupStyle;
  includeStage?: boolean;
  includeDanceFloor?: boolean;
  includeHeadTable?: boolean;
  buffetStations?: number;
  barStations?: number;
  elements: PlacedElement[];
  staffRoster: EventStaffAssignment[];
}

/**
 * Extracts notes without previous banquet layout tagged blocks to prevent unbounded note duplication.
 */
export function extractCleanNotes(notes?: string | null): string {
  if (!notes) return '';
  const startIndex = notes.indexOf(BANQUET_LAYOUT_START);
  const endIndex = notes.indexOf(BANQUET_LAYOUT_END);
  if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
    const before = notes.substring(0, startIndex).trim();
    const after = notes.substring(endIndex + BANQUET_LAYOUT_END.length).trim();
    return [before, after].filter(Boolean).join('\n\n');
  }
  return notes.trim();
}

/**
 * Parses embedded JSON from BEO internalNotes if saved previously.
 */
export function parseSavedBanquetData(notes?: string | null): SavedBanquetPayload | null {
  if (!notes) return null;
  const startIdx = notes.indexOf(BANQUET_DATA_PREFIX);
  if (startIdx === -1) return null;
  const endIdx = notes.indexOf(BANQUET_DATA_SUFFIX, startIdx);
  if (endIdx === -1) return null;
  const rawJson = notes.substring(startIdx + BANQUET_DATA_PREFIX.length, endIdx);
  try {
    return JSON.parse(rawJson) as SavedBanquetPayload;
  } catch {
    return null;
  }
}

/**
 * Builds the combined human-readable and machine-readable banquet layout block.
 */
export function buildBanquetNotesBlock(
  cleanNotes: string,
  summaryText: string,
  payload: SavedBanquetPayload
): string {
  const jsonEncoded = JSON.stringify(payload);
  const banquetBlock = [
    BANQUET_LAYOUT_START,
    summaryText,
    `${BANQUET_DATA_PREFIX}${jsonEncoded}${BANQUET_DATA_SUFFIX}`,
    BANQUET_LAYOUT_END,
  ].join('\n');

  if (!cleanNotes) {
    return banquetBlock;
  }
  return `${cleanNotes}\n\n${banquetBlock}`;
}
