import { ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ScreenErrorBoundary } from '../../components/ErrorBoundary';
import { BeoHubWorkspace } from '../../components/BeoHubWorkspace';
import { parseWorkspaceView } from '../../lib/crm-routing';
import { SectionHeader } from '../../components/AppCard';
import { colors, spacing } from '../../lib/theme';
import { useVenueAuth } from '../../lib/useVenueAuth';

export default function GuestsScreenWrapper() {
  return <ScreenErrorBoundary><GuestsScreen /></ScreenErrorBoundary>;
}

function GuestsScreen() {
  const { venue, isReady, canManage } = useVenueAuth();
  const params = useLocalSearchParams<{ crmView?: string; event?: string; beoId?: string }>();
  const initialView = parseWorkspaceView(params.crmView);
  const initialEventName = typeof params.event === 'string' ? params.event : undefined;
  const initialBeoId = typeof params.beoId === 'string' ? params.beoId : undefined;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <SectionHeader
        kicker="Stadium Operations"
        title="BEO Hub & Hospitality"
        subtitle={venue?.name ?? 'Stadium F&B Operations'}
      />
      <BeoHubWorkspace
        venueId={venue?.id}
        enabled={isReady && canManage}
        initialView={initialView ?? 'hub'}
        initialEventName={initialEventName}
        initialBeoId={initialBeoId}
      />
    </ScrollView>
  );
}
