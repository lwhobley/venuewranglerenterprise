import type { StadiumZoneData } from '../stadium-map/zone-data';
import type {
  CameraPreset,
  CameraPresetId,
  OperationalHighlightStatus,
  StadiumZoneModelBinding,
  ZoneHighlightState,
} from './stadium-3d.types';

export const CAMERA_PRESETS: Record<CameraPresetId, CameraPreset> = {
  overview: {
    id: 'overview',
    label: 'Overview',
    icon: 'stadium-outline',
    description: 'Full bowl isometric architectural view',
    position: [28, 24, 36],
    target: [0, 2, 0],
  },
  exterior: {
    id: 'exterior',
    label: 'Exterior',
    icon: 'door-sliding',
    description: 'Main entrance gates and facade towers',
    position: [0, 16, 54],
    target: [0, 4, 15],
  },
  field: {
    id: 'field',
    label: 'Field',
    icon: 'football',
    description: 'Pitch level, player benches and endzones',
    position: [0, 4.5, 22],
    target: [0, 1, 0],
  },
  premium: {
    id: 'premium',
    label: 'Premium',
    icon: 'crown-outline',
    description: 'Club 200 terraces and 300/400 luxury suites',
    position: [-22, 10, 16],
    target: [-6, 4, 0],
  },
  concourse: {
    id: 'concourse',
    label: 'Concourse',
    icon: 'storefront-outline',
    description: 'Level 100 food & beverage service areas',
    position: [0, 9, -32],
    target: [0, 2, -10],
  },
};

export const STADIUM_ZONE_MODEL_BINDINGS: StadiumZoneModelBinding[] = [
  {
    zoneId: 'zone-field-sidelines',
    name: 'Field Level & Sidelines',
    level: '0',
    category: 'field_sidelines',
    // The asset is a single scanned mesh split into zone sections by
    // scripts/partition-stadium-glb.mjs; each section is one named node.
    meshNames: ['Node_Field_GrassTurf'],
    anchor: [0, 0.4, 0],
    cameraPreset: 'field',
    colorHex: '#00E5FF',
  },
  {
    zoneId: 'zone-concourse-service-areas',
    name: 'Concourse 100 Service Areas',
    level: '1',
    category: 'concourse_service_areas',
    meshNames: ['Node_Bowl_100_Lower'],
    anchor: [0, 2.5, -6],
    cameraPreset: 'concourse',
    colorHex: '#FFA000',
  },
  {
    zoneId: 'zone-concourse-bunkers',
    name: 'VIP Field Bunkers',
    level: '1',
    category: 'concourse_bunkers',
    // This asset has no bunker geometry. Use the Operations Map/directory.
    meshNames: [],
    anchor: [0, 1.2, -11.5],
    cameraPreset: 'field',
    colorHex: '#69F0AE',
  },
  {
    zoneId: 'zone-200-club',
    name: 'Club Level 200',
    level: '2',
    category: 'club_level',
    meshNames: ['Node_Bowl_200_Club'],
    anchor: [10, 3.4, 0],
    cameraPreset: 'premium',
    colorHex: '#00E5FF',
  },
  {
    zoneId: 'zone-300-suites',
    name: 'Luxury Executive Suites 300',
    level: '3',
    category: 'luxury_suites',
    meshNames: ['Node_Suites_300_Balcony'],
    anchor: [-10.8, 4.4, 0],
    cameraPreset: 'premium',
    colorHex: '#FFD700',
  },
  {
    zoneId: 'zone-400-upper',
    name: '400 Upper Deck Concourse & Skyline Bars',
    level: '4',
    category: 'upper_deck',
    // Upper tiers and the top rim of the bowl, 400 suites included.
    meshNames: ['Node_Bowl_500_UpperRed'],
    anchor: [0, 6.4, 13.5],
    cameraPreset: 'overview',
    colorHex: '#B71C1C',
  },
  {
    zoneId: 'zone-stadium-gates',
    name: 'Main Entry Gates',
    level: '1',
    category: 'stadium_gates',
    // The outer facade, where the entry gates sit.
    meshNames: ['Node_Gate_Exterior'],
    anchor: [0, 3.0, -14],
    cameraPreset: 'exterior',
    colorHex: '#004B87',
  },
  {
    zoneId: 'zone-locker-rooms-aux',
    name: 'Team Lockers & Auxiliary Suites',
    level: '0',
    category: 'locker_rooms_aux',
    // This asset has no locker-room geometry. Use the Operations Map/directory.
    meshNames: [],
    anchor: [-7, 0.4, -6],
    cameraPreset: 'field',
    colorHex: '#7B1FA2',
  },
];

export function findZoneBinding(zoneId: string): StadiumZoneModelBinding | undefined {
  if (!zoneId) return undefined;
  return STADIUM_ZONE_MODEL_BINDINGS.find((b) => b.zoneId === zoneId);
}

/**
 * GLTF nodes in this asset are exported as `Node_<name>`. Comparing on the
 * un-prefixed, lower-cased name keeps bindings robust to exporter casing.
 */
function normalizeMeshName(meshName: string): string {
  return meshName.toLowerCase().replace(/^node_/, '');
}

export function findZoneByMeshName(meshName: string): StadiumZoneModelBinding | undefined {
  if (!meshName) return undefined;
  const normalized = normalizeMeshName(meshName);
  return STADIUM_ZONE_MODEL_BINDINGS.find(
    (b) =>
      b.meshNames.some((m) => normalizeMeshName(m) === normalized) ||
      (b.meshPrefixes ?? []).some((prefix) => normalized.startsWith(normalizeMeshName(prefix)))
  );
}

export function resolveZoneHighlightStatus(
  zone: StadiumZoneData | undefined,
  isSelected: boolean
): OperationalHighlightStatus {
  if (!zone) return 'normal';

  const hasIncident = zone.units.some((u) => u.status === 'incident');
  if (hasIncident) return 'critical';

  if (zone.alertCount > 0) {
    return zone.alertCount >= 3 ? 'critical' : 'attention';
  }

  const hasRestricted = zone.units.some((u) => u.status === 'restricted');
  if (hasRestricted) return 'watch';

  const hasPendingReplenish = zone.units.some((u) => Boolean(u.suiteDetails?.replenishmentPending));
  if (hasPendingReplenish) return 'attention';
  if (isSelected) return 'selected';

  const hasActiveOrders = zone.units.some(
    (u) =>
      Boolean(u.suiteDetails?.inSuiteOrders && u.suiteDetails.inSuiteOrders.length > 0) ||
      Boolean(u.standDetails?.inSeatOrders && u.standDetails.inSeatOrders.length > 0)
  );
  if (hasActiveOrders) return 'watch';

  if (zone.openCount > 0) return 'ready';

  return 'normal';
}

export function getHighlightColor(status: OperationalHighlightStatus): {
  colorHex: string;
  emissiveColor: string;
  intensity: number;
} {
  switch (status) {
    case 'selected':
      return { colorHex: '#00E5FF', emissiveColor: '#00E5FF', intensity: 0.9 };
    case 'critical':
      return { colorHex: '#D32F2F', emissiveColor: '#FF1744', intensity: 0.85 };
    case 'attention':
      return { colorHex: '#F57C00', emissiveColor: '#FF6D00', intensity: 0.75 };
    case 'watch':
      return { colorHex: '#FFB300', emissiveColor: '#FFC107', intensity: 0.65 };
    case 'ready':
      return { colorHex: '#00E676', emissiveColor: '#00C853', intensity: 0.55 };
    case 'normal':
    default:
      return { colorHex: '#90A4AE', emissiveColor: '#000000', intensity: 0.0 };
  }
}

/**
 * One label per status, so the legend, the zone card and the accessible zone
 * list all describe a glowing zone with the same word. They previously carried
 * three separate colour tables and two vocabularies.
 */
export const HIGHLIGHT_STATUS_LABELS: Record<OperationalHighlightStatus, string> = {
  selected: 'Selected',
  critical: 'Critical alert',
  attention: 'Attention needed',
  watch: 'In service',
  ready: 'Operational ready',
  normal: 'Idle',
};

/** The statuses the on-canvas legend explains, in escalation order. */
export const LEGEND_STATUSES: OperationalHighlightStatus[] = [
  'ready',
  'watch',
  'critical',
  'selected',
];

export function buildZoneHighlightStates(
  zones: StadiumZoneData[],
  selectedZoneId: string | null
): Record<string, ZoneHighlightState> {
  const result: Record<string, ZoneHighlightState> = {};

  for (const zone of zones) {
    const isSelected = selectedZoneId === zone.id;
    const status = resolveZoneHighlightStatus(zone, isSelected);
    const { emissiveColor, intensity } = getHighlightColor(status);

    result[zone.id] = {
      zoneId: zone.id,
      status,
      alertCount: zone.alertCount ?? 0,
      openUnitsCount: zone.openCount ?? 0,
      totalUnitsCount: zone.unitsCount ?? zone.units.length,
      emissiveColor,
      emissiveIntensity: intensity,
    };
  }

  return result;
}
