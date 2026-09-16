import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMutation, useQueryState } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import { errorMessage, formatMoney, formatRelativeTime } from '../../lib/format';
import { radius, spacing, useDesignTheme } from '../../lib/theme';
import { useResponsive } from '../../lib/responsive';
import { config } from '../../lib/config';
import { SectionHeader } from '../../components/AppCard';
import { InlineMessage } from '../../components/InlineMessage';
import { InventorySubNav } from '../../components/inventory/InventorySubNav';
import { MovementSheet, type MovementTarget } from '../../components/inventory/MovementSheet';
import {
  MOVEMENT_LABELS,
  STOCK_STATUS_META,
  formatQuantity,
  type InventoryDashboard,
  type LegacyMigrationSummary,
} from '../../lib/inventory-types';

/** Inventory Overview: the daily command center for stock across the venue. */
export default function InventoryOverviewScreen() {
  const palette = useDesignTheme();
  const { pagePadding, isPhone } = useResponsive();
  const { data, error, isLoading, refetch } = useQueryState<InventoryDashboard>(api.inventory.getDashboard, {});
  const migrateLegacy = useMutation<Record<string, never>, LegacyMigrationSummary>(api.inventory.migrateLegacy);
  const [migrating, setMigrating] = useState(false);
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null);
  const [movementTarget, setMovementTarget] = useState<MovementTarget | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await refetch(); } finally { setRefreshing(false); }
  };

  const runMigration = async () => {
    setMigrating(true);
    setMigrationMessage(null);
    try {
      const result = await migrateLegacy({});
      const moved = result.barItems + result.departmentItems;
      setMigrationMessage(
        result.failed.length
          ? `Imported ${moved} items. ${result.failed.length} could not be imported: ${result.failed[0].error}`
          : moved ? `Imported ${moved} items with their current stock as opening balances.` : 'Nothing new to import.',
      );
    } catch (err) {
      setMigrationMessage(errorMessage(err, 'Import failed.'));
    } finally {
      setMigrating(false);
    }
  };

  const totals = data?.totals;
  const empty = totals?.itemCount === 0;

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ScrollView
        contentContainerStyle={{ padding: pagePadding, paddingBottom: spacing.huge, gap: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <SectionHeader kicker="Inventory" title="Overview" subtitle="What exists, where it is, and what needs action." rule={false} />
        <InventorySubNav active="overview" />

        {isLoading && !data ? <ActivityIndicator style={{ marginTop: spacing.xl }} /> : null}
        {error && !data ? (
          <View style={{ gap: spacing.sm }}>
            <InlineMessage message={errorMessage(error, 'Inventory could not load.')} />
            <ActionButton label="Retry" icon="refresh" onPress={() => void refetch()} />
          </View>
        ) : null}

        {empty ? (
          <Panel title="Set up inventory">
            <Text style={[styles.body, { color: palette.muted }]}>
              No items in the new inventory yet. Import your existing bar and department stock: each item keeps its
              current quantity as an opening balance, and your existing inventory screens keep working.
            </Text>
            <ActionButton label={migrating ? 'Importing…' : 'Import existing inventory'} icon="database-import-outline" onPress={runMigration} disabled={migrating} />
          </Panel>
        ) : null}
        {migrationMessage ? <Text style={[styles.body, { color: palette.charcoal }]} accessibilityRole="alert">{migrationMessage}</Text> : null}

        {totals ? (
          <View style={styles.kpiGrid}>
            <Kpi label="Total value" value={formatMoney(totals.valueCents)} wide={isPhone} />
            <Kpi label="Food" value={formatMoney(totals.foodValueCents)} onPress={() => router.replace('/inventory/food' as never)} />
            <Kpi label="Beverage" value={formatMoney(totals.beverageValueCents)} onPress={() => router.replace('/inventory/beverage' as never)} />
            <Kpi label="Equipment" value={formatMoney(totals.equipmentValueCents)} onPress={() => router.replace('/inventory/equipment' as never)} />
            <Kpi label="Below par" value={String(totals.belowParCount)} tone={totals.belowParCount ? 'warn' : undefined} />
            <Kpi label="At risk of 86" value={String(totals.atRiskCount)} tone={totals.atRiskCount ? 'alert' : undefined} />
            <Kpi label="Locations" value={String(totals.locationCount)} />
            <Kpi label="Last count" value={totals.lastCountedAt ? formatRelativeTime(new Date(totals.lastCountedAt).getTime()) : 'Never'} />
          </View>
        ) : null}

        {data && !empty ? (
          <Panel title={`Needs attention · ${data.attention.length}`}>
            {data.attention.length === 0 ? (
              <Text style={[styles.body, { color: palette.muted }]}>Everything with a par is stocked above it.</Text>
            ) : data.attention.map((row) => {
              const meta = STOCK_STATUS_META[row.status];
              return (
                <View key={`${row.itemId}:${row.locationId}`} style={[styles.row, { borderBottomColor: palette.divider }]}>
                  <View style={[styles.dot, { backgroundColor: meta.color }]} />
                  <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => router.push(`/inventory/item/${row.itemId}` as never)} accessibilityRole="button">
                    <Text style={[styles.rowTitle, { color: palette.charcoal }]} numberOfLines={1}>{row.name}</Text>
                    <Text style={[styles.rowMeta, { color: palette.muted }]} numberOfLines={1}>
                      {row.location} · {formatQuantity(row.onHand, row.unit)} of {formatQuantity(row.par)} par
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setMovementTarget({ itemId: row.itemId, name: row.name, unit: row.unit, locations: [{ id: row.locationId, name: row.location, onHand: row.onHand }] })}
                    style={[styles.smallBtn, { borderColor: palette.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Restock ${row.name}`}
                  >
                    <Text style={{ color: palette.charcoal, fontWeight: '700', fontSize: 13 }}>Restock</Text>
                  </Pressable>
                </View>
              );
            })}
          </Panel>
        ) : null}

        {data && data.valueByLocation.length > 0 ? (
          <Panel title="Value by location">
            {data.valueByLocation.map((loc) => {
              const share = data.totals.valueCents > 0 ? loc.valueCents / data.totals.valueCents : 0;
              return (
                <View key={loc.id} style={{ gap: 4, marginBottom: spacing.sm }}>
                  <View style={styles.spread}>
                    <Text style={[styles.rowTitle, { color: palette.charcoal }]} numberOfLines={1}>{loc.name}</Text>
                    <Text style={[styles.rowMeta, { color: palette.charcoal }]}>{formatMoney(loc.valueCents)}</Text>
                  </View>
                  <View style={[styles.bar, { backgroundColor: palette.surfaceSoft }]}>
                    <View style={[styles.barFill, { width: `${Math.max(share * 100, 1)}%`, backgroundColor: palette.primary }]} />
                  </View>
                </View>
              );
            })}
          </Panel>
        ) : null}

        {data && data.recentActivity.length > 0 ? (
          <Panel title="Recent activity">
            {data.recentActivity.map((t) => (
              <View key={t.id} style={[styles.row, { borderBottomColor: palette.divider }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.rowTitle, { color: palette.charcoal }]} numberOfLines={1}>
                    {MOVEMENT_LABELS[t.type] ?? t.type} · {t.item.name}
                  </Text>
                  <Text style={[styles.rowMeta, { color: palette.muted }]} numberOfLines={1}>
                    {t.location.name} · {formatRelativeTime(new Date(t.createdAt).getTime())}
                  </Text>
                </View>
                <Text style={{ fontWeight: '800', color: t.quantityDelta < 0 ? palette.danger : palette.charcoal }}>
                  {t.quantityDelta > 0 ? '+' : ''}{formatQuantity(t.quantityDelta, t.item.baseUnit)}
                </Text>
              </View>
            ))}
          </Panel>
        ) : null}

        {!config.stadiumShell ? (
          <Pressable onPress={() => router.push('/bar-stock' as never)} accessibilityRole="link" style={styles.legacyLink}>
            <MaterialCommunityIcons name="history" size={16} color={palette.muted} />
            <Text style={{ color: palette.muted, fontSize: 13, fontWeight: '600' }}>Open legacy bar stock screen</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <MovementSheet target={movementTarget} initialMode="receive" onClose={() => setMovementTarget(null)} />
    </View>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  const palette = useDesignTheme();
  return (
    <View style={[styles.panel, { backgroundColor: palette.surfaceStrong, borderColor: palette.border }]}>
      <Text style={[styles.panelTitle, { color: palette.charcoal }]}>{title}</Text>
      {children}
    </View>
  );
}

function Kpi({ label, value, tone, onPress, wide }: { label: string; value: string; tone?: 'warn' | 'alert'; onPress?: () => void; wide?: boolean }) {
  const palette = useDesignTheme();
  const color = tone === 'alert' ? palette.danger : tone === 'warn' ? palette.warning : palette.charcoal;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`${label}: ${value}`}
      style={[styles.kpi, wide && styles.kpiWide, { backgroundColor: palette.surfaceStrong, borderColor: palette.border }]}
    >
      <Text style={[styles.kpiLabel, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.kpiValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </Pressable>
  );
}

function ActionButton({ label, icon, onPress, disabled }: { label: string; icon: string; onPress: () => void; disabled?: boolean }) {
  const palette = useDesignTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.actionBtn, { backgroundColor: palette.charcoal, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}
    >
      <MaterialCommunityIcons name={icon as never} size={18} color={palette.surfaceStrong} />
      <Text style={{ color: palette.surfaceStrong, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 20 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kpi: { flexGrow: 1, flexBasis: 150, minHeight: 72, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, justifyContent: 'space-between' },
  kpiWide: { flexBasis: '100%' },
  kpiLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  kpiValue: { fontSize: 22, fontWeight: '800' },
  panel: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  panelTitle: { fontSize: 16, fontWeight: '800', marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  rowTitle: { fontSize: 14, fontWeight: '700' },
  rowMeta: { fontSize: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  smallBtn: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, justifyContent: 'center' },
  spread: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 48, borderRadius: radius.md, marginTop: spacing.sm },
  legacyLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', minHeight: 44, paddingHorizontal: spacing.md },
});
