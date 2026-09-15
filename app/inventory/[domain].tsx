import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryState } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import { errorMessage } from '../../lib/format';
import { radius, spacing, useDesignTheme } from '../../lib/theme';
import { useResponsive } from '../../lib/responsive';
import { SectionHeader } from '../../components/AppCard';
import { InlineMessage } from '../../components/InlineMessage';
import { InventorySubNav } from '../../components/inventory/InventorySubNav';
import { InventoryItemCard } from '../../components/inventory/InventoryItemCard';
import { MovementSheet, type MovementTarget } from '../../components/inventory/MovementSheet';
import {
  CATALOG_DOMAINS,
  STOCK_STATUS_META,
  isCatalogDomain,
  type InventoryCategory,
  type InventoryItemPage,
  type InventoryItemSummary,
  type StockStatus,
} from '../../lib/inventory-types';

const PAGE_SIZE = 50;
const STATUS_FILTERS: Array<StockStatus | 'all'> = ['all', 'critical', 'low', 'out', 'ok'];

/** Food, Beverage or Equipment catalog: category rail, search, status filter, virtualized list. */
export default function InventoryCatalogScreen() {
  const { domain } = useLocalSearchParams<{ domain: string }>();
  if (!isCatalogDomain(domain)) return <Redirect href={'/inventory' as never} />;
  return <Catalog key={domain} domain={domain} />;
}

function Catalog({ domain }: { domain: 'food' | 'beverage' | 'equipment' }) {
  const palette = useDesignTheme();
  const { pagePadding } = useResponsive();
  const meta = CATALOG_DOMAINS.find((d) => d.key === domain)!;

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [status, setStatus] = useState<StockStatus | 'all'>('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [movementTarget, setMovementTarget] = useState<MovementTarget | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setLimit(PAGE_SIZE); }, [debouncedSearch, categoryId, status]);

  const categories = useQuery<InventoryCategory[]>(api.inventory.listCategories, { domain });
  const { data, error, isLoading, refetch } = useQueryState<InventoryItemPage>(api.inventory.listItems, {
    domain,
    categoryId: categoryId ?? undefined,
    status: status === 'all' ? undefined : status,
    search: debouncedSearch || undefined,
    limit,
  });

  const items = data?.items ?? [];
  const openSheet = useCallback((item: InventoryItemSummary) => {
    setMovementTarget({ itemId: item.id, name: item.name, unit: item.baseUnit, locations: item.locations });
  }, []);

  const header = useMemo(() => (
    <View style={{ gap: spacing.md, marginBottom: spacing.md }}>
      <SectionHeader kicker="Inventory" title={meta.label} rule={false} />
      <InventorySubNav active={domain} />

      <View style={[styles.search, { borderColor: palette.border, backgroundColor: palette.surfaceStrong }]}>
        <MaterialCommunityIcons name="magnify" size={20} color={palette.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, SKU, barcode, brand"
          placeholderTextColor={palette.muted}
          accessibilityLabel={`Search ${meta.label.toLowerCase()} inventory`}
          style={[styles.searchInput, { color: palette.charcoal }]}
          returnKeyType="search"
          autoCorrect={false}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
            <MaterialCommunityIcons name="close-circle" size={18} color={palette.muted} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        <FilterChip label="All categories" selected={!categoryId} onPress={() => setCategoryId(null)} />
        {(categories ?? []).map((c) => (
          <FilterChip key={c.id} label={c.name} selected={categoryId === c.id} onPress={() => setCategoryId(categoryId === c.id ? null : c.id)} />
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {STATUS_FILTERS.map((s) => (
          <FilterChip
            key={s}
            label={s === 'all' ? 'Any stock' : STOCK_STATUS_META[s].label}
            color={s === 'all' ? undefined : STOCK_STATUS_META[s].color}
            selected={status === s}
            onPress={() => setStatus(s)}
          />
        ))}
      </ScrollView>

      {data ? (
        <Text style={{ color: palette.muted, fontSize: 13 }}>
          {data.total} {data.total === 1 ? 'item' : 'items'}{data.truncated ? ' (showing the first 5,000; narrow the search)' : ''}
        </Text>
      ) : null}
      {error ? <InlineMessage message={errorMessage(error, 'Items could not load.')} /> : null}
    </View>
  ), [meta.label, domain, palette, search, categories, categoryId, status, data, error]);

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <InventoryItemCard item={item} onQuickAction={openSheet} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          isLoading ? <ActivityIndicator style={{ marginTop: spacing.xl }} /> : error ? (
            <Pressable onPress={() => void refetch()} style={styles.retry} accessibilityRole="button">
              <Text style={{ color: palette.charcoal, fontWeight: '700' }}>Retry</Text>
            </Pressable>
          ) : (
            <Text style={[styles.empty, { color: palette.muted }]}>
              {debouncedSearch || categoryId || status !== 'all'
                ? 'No items match these filters.'
                : `No ${meta.label.toLowerCase()} items yet. Import existing inventory from the Overview.`}
            </Text>
          )
        }
        ListFooterComponent={data?.nextOffset != null ? (
          <Pressable onPress={() => setLimit((l) => l + PAGE_SIZE)} style={[styles.more, { borderColor: palette.border }]} accessibilityRole="button">
            <Text style={{ color: palette.charcoal, fontWeight: '700' }}>Show more</Text>
          </Pressable>
        ) : null}
        contentContainerStyle={{ padding: pagePadding, paddingBottom: spacing.huge, width: '100%', maxWidth: 960, alignSelf: 'center' }}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={7}
        removeClippedSubviews
      />
      <MovementSheet target={movementTarget} onClose={() => setMovementTarget(null)} />
    </View>
  );
}

function FilterChip({ label, selected, onPress, color }: { label: string; selected: boolean; onPress: () => void; color?: string }) {
  const palette = useDesignTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        { backgroundColor: selected ? palette.charcoal : palette.surfaceStrong, borderColor: selected ? palette.charcoal : color ?? palette.border },
      ]}
    >
      <Text style={{ color: selected ? palette.surfaceStrong : color ?? palette.charcoal, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 48 },
  searchInput: { flex: 1, fontSize: 15, minHeight: 44 },
  rail: { gap: spacing.sm },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1 },
  empty: { textAlign: 'center', marginTop: spacing.xl, fontSize: 14 },
  retry: { alignSelf: 'center', marginTop: spacing.lg, minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.lg },
  more: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xl, borderRadius: radius.pill, borderWidth: 1, marginTop: spacing.md },
});
