import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import {
  Button,
  Card,
  Chip,
  Dialog,
  IconButton,
  Portal,
  ProgressBar,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useVenueAuth } from '../lib/useVenueAuth';
import { useMutation, useQueryState } from '../lib/railway-hooks';
import { api } from '../lib/railway-api';
import {
  chromeGold,
  colors,
  dept,
  hairline,
  ink,
  radius,
  shadowSoft,
  spacing,
  stone,
  surfaceIvory,
} from '../lib/theme';
import {
  generateBanquetLayout,
  summarizeEquipment,
  generateSuggestedStaffRoster,
  extractCleanNotes,
  parseSavedBanquetData,
  buildBanquetNotesBlock,
  type BanquetSetupStyle,
  type PlacedElement,
  type TableShapeType,
  type TableSectionType,
  type EventStaffAssignment,
  type SavedBanquetPayload,
} from '../lib/banquet-layout-engine';
import { asArray, errorMessage } from '../lib/format';

const CANVAS_WIDTH = 880;
const CANVAS_HEIGHT = 640;

export interface CrmBeoRecord {
  id: string;
  _id?: string;
  venueId?: string;
  leadId?: string | null;
  eventName?: string;
  eventDate?: string | null;
  eventType?: string | null;
  guestCount?: number | null;
  venueSpace?: string | null;
  setupStyle?: string | null;
  specialRequirements?: string | null;
  internalNotes?: string | null;
  layoutJson?: any;
  status?: string;
  assignedRepId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface VenueStaffMember {
  id: string;
  _id?: string;
  fullName: string;
  role?: string;
  email?: string;
}

interface ActiveFloorTableItem {
  id?: string;
  label?: string;
  shape?: TableShapeType;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  seats?: number;
  capacity?: number;
  section?: TableSectionType;
  table?: ActiveFloorTableItem;
}

interface ActiveFloorPlanResponse {
  id?: string;
  name?: string;
  tables?: ActiveFloorTableItem[];
}

export default function BanquetFloorPlanScreen() {
  const params = useLocalSearchParams<{ beoId?: string }>();
  const { venue } = useVenueAuth();

  // Load venue BEOs for selection
  const beosQuery = useQueryState<CrmBeoRecord[]>(api.crm.listBeos, venue?.id ? { venueId: venue.id } : 'skip');
  const beosList = asArray<CrmBeoRecord>(beosQuery.data);

  // Load venue staff members
  const staffQuery = useQueryState<VenueStaffMember[]>(api.app.listVenueStaff);
  const venueStaffList = asArray<VenueStaffMember>(staffQuery.data);

  // Save floor plan and BEO mutations
  const saveFloorPlan = useMutation(api.floor.saveFloorPlan);
  const restoreArchivedFloorPlan = useMutation(api.floor.restoreArchivedFloorPlan);
  const syncBanquetRosterMutation = useMutation(api.stadium.syncBanquetStaffToRoster);
  const saveBeo = useMutation(api.crm.saveBeo);
  const activePlanQuery = useQueryState<ActiveFloorPlanResponse>(api.floor.getActiveFloorPlan, venue?.id ? {} : 'skip');
  const archivedPlansQuery = useQueryState<Array<{
    id: string;
    name: string;
    tableCount: number;
    chairCount: number;
    createdAt: string;
  }>>(api.floor.listArchivedFloorPlans, venue?.id ? {} : 'skip');
  const archivedPlans = asArray<{
    id: string;
    name: string;
    tableCount: number;
    chairCount: number;
    createdAt: string;
  }>(archivedPlansQuery.data);

  // BEO specification state (initialized blank, hydrated from selected BEO)
  const [selectedBeoId, setSelectedBeoId] = useState<string>(params.beoId ?? '');
  const [eventName, setEventName] = useState<string>('');
  const [guestCount, setGuestCount] = useState<number>(0);
  const [setupStyle, setSetupStyle] = useState<BanquetSetupStyle>('banquet_rounds_10');
  const [includeStage, setIncludeStage] = useState<boolean>(false);
  const [includeDanceFloor, setIncludeDanceFloor] = useState<boolean>(false);
  const [includeHeadTable, setIncludeHeadTable] = useState<boolean>(false);
  const [buffetStations, setBuffetStations] = useState<number>(0);
  const [barStations, setBarStations] = useState<number>(0);

  // Layout elements & staff roster (initialized empty, hydrated from BEO)
  const [elements, setElements] = useState<PlacedElement[]>([]);
  const [staffRoster, setStaffRoster] = useState<EventStaffAssignment[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [printMode, setPrintMode] = useState<boolean>(false);
  const [showDeployConfirm, setShowDeployConfirm] = useState<boolean>(false);
  const [showArchivesModal, setShowArchivesModal] = useState<boolean>(false);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [isSyncingRoster, setIsSyncingRoster] = useState<boolean>(false);
  const [rosterSyncResult, setRosterSyncResult] = useState<{ rosterName: string; count: number } | null>(null);
  const lastHydratedBeoIdRef = useRef<string | null>(null);

  // Sync with selected BEO (either saved JSON layout or fresh auto-build from specs)
  useEffect(() => {
    if (!selectedBeoId) {
      lastHydratedBeoIdRef.current = null;
      return;
    }
    if (!beosList.length) return;
    if (lastHydratedBeoIdRef.current === selectedBeoId) return;
    const found = beosList.find((b) => (b._id || b.id) === selectedBeoId);
    if (!found) return;
    lastHydratedBeoIdRef.current = selectedBeoId;

    setEventName(found.eventName ?? 'Banquet Event');

    // 1. Check if structured layoutJson or saved banquet layout JSON exists in the BEO
    const savedData = (found.layoutJson && typeof found.layoutJson === 'object' && Array.isArray((found.layoutJson as any).elements))
      ? (found.layoutJson as any)
      : parseSavedBanquetData(found.internalNotes);
    if (savedData && savedData.elements?.length) {
      setGuestCount(savedData.guestCount ?? found.guestCount ?? 0);
      setSetupStyle(savedData.setupStyle ?? 'banquet_rounds_10');
      setIncludeStage(savedData.includeStage ?? false);
      setIncludeDanceFloor(savedData.includeDanceFloor ?? false);
      setIncludeHeadTable(savedData.includeHeadTable ?? false);
      setBuffetStations(savedData.buffetStations ?? 0);
      setBarStations(savedData.barStations ?? 0);
      setElements(savedData.elements);
      setStaffRoster(savedData.staffRoster ?? []);
      setStatusMessage(`Restored saved layout and staffing lineup for "${found.eventName}".`);
      return;
    }

    // 2. Otherwise detect specs from BEO fields and generate layout if guest count exists
    const count = found.guestCount && found.guestCount > 0 ? found.guestCount : 0;
    setGuestCount(count);

    let detectedStyle: BanquetSetupStyle = 'banquet_rounds_10';
    if (found.setupStyle) {
      const s = found.setupStyle.toLowerCase();
      if (s.includes('theater')) detectedStyle = 'theater';
      else if (s.includes('classroom')) detectedStyle = 'classroom';
      else if (s.includes('cocktail') || s.includes('reception')) detectedStyle = 'cocktail';
      else if (s.includes('u-shape') || s.includes('u_shape')) detectedStyle = 'u_shape';
      else if (s.includes('boardroom') || s.includes('conference')) detectedStyle = 'boardroom';
      else if (s.includes('8')) detectedStyle = 'banquet_rounds_8';
      else detectedStyle = 'banquet_rounds_10';
    }
    setSetupStyle(detectedStyle);

    let hasDance = false;
    let hasStage = false;
    let hasHead = false;
    if (found.specialRequirements) {
      const req = found.specialRequirements.toLowerCase();
      if (req.includes('dance')) hasDance = true;
      if (req.includes('stage') || req.includes('podium')) hasStage = true;
      if (req.includes('head table') || req.includes('bridal')) hasHead = true;
    }
    setIncludeDanceFloor(hasDance);
    setIncludeStage(hasStage);
    setIncludeHeadTable(hasHead);

    if (count > 0) {
      const generated = generateBanquetLayout({
        canvasWidth: CANVAS_WIDTH,
        canvasHeight: CANVAS_HEIGHT,
        guestCount: count,
        setupStyle: detectedStyle,
        includeStage: hasStage,
        includeDanceFloor: hasDance,
        includeHeadTable: hasHead,
        buffetStationCount: 1,
        barStationCount: 1,
      });
      const equip = summarizeEquipment(generated);
      setElements(generated);
      setStaffRoster(generateSuggestedStaffRoster(count, equip));
      setStatusMessage(`Auto-generated layout for "${found.eventName}" (${count} target guests).`);
    } else {
      setElements([]);
      setStaffRoster([]);
      setStatusMessage(`Loaded "${found.eventName}". Enter guest count and build layout.`);
    }
  }, [selectedBeoId, beosList]);

  // Equipment and seat metrics
  const equipment = useMemo(() => summarizeEquipment(elements), [elements]);
  const capacityPct = guestCount > 0 ? Math.min(1, equipment.totalSeats / guestCount) : 1;

  // Handle auto-generation from current specs
  const handleAutoBuild = () => {
    if (guestCount <= 0) {
      setStatusMessage('Please enter a valid guest count before building the layout.');
      return;
    }
    const generated = generateBanquetLayout({
      canvasWidth: CANVAS_WIDTH,
      canvasHeight: CANVAS_HEIGHT,
      guestCount,
      setupStyle,
      includeStage,
      includeDanceFloor,
      includeHeadTable,
      buffetStationCount: buffetStations,
      barStationCount: barStations,
    });
    const newEquip = summarizeEquipment(generated);
    setElements(generated);
    setStaffRoster(generateSuggestedStaffRoster(guestCount, newEquip));
    setSelectedId(null);
    setStatusMessage(
      `Auto-generated layout with ${generated.length} tables/stations and ${guestCount} target capacity.`
    );
  };

  // Staff roster management functions
  const updateStaffAssignment = (id: string, key: keyof EventStaffAssignment, value: string) => {
    setStaffRoster((prev) => prev.map((s) => (s.id === id ? { ...s, [key]: value } : s)));
  };

  const removeStaffAssignment = (id: string) => {
    setStaffRoster((prev) => prev.filter((s) => s.id !== id));
  };

  const addStaffAssignment = (workingTitle = 'Banquet Attendant', station = 'Dining Floor') => {
    const newStaff: EventStaffAssignment = {
      id: `staff-${Date.now()}`,
      staffName: 'Unassigned',
      workingTitle,
      assignedStation: station,
      shiftHours: '4:30 PM - 11:00 PM',
    };
    setStaffRoster((prev) => [...prev, newStaff]);
  };

  // Selected element lookup
  const selectedElement = useMemo(
    () => elements.find((e) => e.id === selectedId) ?? null,
    [elements, selectedId]
  );

  // Move element
  const updateElementPosition = (id: string, newX: number, newY: number) => {
    setElements((prev) =>
      prev.map((el) => {
        if (el.id !== id) return el;
        const grid = snapToGrid ? 10 : 1;
        const snappedX = Math.max(10, Math.min(CANVAS_WIDTH - el.width - 10, Math.round(newX / grid) * grid));
        const snappedY = Math.max(10, Math.min(CANVAS_HEIGHT - el.height - 10, Math.round(newY / grid) * grid));
        return { ...el, x: snappedX, y: snappedY };
      })
    );
  };

  // Update selected element property with full type-safety
  const updateSelectedProp = <K extends keyof PlacedElement>(key: K, value: PlacedElement[K]) => {
    if (!selectedId) return;
    setElements((prev) =>
      prev.map((el) => (el.id === selectedId ? { ...el, [key]: value } : el))
    );
  };

  // Delete selected element
  const deleteSelected = () => {
    if (!selectedId) return;
    setElements((prev) => prev.filter((el) => el.id !== selectedId));
    setSelectedId(null);
  };

  // Add custom manual table
  const addManualTable = (shape: TableShapeType, seats = 10) => {
    const newId = `custom-table-${Date.now()}`;
    const newTable: PlacedElement = {
      id: newId,
      label: `T-${elements.filter((e) => e.category === 'guest_table').length + 1}`,
      shape,
      x: Math.round(CANVAS_WIDTH / 2 - 30),
      y: Math.round(CANVAS_HEIGHT / 2 - 30),
      width: shape === 'round' ? 60 : 80,
      height: shape === 'round' ? 60 : 45,
      seats,
      section: 'main',
      category: 'guest_table',
    };
    setElements((prev) => [...prev, newTable]);
    setSelectedId(newId);
  };

  // Load existing active venue floor plan into canvas as reference
  const handleLoadActiveVenueFloor = () => {
    const activeData = activePlanQuery.data;
    if (!activeData?.tables?.length) {
      setStatusMessage('No active tables found on the venue floor plan.');
      return;
    }
    const imported: PlacedElement[] = activeData.tables.map((t: ActiveFloorTableItem) => {
      const table = t.table ?? t;
      const isRound = table.shape === 'round';
      return {
        id: table.id ?? `imported-${Math.random()}`,
        label: table.label ?? 'Table',
        shape: table.shape ?? 'round',
        x: table.x ?? 100,
        y: table.y ?? 100,
        width: table.width ?? (isRound ? 60 : 80),
        height: table.height ?? (isRound ? 60 : 45),
        rotation: table.rotation ?? 0,
        seats: table.seats ?? table.capacity ?? 4,
        section: table.section ?? 'main',
        category: 'guest_table',
      };
    });
    setElements(imported);
    setStatusMessage(`Loaded ${imported.length} tables from active venue floor plan.`);
  };

  // 1. Primary Save Action: Persist layout JSON and summary cleanly on the BEO (does NOT touch live venue floor plan)
  const handleSaveToBEO = async () => {
    if (!venue?.id) return;
    if (!selectedBeoId) {
      setStatusMessage('Please select a BEO above before saving the banquet layout.');
      return;
    }
    const found = beosList.find((b) => (b._id || b.id) === selectedBeoId);
    if (!found) {
      setStatusMessage('Selected BEO was not found.');
      return;
    }
    setIsSaving(true);
    setStatusMessage(null);
    try {
      const cleanNotes = extractCleanNotes(found.internalNotes);
      const setupSummary = `[Banquet Floor Plan: ${equipment.roundTableCount}x Rounds, ${equipment.rectTableCount}x Rect, ${equipment.totalSeats} seats placed. ${equipment.hasStage ? 'Stage. ' : ''}${equipment.hasDanceFloor ? 'Dance Floor. ' : ''}${equipment.buffetCount ? `${equipment.buffetCount}x Buffets. ` : ''}${equipment.barCount ? `${equipment.barCount}x Bars.` : ''}]`;
      const rosterSummary = `[Assigned Catering & Banquet Staff (${staffRoster.length} staff - Pre-Shift Duty Lineup, Not Official Payroll Roster)]:\n` +
        staffRoster.map((s) => `• ${s.workingTitle}: ${s.staffName} (${s.assignedStation}${s.shiftHours ? ` · ${s.shiftHours}` : ''})`).join('\n');

      const payload: SavedBanquetPayload = {
        version: 1,
        guestCount,
        setupStyle,
        includeStage,
        includeDanceFloor,
        includeHeadTable,
        buffetStations,
        barStations,
        elements,
        staffRoster,
      };

      const updatedNotes = buildBanquetNotesBlock(
        cleanNotes,
        `${setupSummary}\n\n${rosterSummary}`,
        payload
      );

      await saveBeo({
        venueId: venue.id,
        beoId: selectedBeoId,
        eventName: eventName || found.eventName,
        setupStyle: setupStyle.replace(/_/g, ' '),
        guestCount: guestCount > 0 ? guestCount : (found.guestCount ?? 0),
        internalNotes: updatedNotes,
        layoutJson: payload as any,
      });

      setStatusMessage(`Banquet layout and duty roster saved successfully to BEO "${eventName || found.eventName}"!`);
    } catch (err) {
      setStatusMessage(`Error saving banquet layout to BEO: ${errorMessage(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  // 2. Explicit Secondary Action: Deploy to live restaurant floor plan ONLY after explicit confirmation
  const handleConfirmDeployToActiveFloorPlan = async () => {
    if (!venue?.id) return;
    setShowDeployConfirm(false);
    setIsSaving(true);
    setStatusMessage(null);
    try {
      const tablesPayload = elements.map((el) => ({
        label: el.label,
        shape: el.shape,
        seats: el.seats,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        section: el.section,
        rotation: el.rotation ?? 0,
        capacity: Math.max(1, el.seats),
        minSpend: 0,
        isReservable: el.category === 'guest_table' || el.category === 'head_table',
      }));

      await saveFloorPlan({
        venueId: venue.id,
        name: `${eventName || 'Banquet Event'} (Live Floor Plan Overwrite)`,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        tables: tablesPayload,
        backupPriorPlan: true,
      });

      setStatusMessage('Operational Notice: Live restaurant floor plan updated with banquet layout. An archived backup of the prior FOH layout was saved.');
    } catch (err) {
      setStatusMessage(`Error replacing live floor plan: ${errorMessage(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  // 3. Sync banquet duty assignments directly to DailyTemporaryRoster (VMS)
  const handleSyncToDailyRoster = async () => {
    if (!venue?.id || !staffRoster.length) return;
    setIsSyncingRoster(true);
    setStatusMessage(null);
    try {
      const found = beosList.find((b) => (b._id || b.id) === selectedBeoId);
      const rawDate = found?.eventDate ? new Date(found.eventDate) : new Date();
      const opDate = !isNaN(rawDate.getTime())
        ? rawDate.toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const workersPayload = staffRoster.map((s) => ({
        workerName: s.staffName !== 'Unassigned' ? s.staffName : 'Banquet Staff Member',
        workerRole: s.workingTitle,
        assignedStation: s.assignedStation,
        shiftHours: s.shiftHours,
        notes: s.notes,
      }));

      const res = await syncBanquetRosterMutation({
        venueId: venue.id,
        operationalDate: opDate,
        eventName: eventName || found?.eventName || 'Banquet Event',
        beoId: selectedBeoId || undefined,
        workers: workersPayload,
      });

      setRosterSyncResult({
        rosterName: res.rosterName,
        count: res.workerCount,
      });
      setStatusMessage(`Official Daily Temporary Roster recorded: "${res.rosterName}" with ${res.workerCount} workers.`);
    } catch (err) {
      setStatusMessage(`Error syncing staff to Daily Temporary Roster: ${errorMessage(err)}`);
    } finally {
      setIsSyncingRoster(false);
    }
  };

  // 4. Restore an archived floor plan backup
  const handleRestoreArchive = async (archivePlanId: string, archiveName: string) => {
    if (!venue?.id) return;
    setIsRestoring(true);
    setStatusMessage(null);
    try {
      await restoreArchivedFloorPlan({
        venueId: venue.id,
        archivePlanId,
      });
      setShowArchivesModal(false);
      setStatusMessage(`Restored archived floor plan "${archiveName}". Operational FOH layout is now active.`);
      activePlanQuery.refetch?.();
      archivedPlansQuery.refetch?.();
    } catch (err) {
      setStatusMessage(`Error restoring floor plan: ${errorMessage(err)}`);
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <IconButton
            icon="arrow-left"
            size={24}
            iconColor={colors.primary}
            onPress={() => router.back()}
          />
          <View style={{ flex: 1 }}>
            <Text variant="headlineSmall" style={styles.title}>
              Banquet & Catering Floor Plan
            </Text>
            <Text variant="bodySmall" style={styles.subtitle}>
              Design custom event layouts linked to BEO specifications & duty assignments
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          {archivedPlans.length > 0 && (
            <Button
              mode="outlined"
              icon="history"
              textColor="#334155"
              onPress={() => setShowArchivesModal(true)}
              style={{ borderRadius: radius.sharp, borderColor: '#CBD5E1' }}
            >
              Archived Backups ({archivedPlans.length})
            </Button>
          )}

          <Button
            mode={printMode ? 'contained' : 'outlined'}
            icon="printer"
            textColor={printMode ? '#FFFFFF' : colors.primary}
            buttonColor={printMode ? colors.primary : undefined}
            onPress={() => setPrintMode(!printMode)}
            style={{ borderRadius: radius.sharp }}
          >
            {printMode ? 'Exit Diagram View' : 'Setup Diagram View'}
          </Button>

          <Button
            mode="outlined"
            icon="alert-circle-outline"
            textColor={stone}
            disabled={isSaving || elements.length === 0}
            onPress={() => setShowDeployConfirm(true)}
            style={{ borderRadius: radius.control, borderColor: '#D8CFC0' }}
          >
            Deploy to Live Floor
          </Button>

          <Button
            mode="contained"
            icon="content-save"
            buttonColor={chromeGold}
            textColor={ink}
            loading={isSaving}
            disabled={isSaving || !selectedBeoId}
            onPress={() => void handleSaveToBEO()}
            style={{ borderRadius: radius.control }}
          >
            Save Layout to BEO
          </Button>
        </View>
      </View>

      {statusMessage ? (
        <View style={styles.statusCard}>
          <MaterialCommunityIcons name="information" size={20} color={dept.banquets} />
          <Text style={styles.statusText}>{statusMessage}</Text>
        </View>
      ) : null}

      {!printMode ? (
        <>
          {/* BEO Specs & Auto-Build Card */}
          <Card style={styles.controlCard}>
            <Card.Content style={{ gap: spacing.md }}>
              <View style={styles.cardHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <MaterialCommunityIcons name="clipboard-text-outline" size={22} color={ink} />
                  <Text variant="titleMedium" style={{ fontWeight: '700', color: ink }}>
                    1. BEO Specifications
                  </Text>
                </View>

                {beosList.length > 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 13, color: colors.muted }}>Select BEO:</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {beosList.slice(0, 8).map((b) => (
                          <Chip
                            key={b._id || b.id}
                            selected={selectedBeoId === (b._id || b.id)}
                            onPress={() => setSelectedBeoId(b._id || b.id)}
                            style={{ height: 32 }}
                          >
                            {b.eventName || 'Unnamed BEO'}
                          </Chip>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                ) : (
                  <Text style={{ fontSize: 12, color: colors.muted }}>No BEOs found for this venue.</Text>
                )}
              </View>

              <View style={styles.formRow}>
                <TextInput
                  label="Event Name"
                  placeholder="Select a BEO or enter event name"
                  value={eventName}
                  onChangeText={setEventName}
                  mode="outlined"
                  style={[styles.input, { flex: 2 }]}
                  dense
                />

                <TextInput
                  label="Guest Count"
                  value={guestCount > 0 ? String(guestCount) : ''}
                  placeholder="0"
                  onChangeText={(v) => setGuestCount(Math.max(0, parseInt(v) || 0))}
                  keyboardType="numeric"
                  mode="outlined"
                  style={[styles.input, { flex: 1 }]}
                  dense
                />
              </View>

              {/* Setup Style Selector */}
              <View>
                <Text style={styles.fieldLabel}>Setup Style</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
                    {[
                      { value: 'banquet_rounds_10', label: 'Rounds of 10' },
                      { value: 'banquet_rounds_8', label: 'Rounds of 8' },
                      { value: 'classroom', label: 'Classroom' },
                      { value: 'theater', label: 'Theater' },
                      { value: 'cocktail', label: 'Cocktail / Reception' },
                      { value: 'u_shape', label: 'U-Shape' },
                      { value: 'boardroom', label: 'Boardroom' },
                    ].map((s) => (
                      <Chip
                        key={s.value}
                        selected={setupStyle === s.value}
                        onPress={() => setSetupStyle(s.value as BanquetSetupStyle)}
                        style={{ backgroundColor: setupStyle === s.value ? '#E8F5E9' : '#F1F5F9' }}
                      >
                        {s.label}
                      </Chip>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Special Elements Toggles */}
              <View style={styles.togglesRow}>
                <View style={styles.toggleItem}>
                  <Text style={styles.toggleLabel}>Stage / Podium</Text>
                  <Switch value={includeStage} onValueChange={setIncludeStage} color={dept.banquets} />
                </View>

                <View style={styles.toggleItem}>
                  <Text style={styles.toggleLabel}>Dance Floor</Text>
                  <Switch value={includeDanceFloor} onValueChange={setIncludeDanceFloor} color={dept.banquets} />
                </View>

                <View style={styles.toggleItem}>
                  <Text style={styles.toggleLabel}>Head Table</Text>
                  <Switch value={includeHeadTable} onValueChange={setIncludeHeadTable} color={dept.banquets} />
                </View>

                <View style={styles.toggleItem}>
                  <Text style={styles.toggleLabel}>Buffet Lines</Text>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {[0, 1, 2].map((cnt) => (
                      <Chip
                        key={cnt}
                        selected={buffetStations === cnt}
                        onPress={() => setBuffetStations(cnt)}
                        style={{ height: 28 }}
                      >
                        {cnt}
                      </Chip>
                    ))}
                  </View>
                </View>

                <View style={styles.toggleItem}>
                  <Text style={styles.toggleLabel}>Bars</Text>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {[0, 1, 2].map((cnt) => (
                      <Chip
                        key={cnt}
                        selected={barStations === cnt}
                        onPress={() => setBarStations(cnt)}
                        style={{ height: 28 }}
                      >
                        {cnt}
                      </Chip>
                    ))}
                  </View>
                </View>
              </View>

              <Button
                mode="contained"
                icon="auto-fix"
                buttonColor={chromeGold}
                textColor={ink}
                onPress={handleAutoBuild}
                style={{ borderRadius: radius.control, alignSelf: 'flex-start' }}
              >
                Auto-Build Floor Plan from BEO
              </Button>
            </Card.Content>
          </Card>

          {/* Catering & Banquet Staff Roster Card */}
          <Card style={styles.controlCard}>
            <Card.Content style={{ gap: spacing.md }}>
              <View style={styles.cardHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <MaterialCommunityIcons name="account-group" size={22} color={ink} />
                  <Text variant="titleMedium" style={{ fontWeight: '700', color: ink }}>
                    2. Assigned Event Staff Roster (Working Titles for Today)
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <Button
                    mode="contained"
                    compact
                    icon="account-clock"
                    buttonColor={dept.beverage}
                    loading={isSyncingRoster}
                    disabled={isSyncingRoster || staffRoster.length === 0}
                    onPress={() => void handleSyncToDailyRoster()}
                  >
                    Sync to Daily Roster
                  </Button>
                  <Button
                    mode="outlined"
                    compact
                    icon="plus"
                    onPress={() => addStaffAssignment('Banquet Attendant', 'Dining Floor')}
                  >
                    + Add Staff
                  </Button>
                  <Button
                    mode="text"
                    compact
                    icon="refresh"
                    textColor={stone}
                    disabled={guestCount <= 0}
                    onPress={() => setStaffRoster(generateSuggestedStaffRoster(guestCount, equipment))}
                  >
                    Reset Ratios
                  </Button>
                </View>
              </View>

              {/* Roster Sync Status or Information Banner */}
              {rosterSyncResult ? (
                <View style={[styles.rosterNoticeBanner, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
                  <MaterialCommunityIcons name="check-decagram" size={16} color="#059669" />
                  <Text style={[styles.rosterNoticeText, { color: '#065F46' }]}>
                    Active in Official Daily Temporary Roster: "{rosterSyncResult.rosterName}" ({rosterSyncResult.count} workers recorded in VMS database).
                  </Text>
                </View>
              ) : (
                <View style={[styles.rosterNoticeBanner, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
                  <MaterialCommunityIcons name="clipboard-account" size={16} color="#1D4ED8" />
                  <Text style={[styles.rosterNoticeText, { color: '#1E40AF' }]}>
                    Pre-shift duty lineup ready. Tap "Sync to Daily Roster" to write shifts directly to the official Daily Temporary Roster in VMS.
                  </Text>
                </View>
              )}

              {staffRoster.length === 0 ? (
                <Text style={{ fontSize: 13, color: colors.muted, fontStyle: 'italic' }}>
                  No staff members assigned yet. Build layout above or click "+ Add Staff" to assign duty posts.
                </Text>
              ) : (
                <View style={{ gap: 8 }}>
                  {staffRoster.map((staff) => (
                    <View key={staff.id} style={styles.staffCard}>
                      <View style={styles.staffHeaderRow}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap' }}>
                          <Chip
                            compact
                            style={{
                              backgroundColor:
                                staff.workingTitle === 'Banquet Captain'
                                  ? '#FEF3C7'
                                  : staff.workingTitle === 'Catering Supervisor'
                                  ? '#E0E7FF'
                                  : staff.workingTitle.includes('Bartender')
                                  ? '#EFF6FF'
                                  : '#F1F5F9',
                            }}
                          >
                            {staff.workingTitle}
                          </Chip>
                          <Text style={{ fontWeight: '700', color: '#1E293B', fontSize: 13 }}>
                            {staff.staffName}
                          </Text>
                          <Text style={{ fontSize: 11, color: colors.muted }}>
                            ({staff.assignedStation})
                          </Text>
                        </View>

                        <IconButton
                          icon="close"
                          size={16}
                          iconColor="#94A3B8"
                          onPress={() => removeStaffAssignment(staff.id)}
                        />
                      </View>

                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                        {/* Name input / quick pick */}
                        <TextInput
                          label="Staff Name"
                          value={staff.staffName === 'Unassigned' ? '' : staff.staffName}
                          placeholder={venueStaffList[0]?.fullName ?? 'e.g. Marcus Vance'}
                          onChangeText={(v) => updateStaffAssignment(staff.id, 'staffName', v || 'Unassigned')}
                          mode="outlined"
                          dense
                          style={[styles.input, { flex: 2, minWidth: 140 }]}
                        />

                        {/* Working title selector */}
                        <View style={{ flex: 2, minWidth: 160 }}>
                          <TextInput
                            label="Working Title for Today"
                            value={staff.workingTitle}
                            onChangeText={(v) => updateStaffAssignment(staff.id, 'workingTitle', v)}
                            mode="outlined"
                            dense
                            style={styles.input}
                          />
                        </View>

                        {/* Assigned Station */}
                        <TextInput
                          label="Station / Section"
                          value={staff.assignedStation}
                          onChangeText={(v) => updateStaffAssignment(staff.id, 'assignedStation', v)}
                          mode="outlined"
                          dense
                          style={[styles.input, { flex: 2, minWidth: 140 }]}
                        />

                        {/* Shift Hours */}
                        <TextInput
                          label="Shift Hours"
                          value={staff.shiftHours ?? ''}
                          placeholder="e.g. 4:00 PM - 11:30 PM"
                          onChangeText={(v) => updateStaffAssignment(staff.id, 'shiftHours', v)}
                          mode="outlined"
                          dense
                          style={[styles.input, { flex: 1.5, minWidth: 130 }]}
                        />
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </Card.Content>
          </Card>

          {/* Quick Metrics Bar */}
          <View style={styles.metricsBar}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Total Seats Placed</Text>
              <Text style={styles.metricValue}>
                {equipment.totalSeats} <Text style={{ fontSize: 13, color: colors.muted }}>/ {guestCount} target</Text>
              </Text>
              <ProgressBar
                progress={capacityPct}
                color={equipment.totalSeats >= guestCount && guestCount > 0 ? dept.banquets : '#E65100'}
                style={{ height: 6, borderRadius: 3, marginTop: 4 }}
              />
            </View>

            <View style={styles.metricDivider} />

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Guest Tables</Text>
              <Text style={styles.metricValue}>{equipment.guestTableCount}</Text>
            </View>

            <View style={styles.metricDivider} />

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Buffet Lines</Text>
              <Text style={styles.metricValue}>{equipment.buffetCount}</Text>
            </View>

            <View style={styles.metricDivider} />

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Bars</Text>
              <Text style={styles.metricValue}>{equipment.barCount}</Text>
            </View>
          </View>
        </>
      ) : (
        /* Print / Diagram Mode Header */
        <Card style={[styles.controlCard, { backgroundColor: surfaceIvory }]}>
          <Card.Content>
            <Text variant="titleLarge" style={{ fontWeight: '800', color: ink }}>
              {eventName || 'Banquet Event'} — Setup Specification Diagram
            </Text>
            <Text style={{ color: stone, marginTop: 2 }}>
              Guest Count: {guestCount} | Seats Placed: {equipment.totalSeats} | Style: {setupStyle.replace(/_/g, ' ')}
            </Text>
            <Text style={{ fontSize: 12, color: ink, marginTop: 4 }}>
              Equipment: {equipment.roundTableCount}x Rounds, {equipment.rectTableCount}x Rectangular, {equipment.buffetCount}x Buffets, {equipment.barCount}x Bars, {equipment.totalSeats}x Banquet Chairs
            </Text>

            {/* Staff Duty Lineup on Print Diagram */}
            <View style={{ marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderColor: '#D8CFC0', gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '800', color: ink, fontSize: 13, textTransform: 'uppercase' }}>
                  Pre-Shift Staffing Duty Lineup ({staffRoster.length} Staff Assigned)
                </Text>
                <Text style={{ fontSize: 10, color: '#B45309', fontWeight: '700' }}>
                  (Suggested Duty Lineup — Not Official Payroll Roster)
                </Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {staffRoster.map((s) => (
                  <View key={s.id} style={{ minWidth: 200, padding: 6, backgroundColor: '#FFFFFF', borderRadius: 4, borderWidth: 1, borderColor: '#D8CFC0' }}>
                    <Text style={{ fontWeight: '700', fontSize: 11, color: ink }}>
                      {s.workingTitle}: <Text style={{ color: stone }}>{s.staffName}</Text>
                    </Text>
                    <Text style={{ fontSize: 10, color: stone }}>
                      Station: {s.assignedStation} {s.shiftHours ? `· ${s.shiftHours}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </Card.Content>
        </Card>
      )}

      {/* Interactive Canvas Toolbar */}
      {!printMode ? (
        <View style={styles.canvasToolbar}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: ink }}>
            Interactive Floor Map (Drag to Move)
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 12, color: stone }}>Grid Snap</Text>
              <Switch value={snapToGrid} onValueChange={setSnapToGrid} color={chromeGold} />
            </View>

            <Button
              mode="outlined"
              icon="plus"
              compact
              onPress={() => addManualTable('round', 10)}
            >
              + Round Table
            </Button>
            <Button
              mode="outlined"
              icon="plus"
              compact
              onPress={() => addManualTable('rect', 8)}
            >
              + Rect Table
            </Button>
            <Button
              mode="text"
              icon="cloud-download-outline"
              compact
              textColor={stone}
              onPress={handleLoadActiveVenueFloor}
            >
              Load Venue Active Floor
            </Button>
          </View>
        </View>
      ) : null}

      {/* Movable Canvas (Horizontal and Vertical scroll support) */}
      <ScrollView horizontal contentContainerStyle={{ paddingBottom: 16 }}>
        <View style={styles.canvas}>
          {/* Room Boundary Reference Labels */}
          <View style={styles.stageWallIndicator}>
            <Text style={styles.wallIndicatorText}>FRONT / PRESENTATION WALL</Text>
          </View>

          {/* Render empty state or placed elements */}
          {elements.length === 0 ? (
            <View style={styles.emptyCanvasContainer}>
              <MaterialCommunityIcons name="floor-plan" size={52} color="#94A3B8" />
              <Text style={styles.emptyCanvasTitle}>No Banquet Elements Placed</Text>
              <Text style={styles.emptyCanvasSubtitle}>
                Select a BEO above or enter event specifications, then click "Auto-Build Floor Plan from BEO" or add tables manually.
              </Text>
            </View>
          ) : (
            elements.map((elem) => (
              <MovableElement
                key={elem.id}
                element={elem}
                isSelected={selectedId === elem.id}
                isPrintMode={printMode}
                onSelect={() => setSelectedId(elem.id)}
                onMove={(newX, newY) => updateElementPosition(elem.id, newX, newY)}
              />
            ))
          )}
        </View>
      </ScrollView>

      {/* Selected Element Inspector Drawer */}
      {!printMode && selectedElement ? (
        <Card style={styles.inspectorCard}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={styles.cardHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialCommunityIcons name="table-furniture" size={22} color={ink} />
                <Text variant="titleMedium" style={{ fontWeight: '700', color: ink }}>
                  Selected: {selectedElement.label}
                </Text>
              </View>

              <IconButton
                icon="delete-outline"
                iconColor="#C62828"
                size={20}
                onPress={deleteSelected}
              />
            </View>

            <View style={styles.formRow}>
              <TextInput
                label="Label"
                value={selectedElement.label}
                onChangeText={(v) => updateSelectedProp('label', v)}
                mode="outlined"
                dense
                style={[styles.input, { flex: 2 }]}
              />

              <TextInput
                label="Seats"
                value={String(selectedElement.seats)}
                onChangeText={(v) => updateSelectedProp('seats', parseInt(v) || 0)}
                keyboardType="numeric"
                mode="outlined"
                dense
                style={[styles.input, { flex: 1 }]}
              />

              <View style={{ flex: 2 }}>
                <Text style={styles.fieldLabel}>Shape</Text>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  {(['round', 'rect', 'square', 'booth'] as TableShapeType[]).map((sh) => (
                    <Chip
                      key={sh}
                      selected={selectedElement.shape === sh}
                      onPress={() => updateSelectedProp('shape', sh)}
                      style={{ height: 32 }}
                    >
                      {sh}
                    </Chip>
                  ))}
                </View>
              </View>
            </View>

            <Text style={{ fontSize: 11, color: colors.muted }}>
              Coordinates: X: {selectedElement.x}px, Y: {selectedElement.y}px | Category: {selectedElement.category}
            </Text>
          </Card.Content>
        </Card>
      ) : null}

      {/* Explicit Confirmation Dialog for Deploying to Live Active Restaurant Floor Plan */}
      <Portal>
        <Dialog
          visible={showDeployConfirm}
          onDismiss={() => setShowDeployConfirm(false)}
          style={{ backgroundColor: '#FFFFFF', borderRadius: radius.control }}
        >
          <Dialog.Title style={{ fontWeight: '800', color: '#B91C1C' }}>
            Replace Live Restaurant Floor Plan?
          </Dialog.Title>
          <Dialog.Content style={{ gap: spacing.sm }}>
            <Text style={{ color: '#1E293B', fontSize: 14, lineHeight: 20 }}>
              <Text style={{ fontWeight: '700', color: '#B91C1C' }}>CRITICAL WARNING: </Text>
              This action overwrites your venue's live operational restaurant floor plan (active table sections, reservations, and waitlist tables) with these banquet event tables.
            </Text>
            <Text style={{ color: ink, fontSize: 13, lineHeight: 18, fontWeight: '600', backgroundColor: surfaceIvory, borderWidth: hairline, borderColor: '#D8CFC0', padding: 8, borderRadius: 6 }}>
              Safety Backup: A timestamped copy of your existing active floor plan will be automatically saved to your archived floor plans so the original FOH layout can be restored at any time.
            </Text>
            <Text style={{ color: '#64748B', fontSize: 13, lineHeight: 18 }}>
              Standard banquet setups should be saved directly to the BEO using "Save Layout to BEO" instead.
            </Text>
            <Text style={{ color: '#1E293B', fontSize: 13, fontWeight: '600' }}>
              Are you sure you want to overwrite the active restaurant layout with this banquet plan?
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setShowDeployConfirm(false)} textColor="#64748B">
              Cancel
            </Button>
            <Button
              mode="contained"
              buttonColor="#B91C1C"
              textColor="#FFFFFF"
              onPress={() => void handleConfirmDeployToActiveFloorPlan()}
            >
              Yes, Overwrite Live Floor
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* Restore Archived Floor Plan Dialog */}
        <Dialog
          visible={showArchivesModal}
          onDismiss={() => setShowArchivesModal(false)}
          style={{ backgroundColor: '#FFFFFF', maxWidth: 540, alignSelf: 'center', width: '92%', borderRadius: radius.control }}
        >
          <Dialog.Title style={{ color: ink, fontWeight: '800' }}>
            Archived Floor Plan Backups
          </Dialog.Title>
          <Dialog.Content style={{ gap: 12, maxHeight: 400 }}>
            <Text style={{ color: '#64748B', fontSize: 13 }}>
              Prior live floor plans backed up before event overwrites. Restore any archived layout at any time to return your operational FOH tables and seating to service.
            </Text>
            {archivedPlans.length === 0 ? (
              <Text style={{ fontStyle: 'italic', color: '#94A3B8', marginVertical: 12 }}>
                No archived backups found for this venue.
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 260 }}>
                <View style={{ gap: 8 }}>
                  {archivedPlans.map((arch) => (
                    <View
                      key={arch.id}
                      style={{
                        padding: 12,
                        backgroundColor: '#FFFFFF',
                        borderRadius: radius.control,
                        borderWidth: hairline,
                        borderColor: '#D8CFC0',
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <View style={{ flex: 1, marginRight: 12 }}>
                        <Text style={{ fontWeight: '700', color: '#1E293B', fontSize: 13 }}>
                          {arch.name}
                        </Text>
                        <Text style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                          {arch.tableCount} tables • {arch.chairCount} chairs • {new Date(arch.createdAt).toLocaleString()}
                        </Text>
                      </View>
                      <Button
                        mode="contained"
                        compact
                        buttonColor={chromeGold}
                        textColor={ink}
                        loading={isRestoring}
                        disabled={isRestoring}
                        onPress={() => void handleRestoreArchive(arch.id, arch.name)}
                      >
                        Restore
                      </Button>
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setShowArchivesModal(false)} textColor="#64748B">
              Close
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScrollView>
  );
}

/**
 * Movable table or architectural block with pan responder support
 */
function MovableElement({
  element,
  isSelected,
  isPrintMode,
  onSelect,
  onMove,
}: {
  element: PlacedElement;
  isSelected: boolean;
  isPrintMode: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
}) {
  const currentPos = useRef({ x: element.x, y: element.y });
  currentPos.current = { x: element.x, y: element.y };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !isPrintMode,
        onMoveShouldSetPanResponder: () => !isPrintMode,
        onPanResponderGrant: () => {
          onSelect();
        },
        onPanResponderMove: (_evt, gestureState) => {
          onMove(
            currentPos.current.x + gestureState.dx,
            currentPos.current.y + gestureState.dy
          );
        },
      }),
    [isPrintMode, onSelect, onMove]
  );

  // Determine element styling based on category
  const isRound = element.shape === 'round';
  const isStage = element.category === 'stage';
  const isDanceFloor = element.category === 'dance_floor';
  const isBuffet = element.category === 'buffet';
  const isBar = element.category === 'bar';
  const isHead = element.category === 'head_table';

  let bgColor = '#FFFFFF';
  let borderColor: string = dept.banquets;
  let textColor: string = ink;

  if (isStage) {
    bgColor = '#1E293B';
    borderColor = '#0F172A';
    textColor = '#FFFFFF';
  } else if (isDanceFloor) {
    bgColor = '#FEF3C7';
    borderColor = '#D97706';
    textColor = '#92400E';
  } else if (isBuffet) {
    bgColor = '#FFF7ED';
    borderColor = '#EA580C';
    textColor = '#C2410C';
  } else if (isBar) {
    bgColor = '#EFF6FF';
    borderColor = '#2563EB';
    textColor = '#1E40AF';
  } else if (isHead) {
    bgColor = '#FDF2F8';
    borderColor = '#DB2777';
    textColor = '#BE185D';
  }

  return (
    <View
      {...panResponder.panHandlers}
      style={[
        styles.elementBase,
        {
          left: element.x,
          top: element.y,
          width: element.width,
          height: element.height,
          backgroundColor: bgColor,
          borderColor: isSelected ? '#3B82F6' : borderColor,
          borderWidth: isSelected ? 2.5 : 1.5,
          borderRadius: isRound ? element.width / 2 : 6,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.elementLabel,
          {
            color: textColor,
            fontSize: isStage ? 11 : isDanceFloor ? 11 : 10,
            fontWeight: '700',
          },
        ]}
      >
        {element.label}
      </Text>

      {element.seats > 0 ? (
        <View style={styles.seatBadge}>
          <Text style={styles.seatBadgeText}>{element.seats}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: surfaceIvory,
  },
  contentContainer: {
    padding: spacing.md,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#FFFFFF',
    padding: spacing.md,
    borderRadius: radius.control,
    borderWidth: hairline,
    borderColor: '#D8CFC0',
    ...shadowSoft,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
    minWidth: 280,
  },
  title: {
    fontWeight: '800',
    color: ink,
    letterSpacing: -0.3,
  },
  subtitle: {
    color: stone,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderColor: dept.banquets,
    borderWidth: 1,
    borderRadius: radius.control,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    ...shadowSoft,
  },
  statusCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 4,
  },
  statusText: {
    color: ink,
    fontWeight: '600',
    fontSize: 13,
  },
  controlCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.control,
    borderColor: '#D8CFC0',
    borderWidth: hairline,
    ...shadowSoft,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  rosterNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    padding: 8,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: '#D8CFC0',
  },
  rosterNoticeText: {
    fontSize: 12,
    color: stone,
    fontWeight: '600',
    flex: 1,
  },
  formRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    alignItems: 'center',
  },
  input: {
    backgroundColor: '#FFFFFF',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: ink,
    marginBottom: 4,
  },
  togglesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    alignItems: 'center',
    backgroundColor: surfaceIvory,
    padding: spacing.sm,
    borderRadius: radius.control,
    borderWidth: hairline,
    borderColor: '#D8CFC0',
  },
  toggleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toggleLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: ink,
  },
  metricsBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    padding: spacing.md,
    borderRadius: radius.control,
    borderColor: '#D8CFC0',
    borderWidth: hairline,
    alignItems: 'center',
    justifyContent: 'space-around',
    flexWrap: 'wrap',
    gap: spacing.sm,
    ...shadowSoft,
  },
  metricItem: {
    minWidth: 120,
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 11,
    color: stone,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '800',
    color: dept.banquets,
    marginTop: 2,
  },
  metricDivider: {
    width: hairline,
    height: 32,
    backgroundColor: '#D8CFC0',
  },
  canvasToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  canvas: {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.control,
    borderWidth: hairline,
    borderColor: '#D8CFC0',
    position: 'relative',
    overflow: 'hidden',
    ...shadowSoft,
  },
  emptyCanvasContainer: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    gap: 10,
  },
  emptyCanvasTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: stone,
  },
  emptyCanvasSubtitle: {
    fontSize: 13,
    color: stone,
    textAlign: 'center',
    maxWidth: 440,
    lineHeight: 18,
  },
  stageWallIndicator: {
    position: 'absolute',
    top: 6,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  wallIndicatorText: {
    fontSize: 9,
    fontWeight: '800',
    color: stone,
    letterSpacing: 1.5,
  },
  elementBase: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  elementLabel: {
    textAlign: 'center',
  },
  seatBadge: {
    position: 'absolute',
    bottom: -6,
    right: -6,
    backgroundColor: dept.banquets,
    borderRadius: 10,
    width: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  seatBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
  inspectorCard: {
    backgroundColor: '#FFFFFF',
    borderColor: dept.banquets,
    borderWidth: 1.5,
    borderRadius: radius.control,
    ...shadowSoft,
  },
  staffCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D8CFC0',
    borderWidth: hairline,
    borderRadius: radius.control,
    padding: spacing.sm,
    gap: 6,
  },
  staffHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
