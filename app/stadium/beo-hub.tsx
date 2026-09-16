import React from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScreenErrorBoundary } from '../../components/ErrorBoundary';
import { BeoHubWorkspace } from '../../components/BeoHubWorkspace';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { CommandText } from '../../components/FutureUI';
import { colors, radius, spacing, useDesignTheme } from '../../lib/theme';

export default function StadiumBeoHubScreenWrapper() {
  return (
    <ScreenErrorBoundary>
      <StadiumBeoHubScreen />
    </ScreenErrorBoundary>
  );
}

function StadiumBeoHubScreen() {
  const palette = useDesignTheme();
  const { venue, isReady, canManage } = useVenueAuth();
  const params = useLocalSearchParams<{
    beoId?: string;
    event?: string;
    eventName?: string;
  }>();

  const beoId = typeof params.beoId === 'string' && params.beoId.trim() ? params.beoId.trim() : undefined;
  const eventName =
    typeof params.event === 'string' && params.event.trim()
      ? params.event.trim()
      : typeof params.eventName === 'string' && params.eventName.trim()
      ? params.eventName.trim()
      : undefined;

  if (!isReady) {
    return (
      <View style={{ flex: 1, padding: spacing.xl, justifyContent: 'center', alignItems: 'center', backgroundColor: palette.background }}>
        <CommandText palette={palette} variant="body">Loading BEO Operations Hub...</CommandText>
      </View>
    );
  }

  if (!venue) {
    return (
      <View style={{ flex: 1, padding: spacing.xl, justifyContent: 'center', alignItems: 'center', gap: spacing.sm, backgroundColor: palette.background }}>
        <CommandText palette={palette} variant="title">No Venue Selected</CommandText>
        <CommandText palette={palette} variant="body" style={{ color: palette.muted, textAlign: 'center' }}>
          Select an active stadium venue to view event BEO execution.
        </CommandText>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      {/* Stadium Header */}
      <View style={[styles.headerBanner, { backgroundColor: '#0A2540' }]}>
        <View style={styles.headerTopRow}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.6 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <MaterialCommunityIcons name="arrow-left" size={20} color="#FFFFFF" />
            <CommandText palette={palette} variant="label" style={{ color: '#A8C4E0' }}>
              BACK
            </CommandText>
          </Pressable>

          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <CommandText palette={palette} variant="caption" style={{ color: '#FFFFFF', fontWeight: '800' }}>
              LIVE BEO EXECUTION
            </CommandText>
          </View>
        </View>

        <CommandText palette={palette} variant="hero" style={{ color: '#FFFFFF', marginTop: spacing.xs }}>
          BEO Operations Hub
        </CommandText>
        <CommandText palette={palette} variant="body" style={{ color: '#C5D6EB', marginTop: 2 }}>
          Confirmed event BEO orders, space timelines, dietary allergens, and departmental run of service.
        </CommandText>
      </View>

      {/* Embedded BEO Execution Workspace */}
      <View style={styles.workspaceWrapper}>
        <BeoHubWorkspace
          venueId={venue.id}
          enabled={isReady && canManage}
          initialBeoId={beoId}
          initialEventName={eventName}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: spacing.xxl,
  },
  headerBanner: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: radius.sm,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  workspaceWrapper: {
    padding: spacing.md,
  },
});
