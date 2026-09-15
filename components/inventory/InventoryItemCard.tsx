import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { radius, spacing, useDesignTheme } from '../../lib/theme';
import { formatMoney, formatRelativeTime } from '../../lib/format';
import { STOCK_STATUS_META, formatQuantity, type InventoryItemSummary } from '../../lib/inventory-types';

export const InventoryItemCard = memo(function InventoryItemCard({
  item,
  onQuickAction,
}: {
  item: InventoryItemSummary;
  onQuickAction: (item: InventoryItemSummary) => void;
}) {
  const palette = useDesignTheme();
  const status = STOCK_STATUS_META[item.status];
  const locationText = item.locations.length === 0
    ? 'No location yet'
    : item.locations.length === 1 ? item.locations[0].name : `${item.locations.length} locations`;
  const lastCounted = item.lastCountedAt ? formatRelativeTime(new Date(item.lastCountedAt).getTime()) : 'Never counted';

  return (
    <Pressable
      onPress={() => router.push(`/inventory/item/${item.id}` as never)}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${formatQuantity(item.onHand, item.baseUnit)} on hand, ${status.label}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: palette.surfaceStrong, borderColor: palette.border, borderLeftColor: status.color, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={styles.main}>
        <View style={styles.titleRow}>
          <Text style={[styles.name, { color: palette.charcoal }]} numberOfLines={1}>{item.name}</Text>
          <View style={[styles.chip, { borderColor: status.color }]}>
            <Text style={[styles.chipText, { color: status.color }]}>{status.label}</Text>
          </View>
        </View>
        <Text style={[styles.meta, { color: palette.muted }]} numberOfLines={1}>
          {[item.category?.name ?? 'Uncategorized', locationText].join(' · ')}
        </Text>
        <View style={styles.statsRow}>
          <Text style={[styles.qty, { color: palette.charcoal }]}>
            {formatQuantity(item.onHand, item.baseUnit)}
            <Text style={[styles.par, { color: palette.muted }]}>
              {item.par != null ? `  / par ${formatQuantity(item.par)}` : ''}
            </Text>
          </Text>
          <Text style={[styles.meta, { color: palette.muted }]}>
            {item.valueCents != null ? formatMoney(Math.round(item.valueCents)) : lastCounted}
          </Text>
        </View>
      </View>
      <Pressable
        onPress={() => onQuickAction(item)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Count or adjust ${item.name}`}
        style={({ pressed }) => [styles.action, { borderColor: palette.border, opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={[styles.actionText, { color: palette.charcoal }]}>Update</Text>
      </Pressable>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderLeftWidth: 4,
    marginBottom: spacing.sm,
  },
  main: { flex: 1, minWidth: 0, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flex: 1, fontSize: 15, fontWeight: '700' },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  meta: { fontSize: 12 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 2 },
  qty: { fontSize: 16, fontWeight: '800' },
  par: { fontSize: 12, fontWeight: '500' },
  action: {
    minHeight: 44,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
  },
  actionText: { fontSize: 13, fontWeight: '700' },
});
