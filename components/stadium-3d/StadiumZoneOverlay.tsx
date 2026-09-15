import { Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { StadiumZoneData } from '../stadium-map/zone-data';
import { HIGHLIGHT_STATUS_LABELS, getHighlightColor } from './stadium-model-bindings';
import type { OperationalHighlightStatus } from './stadium-3d.types';
import { styles } from './Stadium3DViewer.styles';

interface StadiumZoneOverlayProps {
  zone: StadiumZoneData;
  highlightStatus: OperationalHighlightStatus;
  onOpenDetails: () => void;
  onClose: () => void;
}

export function StadiumZoneOverlay({
  zone,
  highlightStatus,
  onOpenDetails,
  onClose,
}: StadiumZoneOverlayProps) {
  // Same table that lights the model and fills the legend.
  const statusColor = getHighlightColor(highlightStatus).colorHex;
  const statusLabel = HIGHLIGHT_STATUS_LABELS[highlightStatus].toUpperCase();

  const totalUnits = zone.unitsCount ?? zone.units.length;
  const openUnits = zone.openCount ?? zone.units.filter((u) => u.status === 'open').length;
  // The two zones with no geometry in the asset still appear here from the
  // zone list; without units there is nothing for the details modal to open.
  const hasUnits = zone.units.length > 0;
  // Suites, bunkers and clubs carry the BEO and the group (suiteholder) it is
  // booked for; stands and gates have neither.
  const bookings = zone.units.flatMap((unit) =>
    unit.suiteDetails && (unit.suiteDetails.beoNumber || unit.suiteDetails.suiteholder)
      ? [{ unit, suite: unit.suiteDetails }] : []);

  return (
    <View
      style={styles.overlayCard}
      accessibilityRole="summary"
      accessibilityLabel={`Selected stadium zone: ${zone.name}`}
    >
      {/* Top row */}
      <View style={styles.overlayHeader}>
        <View style={styles.overlayHeaderLeft}>
          <View style={styles.overlayBadgeRow}>
            <View style={styles.overlayCodeBadge}>
              <Text style={styles.overlayCodeText}>{zone.code}</Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 4,
              }}
            >
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
              <Text style={{ fontSize: 9, fontWeight: '800', color: statusColor }}>{statusLabel}</Text>
            </View>
            {zone.alertCount > 0 ? (
              <View
                style={{
                  backgroundColor: 'rgba(211, 47, 47, 0.2)',
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 4,
                  borderWidth: 1,
                  borderColor: '#D32F2F',
                }}
              >
                <Text style={{ color: '#FF5252', fontSize: 9, fontWeight: '800' }}>
                  {zone.alertCount} {zone.alertCount === 1 ? 'ALERT' : 'ALERTS'}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.overlayTitle} numberOfLines={1}>
            {zone.name}
          </Text>
          <Text style={styles.overlayMetaText}>
            Level {zone.level} · {zone.department.replace(/_/g, ' ')}
          </Text>
        </View>

        <Pressable
          onPress={onClose}
          hitSlop={8}
          style={styles.overlayCloseBtn}
          accessibilityRole="button"
          accessibilityLabel="Dismiss zone card"
        >
          <MaterialCommunityIcons name="close" size={18} color="#90A4AE" />
        </Pressable>
      </View>

      {/* Stats summary row */}
      <View style={styles.overlayStatsRow}>
        <View style={styles.overlayStatItem}>
          <MaterialCommunityIcons name="storefront-outline" size={14} color="#00E5FF" />
          <Text style={styles.overlayStatLabel}>Units:</Text>
          <Text style={styles.overlayStatValue}>{totalUnits}</Text>
        </View>
        <View style={styles.overlayStatItem}>
          <MaterialCommunityIcons name="check-circle-outline" size={14} color="#00E676" />
          <Text style={styles.overlayStatLabel}>Active:</Text>
          <Text style={styles.overlayStatValue}>{openUnits}</Text>
        </View>
        <View style={styles.overlayStatItem}>
          <MaterialCommunityIcons name="shield-account-outline" size={14} color="#FFD700" />
          <Text style={styles.overlayStatLabel}>Dept:</Text>
          <Text style={styles.overlayStatValue}>
            {zone.department.split('_')[0].toUpperCase()}
          </Text>
        </View>
      </View>

      {/* BEOs and the groups they are booked for in this area */}
      <View style={styles.overlayBeoSection}>
        <Text style={styles.overlaySectionLabel}>
          BEOS & GROUPS{bookings.length ? ` · ${bookings.length}` : ''}
        </Text>
        {bookings.length ? (
          <ScrollView style={styles.overlayBeoList} nestedScrollEnabled showsVerticalScrollIndicator>
            {bookings.map(({ unit, suite }) => (
              <View key={unit.id} style={styles.overlayBeoRow}>
                <View style={styles.overlayBeoRowHeader}>
                  <Text style={styles.overlayBeoNumber} numberOfLines={1}>
                    {suite.beoNumber ?? 'No BEO'}
                  </Text>
                  <Text style={styles.overlayBeoSuite} numberOfLines={1}>
                    {suite.suiteNumber}
                  </Text>
                </View>
                <Text style={styles.overlayBeoGroup} numberOfLines={1}>
                  {suite.suiteholder ?? unit.name}
                </Text>
                <Text style={styles.overlayBeoMeta} numberOfLines={1}>
                  {[
                    suite.beoPackageName,
                    suite.hostName ? `Host ${suite.hostName}` : null,
                    suite.guestCount != null ? `${suite.guestCount} guests` : null,
                  ].filter(Boolean).join(' · ')}
                </Text>
              </View>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.overlayBeoEmpty}>No BEOs or groups booked in this area.</Text>
        )}
      </View>

      {/* Action button */}
      <View style={styles.overlayActionsRow}>
        <Pressable
          onPress={onOpenDetails}
          disabled={!hasUnits}
          style={({ pressed }) => [
            styles.overlayOpenBtn,
            { opacity: !hasUnits ? 0.45 : pressed ? 0.8 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !hasUnits }}
          accessibilityLabel={
            hasUnits
              ? `Open details and workflows for ${zone.name}`
              : `${zone.name} has no units to open`
          }
        >
          <MaterialCommunityIcons name="clipboard-text-outline" size={16} color="#001E3D" />
          <Text style={styles.overlayOpenBtnText}>
            {hasUnits ? 'OPEN OPERATIONS DETAILS' : 'NO UNITS IN THIS ZONE'}
          </Text>
          {hasUnits ? <MaterialCommunityIcons name="arrow-right" size={16} color="#001E3D" /> : null}
        </Pressable>
      </View>
    </View>
  );
}
