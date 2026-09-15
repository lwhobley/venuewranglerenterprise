import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryState } from '../../../lib/railway-hooks';
import { api } from '../../../lib/railway-api';
import { errorMessage, formatMoney, formatRelativeTime } from '../../../lib/format';
import { radius, spacing, useDesignTheme } from '../../../lib/theme';
import { useResponsive } from '../../../lib/responsive';
import { InlineMessage } from '../../../components/InlineMessage';
import { MovementSheet, type MovementTarget } from '../../../components/inventory/MovementSheet';
import {
  MOVEMENT_LABELS,
  REASON_CODES,
  STOCK_STATUS_META,
  formatQuantity,
  type DirectMovementType,
  type InventoryBalanceRow,
  type InventoryItemDetail,
} from '../../../lib/inventory-types';

const QUICK_ACTIONS: Array<{ mode: DirectMovementType | 'transfer'; label: string; icon: string }> = [
  { mode: 'count_adjustment', label: 'Count', icon: 'counter' },
  { mode: 'receive', label: 'Receive', icon: 'truck-delivery-outline' },
  { mode: 'transfer', label: 'Transfer', icon: 'swap-horizontal' },
  { mode: 'waste', label: 'Waste', icon: 'delete-outline' },
];

/** Item detail: summary, stock by location with pars, and the full ledger history. */
export default function InventoryItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = useDesignTheme();
  const { pagePadding, isDesktop } = useResponsive();
  const { data: item, error, isLoading, refetch } = useQueryState<InventoryItemDetail>(api.inventory.getItem, id ? { itemId: id } : 'skip');
  const [sheet, setSheet] = useState<{ target: MovementTarget; mode: DirectMovementType | 'transfer' } | null>(null);

  if (isLoading && !item) return <ActivityIndicator style={{ marginTop: spacing.huge }} />;
  if (!item) {
    return (
      <View style={{ padding: pagePadding, gap: spacing.md }}>
        <InlineMessage message={errorMessage(error, 'This item could not load.')} />
        <Pressable onPress={() => void refetch()} accessibilityRole="button"><Text style={{ fontWeight: '700', color: palette.charcoal }}>Retry</Text></Pressable>
      </View>
    );
  }

  const status = STOCK_STATUS_META[item.status];
  const target: MovementTarget = {
    itemId: item.id, name: item.name, unit: item.baseUnit,
    locations: item.balances.map((b) => ({ id: b.locationId, name: b.location.name, onHand: b.onHand })),
  };
  const reasonLabel = (code: string | null) => REASON_CODES.find((r) => r.code === code)?.label ?? code;

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ScrollView contentContainerStyle={{ padding: pagePadding, paddingBottom: spacing.huge, gap: spacing.lg, width: '100%', maxWidth: 960, alignSelf: 'center' }}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace(`/inventory/${item.domain}` as never))} accessibilityRole="button" style={styles.back}>
          <MaterialCommunityIcons name="chevron-left" size={22} color={palette.charcoal} />
          <Text style={{ color: palette.charcoal, fontWeight: '700' }}>Inventory</Text>
        </Pressable>

        <View style={{ gap: 4 }}>
          <Text style={[styles.kicker, { color: palette.muted }]}>
            {[item.domain, item.category?.name].filter(Boolean).join(' · ')}
          </Text>
          <Text style={[styles.title, { color: palette.charcoal }]}>{item.name}</Text>
          <View style={styles.inline}>
            <View style={[styles.chip, { borderColor: status.color }]}>
              <Text style={[styles.chipText, { color: status.color }]}>{status.label}</Text>
            </View>
            {!item.active ? <Text style={{ color: palette.danger, fontWeight: '700' }}>Archived</Text> : null}
          </View>
        </View>

        <View style={styles.actions}>
          {QUICK_ACTIONS.map((a) => (
            <Pressable
              key={a.mode}
              onPress={() => setSheet({ target, mode: a.mode })}
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, { borderColor: palette.border, backgroundColor: palette.surfaceStrong, opacity: pressed ? 0.8 : 1 }]}
            >
              <MaterialCommunityIcons name={a.icon as never} size={20} color={palette.charcoal} />
              <Text style={{ color: palette.charcoal, fontWeight: '700', fontSize: 13 }}>{a.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={[styles.summaryGrid, isDesktop && { flexWrap: 'nowrap' }]}>
          <Stat label="On hand" value={formatQuantity(item.onHand, item.baseUnit)} />
          <Stat label="Par (all locations)" value={item.par != null ? formatQuantity(item.par, item.baseUnit) : 'Not set'} />
          <Stat label="Value" value={item.valueCents != null ? formatMoney(Math.round(item.valueCents)) : 'No cost'} />
          <Stat label="Unit cost" value={item.unitCostCents != null ? formatMoney(Math.round(item.unitCostCents)) : '—'} />
        </View>

        <Section title="Stock by location">
          {item.balances.length === 0 ? (
            <Text style={{ color: palette.muted }}>Not stocked anywhere yet. Receive or transfer stock to add a location.</Text>
          ) : item.balances.map((b) => <BalanceRow key={b.locationId} itemId={item.id} unit={item.baseUnit} balance={b} />)}
        </Section>

        <Section title="Details">
          <Detail label="SKU" value={item.internalSku} />
          <Detail label="Barcode" value={item.barcode} />
          <Detail label="Vendor SKU" value={item.vendorSku} />
          <Detail label="Brand" value={item.brand} />
          <Detail label="Supplier" value={item.supplier} />
          <Detail label="Units" value={item.purchaseUnit ? `${item.purchaseUnit} = ${formatQuantity(item.purchaseToBase)} ${item.baseUnit}` : item.baseUnit} />
          <Detail label="Pack size" value={item.packSize} />
          <Detail label="Storage" value={item.storageCondition} />
          <Detail label="Previous cost" value={item.lastCostCents != null ? formatMoney(Math.round(item.lastCostCents)) : null} />
          <Detail label="Notes" value={item.notes} />
        </Section>

        <Section title={`History · ${item.history.length}`}>
          {item.history.length === 0 ? <Text style={{ color: palette.muted }}>No stock movements yet.</Text> : item.history.map((t) => (
            <View key={t.id} style={[styles.historyRow, { borderBottomColor: palette.divider }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: palette.charcoal, fontWeight: '700' }} numberOfLines={1}>
                  {MOVEMENT_LABELS[t.type] ?? t.type} · {t.location.name}
                </Text>
                <Text style={{ color: palette.muted, fontSize: 12 }} numberOfLines={2}>
                  {[
                    formatRelativeTime(new Date(t.createdAt).getTime()),
                    `${formatQuantity(t.quantityBefore)} → ${formatQuantity(t.quantityAfter)}`,
                    reasonLabel(t.reasonCode),
                    t.note,
                  ].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontWeight: '800', color: t.quantityDelta < 0 ? palette.danger : palette.charcoal }}>
                  {t.quantityDelta > 0 ? '+' : ''}{formatQuantity(t.quantityDelta, item.baseUnit)}
                </Text>
                {t.valueDeltaCents != null ? (
                  <Text style={{ color: palette.muted, fontSize: 12 }}>{formatMoney(Math.round(t.valueDeltaCents))}</Text>
                ) : null}
              </View>
            </View>
          ))}
        </Section>
      </ScrollView>
      <MovementSheet target={sheet?.target ?? null} initialMode={sheet?.mode} onClose={() => setSheet(null)} />
    </View>
  );
}

function BalanceRow({ itemId, unit, balance }: { itemId: string; unit: string; balance: InventoryBalanceRow }) {
  const palette = useDesignTheme();
  const setLocationSettings = useMutation(api.inventory.setLocationSettings);
  const [editing, setEditing] = useState(false);
  const [par, setPar] = useState(balance.par != null ? String(balance.par) : '');
  const [error, setError] = useState<string | null>(null);
  const status = STOCK_STATUS_META[balance.status];

  const savePar = async () => {
    const value = par.trim() === '' ? null : Number(par.replace(',', '.'));
    if (value != null && (!Number.isFinite(value) || value < 0)) { setError('Par must be zero or more'); return; }
    try {
      await setLocationSettings({ itemId, locationId: balance.locationId, par: value });
      setEditing(false);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Par was not saved.'));
    }
  };

  return (
    <View style={[styles.balance, { borderBottomColor: palette.divider }]}>
      <View style={[styles.rail, { backgroundColor: status.color }]} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: palette.charcoal, fontWeight: '700' }} numberOfLines={1}>{balance.location.name}</Text>
        <Text style={{ color: palette.muted, fontSize: 12 }}>
          {status.label}
          {balance.committed > 0 ? ` · ${formatQuantity(balance.available, unit)} available` : ''}
          {balance.lastCountedAt ? ` · counted ${formatRelativeTime(new Date(balance.lastCountedAt).getTime())}` : ' · never counted'}
        </Text>
        {error ? <Text style={{ color: palette.danger, fontSize: 12 }}>{error}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={{ color: palette.charcoal, fontWeight: '800', fontSize: 16 }}>{formatQuantity(balance.onHand, unit)}</Text>
        {editing ? (
          <View style={styles.inline}>
            <TextInput
              value={par}
              onChangeText={setPar}
              keyboardType="decimal-pad"
              placeholder="Par"
              placeholderTextColor={palette.muted}
              accessibilityLabel={`Par for ${balance.location.name}`}
              style={[styles.parInput, { color: palette.charcoal, borderColor: palette.border }]}
              autoFocus
            />
            <Pressable onPress={savePar} accessibilityRole="button" style={styles.parBtn}><Text style={{ fontWeight: '800', color: palette.charcoal }}>Save</Text></Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setEditing(true)} accessibilityRole="button" accessibilityLabel={`Edit par for ${balance.location.name}`} style={styles.parBtn}>
            <Text style={{ color: palette.muted, fontSize: 12, fontWeight: '600' }}>
              {balance.par != null ? `Par ${formatQuantity(balance.par)} · edit` : 'Set par'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const palette = useDesignTheme();
  return (
    <View style={[styles.section, { backgroundColor: palette.surfaceStrong, borderColor: palette.border }]}>
      <Text style={{ color: palette.charcoal, fontWeight: '800', fontSize: 16, marginBottom: spacing.sm }}>{title}</Text>
      {children}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const palette = useDesignTheme();
  return (
    <View style={[styles.stat, { backgroundColor: palette.surfaceStrong, borderColor: palette.border }]}>
      <Text style={[styles.kicker, { color: palette.muted }]}>{label}</Text>
      <Text style={{ color: palette.charcoal, fontWeight: '800', fontSize: 18 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  const palette = useDesignTheme();
  if (!value) return null;
  return (
    <View style={styles.detail}>
      <Text style={{ color: palette.muted, fontSize: 13, width: 110 }}>{label}</Text>
      <Text style={{ color: palette.charcoal, fontSize: 13, flex: 1 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', minHeight: 44, alignSelf: 'flex-start' },
  kicker: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  title: { fontSize: 26, fontWeight: '800' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  chipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: { flexGrow: 1, flexBasis: 72, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderRadius: radius.md },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: { flexGrow: 1, flexBasis: 140, padding: spacing.md, borderWidth: 1, borderRadius: radius.md, gap: 4 },
  section: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  balance: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  rail: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  parInput: { borderWidth: 1, borderRadius: radius.sm, minWidth: 70, minHeight: 40, paddingHorizontal: spacing.sm, textAlign: 'right' },
  parBtn: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.xs },
  detail: { flexDirection: 'row', gap: spacing.md, paddingVertical: 4 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
});
