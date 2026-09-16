import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CommandButton, CommandText, StatusPill } from '../../components/FutureUI';
import { InlineMessage } from '../../components/InlineMessage';
import { apiRequest, useApiQuery } from '../../lib/api-client';
import { asArray, errorMessage, formatMoney } from '../../lib/format';
import { radius, spacing, useDesignTheme } from '../../lib/theme';
import {
  type ParsedBeoUpload,
  type ParsedSuiteRow,
  type SuiteCandidate,
  beoReportRoute,
} from '../../lib/beo-report';

type UpcomingEvent = { id: string; title: string; startsAt: string };
type StadiumOverview = { events?: UpcomingEvent[] };
type SuiteOption = SuiteCandidate;

/**
 * Importing BEOs from the document the caterer sends.
 *
 * Upload, then review, then import. The middle step exists because the parser
 * cannot always tell which suite a row means — an unresolved row blocks the
 * import rather than landing somewhere plausible, so nothing is delivered to
 * the wrong suite on a guess.
 */
export default function BeoUploadScreen() {
  const palette = useDesignTheme();
  const params = useLocalSearchParams<{ eventId?: string }>();
  const requestedEventId = typeof params.eventId === 'string' ? params.eventId : undefined;

  const overview = useApiQuery<StadiumOverview>(['stadium', 'overview'], '/v1/stadium/overview');
  const upcoming = asArray<UpcomingEvent>(overview.data?.events);
  const eventId = requestedEventId ?? upcoming[0]?.id;
  const eventTitle = upcoming.find((event) => event.id === eventId)?.title ?? '';

  const [busy, setBusy] = useState<'parsing' | 'importing' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<ParsedBeoUpload | null>(null);
  /** Manager overrides for rows the parser could not resolve, by rowId. */
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const resolvedFor = (row: ParsedSuiteRow) => assignments[row.rowId] ?? row.match?.subVenueId ?? '';
  const rows = asArray<ParsedSuiteRow>(draft?.rows);
  const suiteOptions = asArray<SuiteOption>(draft?.venueSuites);
  const unresolved = useMemo(() => rows.filter((row) => !resolvedFor(row)), [rows, assignments]);
  const canImport = rows.length > 0 && unresolved.length === 0 && busy === null;

  const parseFile = async (base64: string, mimeType: string) => {
    if (!eventId) return;
    setBusy('parsing');
    setMessage(null);
    try {
      const result = await apiRequest<ParsedBeoUpload>(
        `/v1/stadium/events/${eventId}/beo-upload/parse`,
        { method: 'POST', body: { fileBase64: base64, mimeType } },
      );
      setDraft(result);
      setAssignments({});
      setMessage(
        result.unmatchedCount > 0
          ? `Read ${result.rows.length} suites. ${result.unmatchedCount} need a suite assigned before importing.`
          : `Read ${result.rows.length} suites, all matched.`,
      );
    } catch (error) {
      setMessage(errorMessage(error, 'The BEO could not be read from that file.'));
    } finally {
      setBusy(null);
    }
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
    await parseFile(base64, asset.mimeType ?? 'application/pdf');
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera unavailable', 'Allow camera access to photograph a printed BEO.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7 });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    if (!asset.base64) return;
    await parseFile(asset.base64, asset.mimeType ?? 'image/jpeg');
  };

  const importRows = async () => {
    if (!eventId || !draft) return;
    setBusy('importing');
    setMessage(null);
    try {
      const result = await apiRequest<{ suiteOrders: unknown[] }>(
        `/v1/stadium/events/${eventId}/beo-upload/commit`,
        {
          method: 'POST',
          body: {
            documentTitle: draft.documentTitle,
            rows: rows.map((row) => ({
              rowId: row.rowId,
              subVenueId: resolvedFor(row),
              beoNumber: row.beoNumber,
              hostName: row.hostName,
              guestCount: row.guestCount,
              serviceStart: row.serviceStart,
              serviceEnd: row.serviceEnd,
              specialInstructions: row.specialInstructions,
              lineItems: row.lineItems,
            })),
          },
        },
      );
      Alert.alert(
        'BEOs imported',
        `${asArray(result.suiteOrders).length} suite orders created. Publish the report to hand them to departments.`,
        [{ text: 'Open report', onPress: () => router.replace(beoReportRoute({ eventId }) as never) }],
      );
      setDraft(null);
      setAssignments({});
    } catch (error) {
      setMessage(errorMessage(error, 'The BEOs were not imported.'));
    } finally {
      setBusy(null);
    }
  };


  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.header, { backgroundColor: '#013369' }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 6 })}
        >
          <MaterialCommunityIcons name="arrow-left" size={20} color="#FFFFFF" />
          <CommandText palette={palette} variant="label" style={{ color: '#A8C4E0' }}>BACK</CommandText>
        </Pressable>
        <CommandText palette={palette} variant="hero" style={{ color: '#FFFFFF', marginTop: spacing.xs }}>
          Upload BEOs
        </CommandText>
        <CommandText palette={palette} variant="body" style={{ color: '#C5D6EB' }}>
          {eventTitle ? `For ${eventTitle}` : 'Import the catering document for an event.'}
        </CommandText>
      </View>

      <View style={{ padding: spacing.md, gap: spacing.md }}>
        {!eventId ? (
          <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <CommandText palette={palette} variant="title">No upcoming event</CommandText>
            <CommandText palette={palette} variant="body" style={{ color: palette.muted }}>
              Create an event before importing BEOs.
            </CommandText>
          </View>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <CommandText palette={palette} variant="title">1 · Upload the document</CommandText>
              <CommandText palette={palette} variant="body" style={{ color: palette.muted }}>
                A PDF from the caterer, or a photo of a printed sheet. Nothing is saved until you review it.
              </CommandText>
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                <CommandButton palette={palette} icon="file-pdf-box" selected onPress={() => void pickDocument()}>
                  Choose file
                </CommandButton>
                <CommandButton palette={palette} icon="camera-outline" onPress={() => void takePhoto()}>
                  Photograph
                </CommandButton>
              </View>
              {busy === 'parsing' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <ActivityIndicator color={palette.primary} />
                  <CommandText palette={palette} variant="caption" style={{ color: palette.muted }}>
                    Reading the BEO…
                  </CommandText>
                </View>
              ) : null}
              <InlineMessage message={message} />
            </View>

            {draft ? (
              <>
                <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                  <View style={styles.rowBetween}>
                    <CommandText palette={palette} variant="title" style={{ flex: 1 }}>
                      2 · Review {rows.length} suites
                    </CommandText>
                    <StatusPill palette={palette} tone={unresolved.length ? 'warn' : 'good'}>
                      {unresolved.length ? `${unresolved.length} unresolved` : 'All matched'}
                    </StatusPill>
                  </View>
                  <CommandText palette={palette} variant="caption" style={{ color: palette.muted }}>
                    {draft.documentTitle}
                    {draft.eventDate ? ` · ${draft.eventDate}` : ''}
                  </CommandText>
                  {unresolved.length ? (
                    <CommandText palette={palette} variant="caption" style={{ color: palette.warning }}>
                      Assign a suite to every highlighted row. Nothing imports until they all resolve.
                    </CommandText>
                  ) : null}
                </View>

                {rows.map((row) => {
                  const resolved = resolvedFor(row);
                  const isOpen = expandedRow === row.rowId;
                  const suiteName =
                    suiteOptions.find((option) => option.id === resolved)?.name ?? row.match?.name ?? null;
                  return (
                    <View
                      key={row.rowId}
                      style={[
                        styles.card,
                        {
                          backgroundColor: palette.surface,
                          borderColor: resolved ? palette.border : palette.warning,
                          borderWidth: resolved ? 1 : 2,
                        },
                      ]}
                    >
                      <View style={styles.rowBetween}>
                        <View style={{ flex: 1 }}>
                          <CommandText palette={palette} variant="body" style={{ fontWeight: '800' }}>
                            {row.suiteLabel}
                          </CommandText>
                          <CommandText palette={palette} variant="caption" style={{ color: palette.muted }}>
                            {row.hostName} · {row.guestCount} guests · {row.lineItems.length} items ·{' '}
                            {formatMoney(row.totalCents)}
                          </CommandText>
                        </View>
                        <StatusPill palette={palette} tone={resolved ? 'good' : 'warn'}>
                          {resolved ? suiteName ?? 'Assigned' : 'Pick a suite'}
                        </StatusPill>
                      </View>

                      {!resolved || isOpen ? (
                        <View style={{ gap: spacing.xs }}>
                          <CommandText palette={palette} variant="caption" style={{ color: palette.muted }}>
                            {row.candidates.length
                              ? 'More than one suite fits this label — choose one.'
                              : 'Choose the suite this BEO belongs to.'}
                          </CommandText>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                            {(row.candidates.length ? row.candidates : suiteOptions).map((option) => {
                              const active = resolved === option.id;
                              return (
                                <Pressable
                                  key={option.id}
                                  onPress={() =>
                                    setAssignments((prev) => ({ ...prev, [row.rowId]: active ? '' : option.id }))
                                  }
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: active }}
                                  accessibilityLabel={`Assign ${row.suiteLabel} to ${option.name}`}
                                  style={[
                                    styles.chip,
                                    {
                                      backgroundColor: active ? palette.primary : palette.background,
                                      borderColor: active ? palette.primary : palette.border,
                                    },
                                  ]}
                                >
                                  <CommandText
                                    palette={palette}
                                    variant="caption"
                                    style={{ color: active ? palette.buttonText : palette.charcoal, fontWeight: '700' }}
                                  >
                                    {option.code} · {option.name}
                                  </CommandText>
                                </Pressable>
                              );
                            })}
                          </ScrollView>
                        </View>
                      ) : null}

                      <Pressable
                        onPress={() => setExpandedRow(isOpen ? null : row.rowId)}
                        accessibilityRole="button"
                        accessibilityLabel={isOpen ? `Hide details for ${row.suiteLabel}` : `Show details for ${row.suiteLabel}`}
                        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, paddingVertical: 4 })}
                      >
                        <CommandText palette={palette} variant="caption" style={{ color: palette.primary, fontWeight: '700' }}>
                          {isOpen ? 'Hide items' : 'Show items'}
                        </CommandText>
                      </Pressable>

                      {isOpen ? (
                        <View style={[styles.itemsBox, { borderColor: palette.divider }]}>
                          {row.lineItems.length === 0 ? (
                            <CommandText palette={palette} variant="caption" style={{ color: palette.muted }}>
                              No catering items were read from this row.
                            </CommandText>
                          ) : (
                            row.lineItems.map((item, index) => (
                              <View key={`${row.rowId}-${item.code || index}`} style={styles.itemRow}>
                                <CommandText palette={palette} variant="caption" style={{ width: 34, fontWeight: '800' }}>
                                  {item.quantity}×
                                </CommandText>
                                <CommandText palette={palette} variant="caption" style={{ flex: 1 }}>{item.name}</CommandText>
                                <CommandText palette={palette} variant="caption" style={{ color: palette.muted }}>
                                  {formatMoney(item.unitPriceCents * item.quantity)}
                                </CommandText>
                              </View>
                            ))
                          )}
                          {row.specialInstructions ? (
                            <CommandText palette={palette} variant="caption" style={{ color: palette.warning }}>
                              {row.specialInstructions}
                            </CommandText>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}

                <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                  <CommandText palette={palette} variant="title">3 · Import</CommandText>
                  <CommandText palette={palette} variant="body" style={{ color: palette.muted }}>
                    Creates a sales BEO for the document and one suite order per row, ready to publish.
                  </CommandText>
                  <CommandButton
                    palette={palette}
                    icon="database-import-outline"
                    selected={canImport}
                    onPress={() => (canImport ? void importRows() : undefined)}
                  >
                    {busy === 'importing'
                      ? 'Importing…'
                      : unresolved.length
                        ? `${unresolved.length} suite${unresolved.length === 1 ? '' : 's'} still unresolved`
                        : `Import ${rows.length} suite BEOs`}
                  </CommandButton>
                </View>
              </>
            ) : null}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.lg, gap: spacing.xs },
  card: { borderRadius: 8, borderWidth: 1, padding: spacing.md, gap: spacing.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chipRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 2 },
  chip: { borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  itemsBox: { borderWidth: 1, borderRadius: 6, padding: spacing.sm, gap: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});

export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
