import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import {
  Button,
  Card,
  Chip,
  Divider,
  IconButton,
  Menu,
  ProgressBar,
  SegmentedButtons,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useVenueAuth } from '../lib/useVenueAuth';
import { useMutation, useQueryState } from '../lib/railway-hooks';
import { api } from '../lib/railway-api';
import { colors, radius, spacing } from '../lib/theme';
import {
  generateBanquetLayout,
  summarizeEquipment,
  generateSuggestedStaffRoster,
  STANDARD_WORKING_TITLES,
  type BanquetSetupStyle,
  type PlacedElement,
  type TableShapeType,
  type TableSectionType,
  type EventStaffAssignment,
} from '../lib/banquet-layout-engine';
import { asArray, errorMessage } from '../lib/format';

const CANVAS_WIDTH = 880;
const CANVAS_HEIGHT = 640;

export default function BanquetFloorPlanScreen() {
  const params = useLocalSearchParams<{ beoId?: string }>();
  const { venue, canManage } = useVenueAuth();

  // Load venue BEOs for selection
  const beosQuery = useQueryState<any>(api.crm.listBeos, venue?.id ? { venueId: venue.id } : 'skip');
  const beosList = asArray<any>(beosQuery.data);

  // Load venue staff members
  const staffQuery = useQueryState<any>(api.app.listVenueStaff);
  const venueStaffList = asArray<any>(staffQuery.data);

  // Save floor plan and BEO mutations
  const saveFloorPlan = useMutation(api.floor.saveFloorPlan);
  const saveBeo = useMutation(api.crm.saveBeo);
  const activePlanQuery = useQueryState<any>(api.floor.getActiveFloorPlan, venue?.id ? {} : 'skip');

  // BEO specification state
  const [selectedBeoId, setSelectedBeoId] = useState<string>(params.beoId ?? '');
  const [eventName, setEventName] = useState<string>('Spring Gala Banquet');
  const [guestCount, setGuestCount] = useState<number>(120);
  const [setupStyle, setSetupStyle] = useState<BanquetSetupStyle>('banquet_rounds_10');
  const [includeStage, setIncludeStage] = useState<boolean>(true);
  const [includeDanceFloor, setIncludeDanceFloor] = useState<boolean>(true);
  const [includeHeadTable, setIncludeHeadTable] = useState<boolean>(false);
  const [buffetStations, setBuffetStations] = useState<number>(2);
  const [barStations, setBarStations] = useState<number>(1);

  // Layout elements
  const [elements, setElements] = useState<PlacedElement[]>(() =>
    generateBanquetLayout({
      canvasWidth: CANVAS_WIDTH,
      canvasHeight: CANVAS_HEIGHT,
      guestCount: 120,
      setupStyle: 'banquet_rounds_10',
      includeStage: true,
      includeDanceFloor: true,
      includeHeadTable: false,
      buffetStationCount: 2,
      barStationCount: 1,
    })
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [printMode, setPrintMode] = useState<boolean>(false);

  // Sync with selected BEO
  useEffect(() => {
    if (!selectedBeoId || !beosList.length) return;
    const found = beosList.find((b) => b._id === selectedBeoId || b.id === selectedBeoId);
    if (found) {
      setEventName(found.eventName ?? 'Banquet Event');
      if (found.guestCount && found.guestCount > 0) {
        setGuestCount(found.guestCount);
      }
      if (found.setupStyle) {
        const s = found.setupStyle.toLowerCase();
        if (s.includes('theater')) setSetupStyle('theater');
        else if (s.includes('classroom')) setSetupStyle('classroom');
        else if (s.includes('cocktail') || s.includes('reception')) setSetupStyle('cocktail');
        else if (s.includes('u-shape') || s.includes('u_shape')) setSetupStyle('u_shape');
        else if (s.includes('boardroom') || s.includes('conference')) setSetupStyle('boardroom');
        else if (s.includes('8')) setSetupStyle('banquet_rounds_8');
        else setSetupStyle('banquet_rounds_10');
      }
      if (found.specialRequirements) {
        const req = found.specialRequirements.toLowerCase();
        if (req.includes('dance')) setIncludeDanceFloor(true);
        if (req.includes('stage') || req.includes('podium')) setIncludeStage(true);
        if (req.includes('head table') || req.includes('bridal')) setIncludeHeadTable(true);
      }
    }
  }, [selectedBeoId, beosList]);

  // Equipment and seat metrics
  const equipment = useMemo(() => summarizeEquipment(elements), [elements]);
  const capacityPct = guestCount > 0 ? Math.min(1, equipment.totalSeats / guestCount) : 1;

  // Staff roster state (Working titles for the event day)
  const [staffRoster, setStaffRoster] = useState<EventStaffAssignment[]>(() =>
    generateSuggestedStaffRoster(120, summarizeEquipment(elements))
  );

  // Handle auto-generation from current specs
  const handleAutoBuild = () => {
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

  // Update selected element property
  const updateSelectedProp = (key: keyof PlacedElement, value: any) => {
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

  // Load existing active venue floor plan into canvas
  const handleLoadActiveVenueFloor = () => {
    const activeData = activePlanQuery.data;
    if (!activeData?.tables?.length) {
      setStatusMessage('No active tables found on the venue floor plan.');
      return;
    }
    const imported: PlacedElement[] = activeData.tables.map((t: any) => {
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

  // Save as active venue floor plan
  const handleSaveToVenue = async () => {
    if (!venue?.id) return;
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
        name: `${eventName} (BEO Floor Plan)`,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        tables: tablesPayload,
      });

      // If linked to a BEO, keep the BEO notes, setupStyle, and staff roster in sync
      if (selectedBeoId) {
        const found = beosList.find((b) => (b._id || b.id) === selectedBeoId);
        if (found) {
          const setupNote = `[Floor Plan Layout: ${equipment.roundTableCount}x Rounds, ${equipment.rectTableCount}x Rect, ${equipment.totalSeats} seats placed. ${equipment.hasStage ? 'Stage. ' : ''}${equipment.hasDanceFloor ? 'Dance Floor. ' : ''}${equipment.buffetCount ? `${equipment.buffetCount}x Buffets. ` : ''}${equipment.barCount ? `${equipment.barCount}x Bars.` : ''}]`;
          const rosterNote = `[Assigned Catering & Banquet Staff (${staffRoster.length} staff)]:\n` + staffRoster.map((s) => `• ${s.workingTitle}: ${s.staffName} (${s.assignedStation}${s.shiftHours ? ` · ${s.shiftHours}` : ''})`).join('\n');
          await saveBeo({
            venueId: venue.id,
            beoId: selectedBeoId,
            eventName: eventName || found.eventName,
            setupStyle: setupStyle.replace(/_/g, ' '),
            guestCount,
            internalNotes: `${setupNote}\n\n${rosterNote}\n\n${found.internalNotes ?? ''}`.trim(),
          });
        }
      }

      setStatusMessage('Floor plan published to venue devices and synchronized with BEO!');
    } catch (err) {
      setStatusMessage(`Error saving floor plan: ${errorMessage(err)}`);
    } finally {
      setIsSaving(false);
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
              Auto-generate room setup from BEO specifications & interactively customize
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
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
            mode="contained"
            icon="content-save"
            buttonColor="#074426"
            loading={isSaving}
            disabled={isSaving}
            onPress={() => void handleSaveToVenue()}
            style={{ borderRadius: radius.sharp }}
          >
            Publish to Venue
          </Button>
        </View>
      </View>

      {statusMessage ? (
        <Card style={styles.statusCard}>
          <Card.Content style={styles.statusCardContent}>
            <MaterialCommunityIcons name="information" size={20} color="#074426" />
            <Text style={styles.statusText}>{statusMessage}</Text>
          </Card.Content>
        </Card>
      ) : null}

      {!printMode ? (
        <>
          {/* BEO Specs & Auto-Build Card */}
          <Card style={styles.controlCard}>
            <Card.Content style={{ gap: spacing.md }}>
              <View style={styles.cardHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <MaterialCommunityIcons name="clipboard-text-outline" size={22} color="#074426" />
                  <Text variant="titleMedium" style={{ fontWeight: '700', color: '#074426' }}>
                    1. BEO Specifications
                  </Text>
                </View>

                {beosList.length > 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 13, color: colors.muted }}>Link to BEO:</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {beosList.slice(0, 5).map((b) => (
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
                ) : null}
              </View>

              <View style={styles.formRow}>
                <TextInput
                  label="Event Name"
                  value={eventName}
                  onChangeText={setEventName}
                  mode="outlined"
                  style={[styles.input, { flex: 2 }]}
                  dense
                />

                <TextInput
                  label="Guest Count"
                  value={String(guestCount)}
                  onChangeText={(v) => setGuestCount(Math.max(1, parseInt(v) || 0))}
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
                  <Switch value={includeStage} onValueChange={setIncludeStage} color="#074426" />
                </View>

                <View style={styles.toggleItem}>
                  <Text style={styles.toggleLabel}>Dance Floor</Text>
                  <Switch value={includeDanceFloor} onValueChange={setIncludeDanceFloor} color="#074426" />
                </View>

                <View style={styles.toggleItem}>
                  <Text style={styles.toggleLabel}>Head Table</Text>
                  <Switch value={includeHeadTable} onValueChange={setIncludeHeadTable} color="#074426" />
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
                buttonColor="#074426"
                onPress={handleAutoBuild}
                style={{ borderRadius: radius.sharp, alignSelf: 'flex-start' }}
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
                  <MaterialCommunityIcons name="account-group" size={22} color="#074426" />
                  <Text variant="titleMedium" style={{ fontWeight: '700', color: '#074426' }}>
                    2. Assigned Event Staff Roster (Working Titles for Today)
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
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
                    textColor="#074426"
                    onPress={() => setStaffRoster(generateSuggestedStaffRoster(guestCount, equipment))}
                  >
                    Reset Ratios
                  </Button>
                </View>
              </View>

              <Text style={{ fontSize: 12, color: colors.muted }}>
                Every catering and banquet event requires staff assigned by their working title for the day.
                Select staff from your venue roster or enter specific team members:
              </Text>

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
                color={equipment.totalSeats >= guestCount ? '#074426' : '#E65100'}
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
        <Card style={[styles.controlCard, { backgroundColor: '#F8FAFC' }]}>
          <Card.Content>
            <Text variant="titleLarge" style={{ fontWeight: '800', color: '#074426' }}>
              {eventName} — Banquet Setup Specification
            </Text>
            <Text style={{ color: colors.muted, marginTop: 2 }}>
              Guest Count: {guestCount} | Seats Placed: {equipment.totalSeats} | Style: {setupStyle.replace(/_/g, ' ')}
            </Text>
            <Text style={{ fontSize: 12, color: colors.charcoal, marginTop: 4 }}>
              Equipment: {equipment.roundTableCount}x Rounds, {equipment.rectTableCount}x Rectangular, {equipment.buffetCount}x Buffets, {equipment.barCount}x Bars, {equipment.totalSeats}x Banquet Chairs
            </Text>

            {/* Staff Duty Lineup on Print Diagram */}
            <View style={{ marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderColor: '#CBD5E1', gap: 6 }}>
              <Text style={{ fontWeight: '800', color: '#074426', fontSize: 13, textTransform: 'uppercase' }}>
                Event Staffing Duty Lineup ({staffRoster.length} Staff Assigned)
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {staffRoster.map((s) => (
                  <View key={s.id} style={{ minWidth: 200, padding: 6, backgroundColor: '#FFFFFF', borderRadius: 4, borderWidth: 1, borderColor: '#E2E8F0' }}>
                    <Text style={{ fontWeight: '700', fontSize: 11, color: '#074426' }}>
                      {s.workingTitle}: <Text style={{ color: '#1E293B' }}>{s.staffName}</Text>
                    </Text>
                    <Text style={{ fontSize: 10, color: colors.muted }}>
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
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#074426' }}>
            Interactive Floor Map (Drag to Move)
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Grid Snap</Text>
              <Switch value={snapToGrid} onValueChange={setSnapToGrid} color="#074426" />
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
              textColor="#074426"
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

          {/* Render all placed tables and architectural elements */}
          {elements.map((elem) => (
            <MovableElement
              key={elem.id}
              element={elem}
              isSelected={selectedId === elem.id}
              isPrintMode={printMode}
              onSelect={() => setSelectedId(elem.id)}
              onMove={(newX, newY) => updateElementPosition(elem.id, newX, newY)}
            />
          ))}
        </View>
      </ScrollView>

      {/* Selected Element Inspector Drawer */}
      {!printMode && selectedElement ? (
        <Card style={styles.inspectorCard}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={styles.cardHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialCommunityIcons name="table-furniture" size={22} color="#074426" />
                <Text variant="titleMedium" style={{ fontWeight: '700', color: '#074426' }}>
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

  let bgColor = '#E8F5E9'; // Light emerald
  let borderColor = '#074426';
  let textColor = '#074426';

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
    backgroundColor: '#F4FAFC',
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
    borderRadius: radius.sharp,
    borderWidth: 1,
    borderColor: '#E2E8F0',
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
    color: '#074426',
    letterSpacing: -0.3,
  },
  subtitle: {
    color: colors.muted,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusCard: {
    backgroundColor: '#E8F5E9',
    borderColor: '#A5D6A7',
    borderWidth: 1,
    borderRadius: radius.sharp,
  },
  statusCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 8,
  },
  statusText: {
    color: '#074426',
    fontWeight: '600',
    fontSize: 13,
  },
  controlCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.sharp,
    borderColor: '#E2E8F0',
    borderWidth: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
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
    color: '#074426',
    marginBottom: 4,
  },
  togglesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: spacing.sm,
    borderRadius: radius.sharp,
  },
  toggleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toggleLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
  },
  metricsBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    padding: spacing.md,
    borderRadius: radius.sharp,
    borderColor: '#E2E8F0',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'space-around',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metricItem: {
    minWidth: 120,
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#074426',
    marginTop: 2,
  },
  metricDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#E2E8F0',
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
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    position: 'relative',
    overflow: 'hidden',
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
    color: '#94A3B8',
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
    backgroundColor: '#074426',
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
    borderColor: '#3B82F6',
    borderWidth: 1.5,
    borderRadius: radius.sharp,
  },
  staffCard: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 6,
    padding: spacing.sm,
    gap: 6,
  },
  staffHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
