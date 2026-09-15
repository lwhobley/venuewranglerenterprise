import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { radius, spacing, useDesignTheme } from '../../lib/theme';
import { CATALOG_DOMAINS } from '../../lib/inventory-types';

export type InventorySection = 'overview' | 'food' | 'beverage' | 'equipment';

const SECTIONS: Array<{ key: InventorySection; label: string; icon: string; href: string }> = [
  { key: 'overview', label: 'Overview', icon: 'view-dashboard-outline', href: '/inventory' },
  ...CATALOG_DOMAINS.map((d) => ({ key: d.key, label: d.label, icon: d.icon, href: `/inventory/${d.key}` })),
];

/**
 * Persistent inventory sub-navigation. Horizontally scrollable so it stays one
 * row on a phone as later phases add Counts, Transfers, Purchasing and the rest.
 */
export function InventorySubNav({ active }: { active: InventorySection }) {
  const palette = useDesignTheme();
  return (
    <View style={[styles.wrap, { borderBottomColor: palette.divider }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {SECTIONS.map((section) => {
          const selected = section.key === active;
          return (
            <Pressable
              key={section.key}
              onPress={() => { if (!selected) router.replace(section.href as never); }}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`Inventory ${section.label}`}
              style={({ pressed }) => [
                styles.tab,
                {
                  backgroundColor: selected ? palette.charcoal : palette.surfaceStrong,
                  borderColor: selected ? palette.charcoal : palette.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <MaterialCommunityIcons
                name={section.icon as never}
                size={16}
                color={selected ? palette.surfaceStrong : palette.charcoal}
              />
              <Text style={[styles.label, { color: selected ? palette.surfaceStrong : palette.charcoal }]}>
                {section.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: spacing.lg },
  row: { gap: spacing.sm, paddingBottom: spacing.md },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  label: { fontSize: 14, fontWeight: '700' },
});
