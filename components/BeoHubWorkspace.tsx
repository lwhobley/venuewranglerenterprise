import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import {
  Badge,
  Button,
  Card,
  Chip,
  Divider,
  IconButton,
  Modal,
  Portal,
  SegmentedButtons,
  Text,
  TextInput,
} from 'react-native-paper';
import { useMutation, useQuery } from '../lib/railway-hooks';
import { api } from '../lib/railway-api';
import type { Id } from '../lib/ids';
import {
  accents,
  chromeGold,
  colors,
  dept,
  deptTint,
  hairline,
  ink,
  radius,
  shadowSoft,
  spacing,
  statusColors,
  stone,
  surfaceIvory,
} from '../lib/theme';
import { StatusChip } from './HudPrimitives';
import { useIsDesktop } from '../lib/responsive';
import { errorMessage, formatShortDate, formatShortDateTime } from '../lib/format';
import type { WorkspaceView } from '../lib/crm-routing';
import { CrmSalesWorkspace } from './CrmSalesWorkspace';
import { useAuthStore } from '../lib/auth-store';
import { useWorkspaceResolution } from '../lib/workspace-routing';
import { isCrossDepartmentRole } from '../lib/permissions';

type HubViewMode = 'today' | 'by_event' | 'by_space' | 'needs_review';
type DepartmentFilter = 'all' | 'kitchen' | 'banquet_floor' | 'bars' | 'suites' | 'warehouse' | 'staffing';

export interface BeoHubItem {
  id: string;
  eventName: string;
  serviceDate: string | null;
  serviceStartAt: string | null;
  serviceEndAt: string | null;
  loadInAt: string | null;
  loadOutAt: string | null;
  venueSpace: string | null;
  spaceId: string | null;
  guestCount: number | null;
  status: string;
  externalSource: string | null;
  externalId: string | null;
  eventId: string | null;
  eventTitle: string | null;
  suiteOrderCount: number;
  departmentSlices: any;
  hasLayout: boolean;
  updatedAt: string;
}

interface ListBeosResponse {
  beos: BeoHubItem[];
  totalCount: number;
}

export function BeoHubWorkspace({
  venueId,
  enabled,
  initialView,
  initialEventName,
  initialBeoId,
}: {
  venueId: Id<'venues'> | undefined;
  enabled: boolean;
  initialView?: WorkspaceView;
  initialEventName?: string;
  initialBeoId?: string;
}) {
  const isDesktop = useIsDesktop();

  // Mode: BEO Hub vs Sales CRM Mirror
  const isInitialSales = initialView && initialView !== 'hub' && initialView !== 'events';
  const [showSalesMirror, setShowSalesMirror] = useState(Boolean(isInitialSales));

  // Hub Filters & View Modes
  const userRole = useAuthStore((s) => s.user?.role);
  const { data: workspace } = useWorkspaceResolution();
  const role = userRole ?? workspace?.effectiveRole;

  const isCross = isCrossDepartmentRole(role) || Boolean(
    workspace?.departments?.some((d) => ['WAREHOUSE', 'PROCUREMENT'].includes(d.code.toUpperCase()))
  );

  const availableChips = useMemo(() => {
    if (isCross) {
      return [
        { id: 'all' as DepartmentFilter, label: 'All Departments' },
        { id: 'kitchen' as DepartmentFilter, label: 'Kitchen / Culinary' },
        { id: 'banquet_floor' as DepartmentFilter, label: 'Banquet Floor' },
        { id: 'bars' as DepartmentFilter, label: 'Bars & Beverage' },
        { id: 'suites' as DepartmentFilter, label: 'Suites' },
        { id: 'warehouse' as DepartmentFilter, label: 'Warehouse / Staging' },
        { id: 'staffing' as DepartmentFilter, label: 'Staffing & Duty Lineup' },
      ];
    }

    const userDeptCodes = new Set((workspace?.departments ?? []).map((d) => d.code.toUpperCase()));
    const chips: Array<{ id: DepartmentFilter; label: string }> = [];

    if (userDeptCodes.has('CULINARY')) {
      chips.push({ id: 'kitchen', label: 'Kitchen / Culinary' });
    }
    if (userDeptCodes.has('BANQUET_CATERING')) {
      chips.push({ id: 'banquet_floor', label: 'Banquet Floor' });
      chips.push({ id: 'staffing', label: 'Staffing & Duty Lineup' });
    }
    if (userDeptCodes.has('BEVERAGE')) {
      chips.push({ id: 'bars', label: 'Bars & Beverage' });
    }
    if (userDeptCodes.has('SUITES')) {
      chips.push({ id: 'suites', label: 'Suites' });
    }
    if (userDeptCodes.has('CONCESSIONS')) {
      chips.push({ id: 'kitchen', label: 'Concessions' });
    }

    if (chips.length > 1) {
      chips.unshift({ id: 'all', label: 'My Departments' });
    }

    return chips;
  }, [isCross, workspace?.departments]);

  const [hubView, setHubView] = useState<HubViewMode>('today');
  const [department, setDepartment] = useState<DepartmentFilter>('all');

  useEffect(() => {
    if (!isCross && availableChips.length > 0) {
      if (!availableChips.some((c) => c.id === department)) {
        setDepartment(availableChips[0].id);
      }
    }
  }, [isCross, availableChips, department]);

  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [selectedBeoId, setSelectedBeoId] = useState<string | null>(initialBeoId ?? null);
  const [message, setMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Upload Form
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadText, setUploadText] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);

  // Create Form (strict: requires event + space + start/end)
  const [newEventName, setNewEventName] = useState('');
  const [newSpace, setNewSpace] = useState('');
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newStartTime, setNewStartTime] = useState('17:00');
  const [newEndTime, setNewEndTime] = useState('22:00');
  const [newGuests, setNewGuests] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  // Query BEOs
  const beoResponse = useQuery(
    api.beoHub.listBeos,
    enabled && venueId
      ? {
          venueId,
          department: department !== 'all' ? department : undefined,
          needsReview: hubView === 'needs_review' ? 'true' : undefined,
        }
      : 'skip',
  ) as ListBeosResponse | undefined;

  const beos = useMemo(() => beoResponse?.beos ?? [], [beoResponse?.beos]);

  // Mutations
  const uploadBeoMutation = useMutation(api.beoHub.uploadBeo);
  const createBeoMutation = useMutation(api.beoHub.createBeo);
  const updateBeoMutation = useMutation(api.beoHub.updateBeo);
  const createSuiteOrderMutation = useMutation(api.beoHub.createSuiteOrder);
  const syncStaffingMutation = useMutation(api.beoHub.syncStaffing);

  // Follow external deep links
  useEffect(() => {
    if (initialBeoId) {
      setSelectedBeoId(initialBeoId);
    }
  }, [initialBeoId]);

  // Selected BEO Detail
  const selectedBeo = useMemo(() => {
    if (selectedBeoId) {
      return beos.find((b) => b.id === selectedBeoId) ?? null;
    }
    return null;
  }, [beos, selectedBeoId]);

  // Groupings
  const needsReviewCount = useMemo(() => beos.filter((b) => b.status === 'needs_review').length, [beos]);

  const datesList = useMemo(() => {
    const dates = new Set<string>();
    const today = new Date().toISOString().slice(0, 10);
    dates.add(today);
    for (const b of beos) {
      if (b.serviceDate) dates.add(b.serviceDate);
    }
    return Array.from(dates).sort();
  }, [beos]);

  // Filtered BEOs for current view mode
  const displayedBeos = useMemo(() => {
    if (hubView === 'needs_review') {
      return beos.filter((b) => b.status === 'needs_review');
    }
    if (hubView === 'today') {
      return beos.filter((b) => (b.serviceDate ?? '').slice(0, 10) === selectedDate);
    }
    return beos;
  }, [beos, hubView, selectedDate]);

  // By Event grouping
  const eventGroups = useMemo(() => {
    const groups = new Map<string, { eventTitle: string; eventId: string | null; date: string | null; beos: BeoHubItem[] }>();
    for (const b of displayedBeos) {
      const key = b.eventId ?? b.eventName;
      const existing = groups.get(key);
      if (existing) {
        existing.beos.push(b);
      } else {
        groups.set(key, {
          eventTitle: b.eventTitle ?? b.eventName,
          eventId: b.eventId,
          date: b.serviceDate,
          beos: [b],
        });
      }
    }
    return Array.from(groups.values());
  }, [displayedBeos]);

  // By Space grouping
  const spaceGroups = useMemo(() => {
    const groups = new Map<string, BeoHubItem[]>();
    for (const b of displayedBeos) {
      const key = b.venueSpace || 'Unassigned Space';
      const existing = groups.get(key);
      if (existing) existing.push(b);
      else groups.set(key, [b]);
    }
    return Array.from(groups.entries()).map(([spaceName, items]) => ({ spaceName, items }));
  }, [displayedBeos]);

  // Action handlers
  const handleUploadSubmit = async () => {
    if (!venueId || !uploadText.trim()) {
      setMessage({ text: 'Please paste BEO document text, JSON, or CSV content.', isError: true });
      return;
    }
    setUploadBusy(true);
    setMessage(null);
    try {
      const fileName = uploadFileName.trim() || 'beo_upload.txt';
      const mimeType = fileName.endsWith('.json')
        ? 'application/json'
        : fileName.endsWith('.csv')
        ? 'text/csv'
        : 'text/plain';

      const base64 = btoa(unescape(encodeURIComponent(uploadText)));
      const result = await uploadBeoMutation({
        venueId,
        fileName,
        mimeType,
        dataBase64: base64,
      });

      setShowUploadModal(false);
      setUploadFileName('');
      setUploadText('');
      setSelectedBeoId(result.id);
      setMessage({
        text: result.needsReview
          ? 'BEO uploaded. Missing required space or times; filed under Needs Review.'
          : 'BEO ingested successfully and assigned to operations hub.',
      });
    } catch (err) {
      setMessage({ text: `Upload failed: ${errorMessage(err)}`, isError: true });
    } finally {
      setUploadBusy(false);
    }
  };

  const handleCreateSubmit = async () => {
    if (!venueId || !newEventName.trim() || !newSpace.trim()) {
      setMessage({ text: 'Event name and space/room are required.', isError: true });
      return;
    }
    setCreateBusy(true);
    setMessage(null);
    try {
      const startAt = new Date(`${newDate}T${newStartTime}:00`);
      const endAt = new Date(`${newDate}T${newEndTime}:00`);

      const res = await createBeoMutation({
        venueId,
        eventName: newEventName.trim(),
        venueSpace: newSpace.trim(),
        serviceDate: newDate,
        serviceStartAt: startAt.toISOString(),
        serviceEndAt: endAt.toISOString(),
        guestCount: newGuests ? parseInt(newGuests, 10) : undefined,
      });

      setShowCreateModal(false);
      setNewEventName('');
      setNewSpace('');
      setNewGuests('');
      setSelectedBeoId(res.id);
      setMessage({ text: 'Operations BEO created successfully.' });
    } catch (err) {
      setMessage({ text: `Failed to create BEO: ${errorMessage(err)}`, isError: true });
    } finally {
      setCreateBusy(false);
    }
  };

  const handleCreateSuiteOrder = async (beoId: string) => {
    if (!venueId) return;
    try {
      const res = await createSuiteOrderMutation({ venueId, beoId });
      setMessage({
        text: res.alreadyExists
          ? 'Operational suite order already exists.'
          : `Operational suite order ${res.beoNumber} created.`,
      });
    } catch (err) {
      setMessage({ text: `Error creating suite order: ${errorMessage(err)}`, isError: true });
    }
  };

  const handleSyncStaffing = async (beoId: string) => {
    if (!venueId) return;
    try {
      const res = await syncStaffingMutation({ venueId, beoId });
      setMessage({ text: `Synced ${res.workersSynced} banquet staff to daily temporary roster!` });
    } catch (err) {
      setMessage({ text: `Error syncing staffing: ${errorMessage(err)}`, isError: true });
    }
  };

  if (!enabled || !venueId) return null;

  // Toggle to Sales CRM Mirror if explicitly opened
  if (showSalesMirror) {
    return (
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="headlineSmall" style={{ fontWeight: '800', color: colors.muted }}>
            Sales (external CRM mirror)
          </Text>
          <Button
            mode="contained"
            buttonColor={colors.primary}
            icon="arrow-left"
            onPress={() => setShowSalesMirror(false)}
          >
            Back to BEO Operations Hub
          </Button>
        </View>
        <CrmSalesWorkspace
          venueId={venueId}
          enabled={enabled}
          initialView={initialView ?? 'pipeline'}
          initialEventName={initialEventName}
          initialBeoId={initialBeoId}
        />
      </View>
    );
  }

  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
      <Card.Content style={{ gap: spacing.md }}>
        {/* Header Bar */}
        <View style={{ flexDirection: isDesktop ? 'row' : 'column', justifyContent: 'space-between', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="headlineSmall" style={{ color: colors.primary, fontWeight: '800' }}>
                BEO Operations Hub
              </Text>
              {needsReviewCount > 0 ? (
                <Badge style={{ backgroundColor: colors.danger, fontWeight: '700' }}>
                  {`${needsReviewCount} needs review`}
                </Badge>
              ) : null}
            </View>
            <Text style={{ color: colors.muted }}>
              Live execution orders, space timelines, and departmental run of service.
            </Text>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}>
            <Button
              compact
              mode="contained"
              buttonColor={colors.primary}
              icon="file-upload"
              onPress={() => setShowUploadModal(true)}
            >
              Upload BEO
            </Button>
            <Button
              compact
              mode="outlined"
              textColor={colors.primary}
              icon="plus"
              onPress={() => setShowCreateModal(true)}
            >
              New Order
            </Button>
            {isCross ? (
              <Button
                compact
                mode="text"
                textColor={colors.charcoal}
                onPress={() => setShowSalesMirror(true)}
              >
                Sales CRM Mirror
              </Button>
            ) : null}
          </View>
        </View>

        {message ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              padding: spacing.sm,
              borderRadius: radius.sharp,
              backgroundColor: message.isError ? accents[4].bg : accents[2].bg,
            }}
          >
            <Text style={{ color: message.isError ? accents[4].fg : accents[2].fg, flex: 1, fontWeight: '700' }}>
              {message.text}
            </Text>
            <IconButton icon="close" size={16} onPress={() => setMessage(null)} style={{ margin: 0 }} />
          </View>
        ) : null}

        {/* View Mode Switcher */}
        <View style={{ gap: spacing.sm }}>
          <SegmentedButtons
            value={hubView}
            onValueChange={(val) => setHubView(val as HubViewMode)}
            buttons={[
              { value: 'today', label: 'Today / Dates' },
              { value: 'by_event', label: 'By Event' },
              { value: 'by_space', label: 'By Space' },
              {
                value: 'needs_review',
                label: `Needs Review (${needsReviewCount})`,
              },
            ]}
          />

          {/* Department Filter Chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
            {availableChips.map((chip) => (
              <Chip
                key={chip.id}
                selected={department === chip.id}
                onPress={() => setDepartment(chip.id)}
                compact
              >
                {chip.label}
              </Chip>
            ))}
          </ScrollView>
        </View>

        {/* Date Strip if in Today/Dates mode */}
        {hubView === 'today' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingVertical: 4 }}>
            {datesList.map((d) => (
              <Chip
                key={d}
                selected={selectedDate === d}
                onPress={() => setSelectedDate(d)}
                style={{ backgroundColor: selectedDate === d ? accents[0].bg : undefined }}
              >
                {d === new Date().toISOString().slice(0, 10) ? `Today (${d})` : d}
              </Chip>
            ))}
          </ScrollView>
        ) : null}

        {/* Main Content Area */}
        <View style={{ flexDirection: isDesktop ? 'row' : 'column', gap: spacing.md, minHeight: 380 }}>
          {/* Left / Top List */}
          <View style={{ flex: isDesktop ? 1 : undefined, gap: spacing.sm }}>
            {hubView === 'by_event' ? (
              eventGroups.length === 0 ? (
                <EmptyState label="No events scheduled for current filter." />
              ) : (
                eventGroups.map((group) => (
                  <Card key={group.eventTitle} style={{ backgroundColor: colors.background, borderRadius: radius.sharp }}>
                    <Card.Content style={{ gap: spacing.xs }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text variant="titleMedium" style={{ fontWeight: '800', color: colors.primary }}>
                          {group.eventTitle}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>
                          {group.date ? formatShortDate(Date.parse(`${group.date}T12:00:00Z`)) : 'No date'}
                        </Text>
                      </View>
                      <Divider style={{ marginVertical: 4 }} />
                      <View style={{ gap: 6 }}>
                        {group.beos.map((item) => (
                          <BeoRowCard
                            key={item.id}
                            item={item}
                            isSelected={selectedBeoId === item.id}
                            onSelect={() => setSelectedBeoId(item.id)}
                            isCross={isCross}
                            userDeptCode={workspace?.departments?.[0]?.code}
                          />
                        ))}
                      </View>
                    </Card.Content>
                  </Card>
                ))
              )
            ) : hubView === 'by_space' ? (
              spaceGroups.length === 0 ? (
                <EmptyState label="No spaces reserved for current filter." />
              ) : (
                spaceGroups.map((grp) => (
                  <Card key={grp.spaceName} style={{ backgroundColor: colors.background, borderRadius: radius.sharp }}>
                    <Card.Content style={{ gap: spacing.xs }}>
                      <Text variant="titleMedium" style={{ fontWeight: '800', color: colors.primary }}>
                        {grp.spaceName}
                      </Text>
                      <Divider style={{ marginVertical: 4 }} />
                      <View style={{ gap: 6 }}>
                        {grp.items.map((item) => (
                          <BeoRowCard
                            key={item.id}
                            item={item}
                            isSelected={selectedBeoId === item.id}
                            onSelect={() => setSelectedBeoId(item.id)}
                            isCross={isCross}
                            userDeptCode={workspace?.departments?.[0]?.code}
                          />
                        ))}
                      </View>
                    </Card.Content>
                  </Card>
                ))
              )
            ) : displayedBeos.length === 0 ? (
              <EmptyState label={hubView === 'needs_review' ? 'No BEOs currently need review. All space & time windows confirmed.' : 'No operations BEOs found for this date and department.'} />
            ) : (
              displayedBeos.map((item) => (
                <BeoRowCard
                  key={item.id}
                  item={item}
                  isSelected={selectedBeoId === item.id}
                  onSelect={() => setSelectedBeoId(item.id)}
                  isCross={isCross}
                  userDeptCode={workspace?.departments?.[0]?.code}
                />
              ))
            )}
          </View>

          {/* Right / Bottom Detail Pane */}
          <View style={{ flex: isDesktop ? 1.2 : undefined, minWidth: isDesktop ? 380 : undefined }}>
            {selectedBeo ? (
              <BeoDetailCard
                beo={selectedBeo}
                onOpenFloorPlan={() => router.push(`/banquet-floor-plan?beoId=${selectedBeo.id}`)}
                onCreateSuiteOrder={() => handleCreateSuiteOrder(selectedBeo.id)}
                onSyncStaffing={() => handleSyncStaffing(selectedBeo.id)}
                onOpenReport={() => {
                  if (selectedBeo.eventId) {
                    router.push(`/stadium/beo-report?eventId=${selectedBeo.eventId}`);
                  }
                }}
              />
            ) : (
              <Card style={{ backgroundColor: colors.background, borderRadius: radius.sharp, padding: spacing.lg, alignItems: 'center' }}>
                <Text style={{ color: colors.muted, textAlign: 'center' }}>
                  Select an operations BEO on the left to inspect room schedules, guest counts, and department slices.
                </Text>
              </Card>
            )}
          </View>
        </View>

        {/* Upload Modal */}
        <Portal>
          <Modal
            visible={showUploadModal}
            onDismiss={() => setShowUploadModal(false)}
            contentContainerStyle={{
              backgroundColor: colors.surface,
              padding: spacing.lg,
              margin: spacing.lg,
              borderRadius: radius.sharp,
              maxWidth: 600,
              alignSelf: 'center',
              width: '90%',
              gap: spacing.sm,
            }}
          >
            <Text variant="titleLarge" style={{ fontWeight: '800', color: colors.primary }}>
              Upload Operations BEO
            </Text>
            <Text style={{ color: colors.muted }}>
              Paste formatted BEO JSON, CSV export, or plain-text catering notes. Structured fields (space, times, guest counts) will be normalized automatically.
            </Text>
            <TextInput
              label="Document Name / Filename"
              placeholder="e.g. banquet_order_20260907.json"
              value={uploadFileName}
              onChangeText={setUploadFileName}
              mode="outlined"
              style={{ backgroundColor: colors.surface }}
            />
            <TextInput
              label="BEO Content (JSON, CSV, or Text)"
              placeholder="Paste document payload here..."
              value={uploadText}
              onChangeText={setUploadText}
              mode="outlined"
              multiline
              numberOfLines={8}
              style={{ backgroundColor: colors.surface, minHeight: 180 }}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button mode="text" onPress={() => setShowUploadModal(false)}>
                Cancel
              </Button>
              <Button
                mode="contained"
                buttonColor={colors.primary}
                loading={uploadBusy}
                disabled={uploadBusy}
                onPress={handleUploadSubmit}
              >
                Ingest to Hub
              </Button>
            </View>
          </Modal>
        </Portal>

        {/* Manual Create Modal */}
        <Portal>
          <Modal
            visible={showCreateModal}
            onDismiss={() => setShowCreateModal(false)}
            contentContainerStyle={{
              backgroundColor: colors.surface,
              padding: spacing.lg,
              margin: spacing.lg,
              borderRadius: radius.sharp,
              maxWidth: 600,
              alignSelf: 'center',
              width: '90%',
              gap: spacing.sm,
            }}
          >
            <Text variant="titleLarge" style={{ fontWeight: '800', color: colors.primary }}>
              Create Operations BEO
            </Text>
            <Text style={{ color: colors.muted }}>
              Operational BEOs require an event, space, and valid start/end times.
            </Text>
            <TextInput
              label="Event Name *"
              value={newEventName}
              onChangeText={setNewEventName}
              mode="outlined"
              style={{ backgroundColor: colors.surface }}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TextInput
                label="Space / Room *"
                placeholder="e.g. Ballroom A or Suite 10"
                value={newSpace}
                onChangeText={setNewSpace}
                mode="outlined"
                style={{ flex: 1, backgroundColor: colors.surface }}
              />
              <TextInput
                label="Date (YYYY-MM-DD) *"
                value={newDate}
                onChangeText={setNewDate}
                mode="outlined"
                style={{ width: 150, backgroundColor: colors.surface }}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TextInput
                label="Start Time (HH:MM) *"
                value={newStartTime}
                onChangeText={setNewStartTime}
                mode="outlined"
                style={{ flex: 1, backgroundColor: colors.surface }}
              />
              <TextInput
                label="End Time (HH:MM) *"
                value={newEndTime}
                onChangeText={setNewEndTime}
                mode="outlined"
                style={{ flex: 1, backgroundColor: colors.surface }}
              />
              <TextInput
                label="Guests"
                value={newGuests}
                onChangeText={setNewGuests}
                keyboardType="numeric"
                mode="outlined"
                style={{ width: 100, backgroundColor: colors.surface }}
              />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button mode="text" onPress={() => setShowCreateModal(false)}>
                Cancel
              </Button>
              <Button
                mode="contained"
                buttonColor={colors.primary}
                loading={createBusy}
                disabled={createBusy}
                onPress={handleCreateSubmit}
              >
                Create BEO
              </Button>
            </View>
          </Modal>
        </Portal>
      </Card.Content>
    </Card>
  );
}

function getBeoDepartmentTint(item: BeoHubItem, isCross: boolean, userDeptCode?: string): string {
  if (!isCross && userDeptCode) {
    return deptTint(userDeptCode);
  }
  const slices = item.departmentSlices;
  if (slices?.kitchen || slices?.culinary) return dept.culinary;
  if (slices?.suites || (item.venueSpace && /suite/i.test(item.venueSpace))) return dept.suites;
  if (slices?.bars || slices?.beverage || (item.venueSpace && /bar|lounge/i.test(item.venueSpace))) return dept.beverage;
  if (slices?.banquet_floor || slices?.banquets || (item.venueSpace && /ballroom|banquet/i.test(item.venueSpace))) return dept.banquets;
  if (slices?.warehouse) return dept.warehouse;
  if (slices?.concessions) return dept.concessions;
  return chromeGold;
}

function BeoRowCard({
  item,
  isSelected,
  onSelect,
  isCross = true,
  userDeptCode,
}: {
  item: BeoHubItem;
  isSelected: boolean;
  onSelect: () => void;
  isCross?: boolean;
  userDeptCode?: string;
}) {
  const deptRailColor = getBeoDepartmentTint(item, isCross, userDeptCode);
  const startDisplay = item.serviceStartAt ? new Date(item.serviceStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'No start';
  const endDisplay = item.serviceEndAt ? new Date(item.serviceEndAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'No end';

  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => [
        {
          backgroundColor: '#FFFFFF',
          borderRadius: radius.control,
          borderWidth: isSelected ? 1.5 : hairline,
          borderColor: isSelected ? chromeGold : '#D8CFC0',
          flexDirection: 'row',
          overflow: 'hidden',
          opacity: pressed ? 0.92 : 1,
          ...shadowSoft,
        },
      ]}
    >
      {/* 4px Left Department Slice Rail */}
      <View style={{ width: 4, backgroundColor: deptRailColor }} />

      <View style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 12, gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontWeight: '700', color: ink, fontSize: 14, flex: 1, marginRight: 8 }} numberOfLines={1}>
            {item.eventName}
          </Text>
          <StatusChip status={item.status} size="small" />
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: ink, fontWeight: '500', fontSize: 12 }}>
            📍 {item.venueSpace || 'Unassigned Space'}
          </Text>
          <Text style={{ color: stone, fontSize: 11, fontVariant: ['tabular-nums'] }}>
            ⏱ {startDisplay} – {endDisplay}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
          <Text style={{ color: stone, fontSize: 11 }}>
            👥 {item.guestCount ?? '–'} guests · {item.externalSource ?? 'local'}
          </Text>
          {item.hasLayout ? (
            <Text style={{ color: dept.banquets, fontSize: 11, fontWeight: '700' }}>📐 Floor Plan</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function BeoDetailCard({
  beo,
  onOpenFloorPlan,
  onCreateSuiteOrder,
  onSyncStaffing,
  onOpenReport,
}: {
  beo: BeoHubItem;
  onOpenFloorPlan: () => void;
  onCreateSuiteOrder: () => void;
  onSyncStaffing: () => void;
  onOpenReport: () => void;
}) {
  const slices = beo.departmentSlices;
  const isSuite = Boolean(slices?.suites || (beo.venueSpace && /suite/i.test(beo.venueSpace)));

  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp, borderWidth: 1, borderColor: colors.border }}>
      <Card.Content style={{ gap: spacing.md }}>
        <View style={{ gap: 2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="titleLarge" style={{ fontWeight: '800', color: colors.primary }}>
              {beo.eventName}
            </Text>
            <Chip compact>{beo.status}</Chip>
          </View>
          <Text style={{ color: colors.muted }}>
            Space: <Text style={{ fontWeight: '700', color: colors.charcoal }}>{beo.venueSpace || 'Unassigned Space'}</Text>
          </Text>
        </View>

        {/* Operational Timeline Grid */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          <MetricCell label="Service Date" value={beo.serviceDate || '–'} />
          <MetricCell
            label="Service Window"
            value={
              beo.serviceStartAt && beo.serviceEndAt
                ? `${new Date(beo.serviceStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(beo.serviceEndAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : '–'
            }
          />
          <MetricCell label="Guests" value={String(beo.guestCount ?? '–')} />
          <MetricCell label="Source" value={beo.externalSource || 'manual'} />
        </View>

        {/* Action Buttons */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          <Button compact mode="contained" buttonColor={colors.primary} icon="floor-plan" onPress={onOpenFloorPlan}>
            Banquet Floor Plan
          </Button>

          {isSuite ? (
            <Button compact mode="outlined" textColor={colors.primary} icon="room-service" onPress={onCreateSuiteOrder}>
              {beo.suiteOrderCount > 0 ? 'Suite Order Linked' : 'Create Suite Order'}
            </Button>
          ) : null}

          <Button compact mode="outlined" textColor={colors.primary} icon="account-group" onPress={onSyncStaffing}>
            Sync Staff Roster
          </Button>

          {beo.eventId ? (
            <Button compact mode="text" textColor={colors.primary} icon="file-document" onPress={onOpenReport}>
              Published Report
            </Button>
          ) : null}
        </View>

        <Divider />

        {/* Department Slices */}
        <View style={{ gap: spacing.sm }}>
          <Text variant="titleSmall" style={{ fontWeight: '800', color: colors.primary }}>
            Department Slices
          </Text>

          {slices?.kitchen ? (
            <SliceBlock title="🍳 Kitchen / Culinary" notes={slices.kitchen.notes}>
              {slices.kitchen.menuItems?.map((item: any, i: number) => (
                <Text key={i} style={{ color: colors.charcoal, fontSize: 13 }}>
                  • {item.name} {item.quantity ? `(x${item.quantity})` : ''}
                </Text>
              ))}
            </SliceBlock>
          ) : null}

          {slices?.banquetFloor ? (
            <SliceBlock title="🍽 Banquet Floor" notes={slices.banquetFloor.notes}>
              <Text style={{ color: colors.charcoal, fontSize: 13 }}>
                Style: {slices.banquetFloor.setupStyle || 'Rounds'} · Tables: {slices.banquetFloor.tableCount ?? '–'}
              </Text>
            </SliceBlock>
          ) : null}

          {slices?.bars ? (
            <SliceBlock title="🍸 Bars & Beverage" notes={slices.bars.notes}>
              <Text style={{ color: colors.charcoal, fontSize: 13 }}>
                Package: {slices.bars.barPackage || 'Standard Bar'}
              </Text>
              {slices.bars.specialtyCocktails?.map((c: string, i: number) => (
                <Text key={i} style={{ color: colors.charcoal, fontSize: 13 }}>• {c}</Text>
              ))}
            </SliceBlock>
          ) : null}

          {slices?.suites ? (
            <SliceBlock title="🛋 Luxury Suite" notes={slices.suites.notes}>
              <Text style={{ color: colors.charcoal, fontSize: 13 }}>
                Host: {slices.suites.hostName || '–'} · Par Levels: {slices.suites.parLevels || 'Default'}
              </Text>
            </SliceBlock>
          ) : null}

          {slices?.staffing ? (
            <SliceBlock title="👥 Staffing & Duty Assignments" notes={slices.staffing.notes}>
              <Text style={{ color: colors.charcoal, fontSize: 13 }}>
                {slices.staffing.rosterSynced ? '✅ Official Daily Roster Synced' : '⚠️ Pending Daily Roster Sync'}
              </Text>
            </SliceBlock>
          ) : null}

          {!slices || Object.keys(slices).length === 0 ? (
            <Text style={{ color: colors.muted, fontStyle: 'italic', fontSize: 13 }}>
              No departmental slices configured for this BEO.
            </Text>
          ) : null}
        </View>
      </Card.Content>
    </Card>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexGrow: 1, minWidth: 100, padding: 8, backgroundColor: accents[0].bg, borderRadius: radius.sharp }}>
      <Text style={{ color: colors.muted, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: accents[0].fg, fontWeight: '800', fontSize: 14 }}>{value}</Text>
    </View>
  );
}

function SliceBlock({ title, notes, children }: { title: string; notes?: string; children?: React.ReactNode }) {
  return (
    <View style={{ padding: 8, backgroundColor: colors.background, borderRadius: radius.sharp, gap: 4 }}>
      <Text style={{ fontWeight: '700', color: colors.primary, fontSize: 13 }}>{title}</Text>
      {notes ? <Text style={{ color: colors.muted, fontSize: 12 }}>{notes}</Text> : null}
      {children}
    </View>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <Card style={{ backgroundColor: colors.background, borderRadius: radius.sharp, padding: spacing.lg }}>
      <Text style={{ color: colors.muted, textAlign: 'center' }}>{label}</Text>
    </Card>
  );
}
