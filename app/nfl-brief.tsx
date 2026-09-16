import { useState } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Button, Chip, Dialog, Portal, TextInput } from 'react-native-paper';
import { CommandSurface, CommandText, StatusPill } from '../components/FutureUI';
import { api } from '../lib/railway-api';
import { useMutation, useQueryState } from '../lib/railway-hooks';
import { humanizeLabel, errorMessage } from '../lib/format';
import { spacing, useDesignTheme } from '../lib/theme';

type Brief = {
  event: { id?: string; title: string; opponentOrHeadliner?: string | null };
  currentPhase?: string;
  phaseStartedAt?: string | null;
  alcoholCutoffEnforced?: boolean;
  isOvertime?: boolean;
  phases: Array<{ key: string; label: string; at: string }>;
  activation: Array<{ id: string; name: string; department: string; stadiumZone?: string | null; readiness: string }>;
  openIssues: Array<{ title: string; severity: string }>;
  controls: string[];
  assumptions: string[];
};

const PHASES_FLOW = [
  { key: 'load_in', label: 'Load-In' },
  { key: 'gates', label: 'Gates Open' },
  { key: 'pregame', label: 'Pregame' },
  { key: 'kickoff', label: 'Kickoff' },
  { key: 'halftime', label: 'Halftime' },
  { key: 'q4_alcohol_cutoff', label: 'Q4 Alcohol Cutoff' },
  { key: 'postgame', label: 'Postgame / Egress' },
];

export default function NflBriefScreen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const palette = useDesignTheme();
  const query = useQueryState<Brief>(api.stadium.getNflBrief, eventId ? { eventId } : 'skip');
  const brief = query.data;
  const advancePhase = useMutation(api.stadium.advanceEventPhase);

  const [confirmPhase, setConfirmPhase] = useState<string | null>(null);
  const [phaseReason, setPhaseReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const handleAdvance = async (phase: string) => {
    if (!eventId) return;
    setMessage(null);
    try {
      const isAlcoholCutoff = phase === 'q4_alcohol_cutoff';
      await advancePhase({
        eventId,
        phase,
        reason: phaseReason.trim() || undefined,
        alcoholCutoffEnforced: isAlcoholCutoff || Boolean(brief?.alcoholCutoffEnforced),
      });
      setConfirmPhase(null);
      setPhaseReason('');
      setMessage(`Advanced game phase to ${humanizeLabel(phase)}.`);
      await query.refetch();
    } catch (err) {
      setMessage(errorMessage(err, 'Failed to advance game phase.'));
    }
  };

  const handleToggleAlcoholCutoff = async () => {
    if (!eventId) return;
    const nextCutoff = !brief?.alcoholCutoffEnforced;
    try {
      await advancePhase({
        eventId,
        phase: brief?.currentPhase ?? 'live',
        reason: nextCutoff ? 'Alcohol sales ceased per venue policy' : 'Alcohol sales restored',
        alcoholCutoffEnforced: nextCutoff,
      });
      setMessage(nextCutoff ? 'Alcohol cutoff ENFORCED across all concourse outlets.' : 'Alcohol cutoff cleared.');
      await query.refetch();
    } catch (err) {
      setMessage(errorMessage(err, 'Failed to update alcohol cutoff status.'));
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: 'transparent' }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button mode="text" textColor={palette.primary} onPress={() => router.back()}>Back</Button>
      </View>

      {message ? (
        <CommandSurface palette={palette} inset>
          <CommandText palette={palette} variant="body">{message}</CommandText>
        </CommandSurface>
      ) : null}

      <CommandSurface palette={palette} strong style={{ gap: spacing.xs }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <CommandText palette={palette} variant="label">Event brief & game operations</CommandText>
            <CommandText palette={palette} variant="hero">{brief?.event?.title ?? 'Loading event brief'}</CommandText>
            <CommandText palette={palette} variant="caption">{brief?.event?.opponentOrHeadliner ?? 'Opponent not set'}</CommandText>
          </View>
          <View style={{ gap: spacing.xs, alignItems: 'flex-end' }}>
            {brief?.currentPhase ? (
              <StatusPill palette={palette} tone="good">
                Phase: {humanizeLabel(brief.currentPhase)}
              </StatusPill>
            ) : null}
            <StatusPill palette={palette} tone={brief?.alcoholCutoffEnforced ? 'danger' : 'neutral'}>
              {brief?.alcoholCutoffEnforced ? 'ALCOHOL CUTOFF' : 'Alcohol Active'}
            </StatusPill>
          </View>
        </View>
      </CommandSurface>

      <CommandSurface palette={palette} style={{ gap: spacing.sm }}>
        <CommandText palette={palette} variant="title">Game phase & run of show</CommandText>
        <CommandText palette={palette} variant="caption">
          Current phase:{' '}
          <CommandText palette={palette} variant="caption" style={{ fontWeight: '700' }}>
            {humanizeLabel(brief?.currentPhase ?? 'load_in')}
          </CommandText>
          {brief?.phaseStartedAt ? ` (since ${new Date(brief.phaseStartedAt).toLocaleTimeString()})` : ''}
        </CommandText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {PHASES_FLOW.map((p) => {
            const isCurrent = brief?.currentPhase === p.key;
            return (
              <Chip
                key={p.key}
                selected={isCurrent}
                onPress={() => setConfirmPhase(p.key)}
              >
                {p.label}
              </Chip>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
          <Button
            mode={brief?.alcoholCutoffEnforced ? 'outlined' : 'contained'}
            buttonColor={brief?.alcoholCutoffEnforced ? undefined : palette.danger}
            textColor={brief?.alcoholCutoffEnforced ? palette.danger : '#ffffff'}
            onPress={() => void handleToggleAlcoholCutoff()}
          >
            {brief?.alcoholCutoffEnforced ? 'Clear Alcohol Cutoff' : 'Enforce Alcohol Cutoff'}
          </Button>
        </View>
      </CommandSurface>

      <CommandSurface palette={palette} style={{ gap: spacing.sm }}>
        <CommandText palette={palette} variant="title">Event schedule checkpoints</CommandText>
        {brief?.phases?.map((phase) => (
          <View key={phase.key} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: palette.border, paddingVertical: spacing.xs }}>
            <CommandText palette={palette} variant="body" style={{ flex: 1, minWidth: 140 }}>{phase.label}</CommandText>
            <CommandText palette={palette} variant="caption">{new Date(phase.at).toLocaleTimeString()}</CommandText>
          </View>
        ))}
      </CommandSurface>

      <CommandSurface palette={palette} style={{ gap: spacing.xs }}>
        <CommandText palette={palette} variant="title">Activation by department</CommandText>
        {brief?.activation?.map((outlet) => (
          <View key={outlet.id} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
            <View style={{ flex: 1, minWidth: 160 }}>
              <CommandText palette={palette} variant="body">{outlet.name}</CommandText>
              <CommandText palette={palette} variant="caption">{outlet.department} · {outlet.stadiumZone ?? 'Unzoned'}</CommandText>
            </View>
            <StatusPill palette={palette} tone={outlet.readiness === 'ready' ? 'good' : 'warn'}>{outlet.readiness}</StatusPill>
          </View>
        ))}
      </CommandSurface>

      <CommandSurface palette={palette} style={{ gap: spacing.xs }}>
        <CommandText palette={palette} variant="title">Critical controls</CommandText>
        {brief?.controls?.map((control) => (
          <CommandText key={control} palette={palette} variant="body">• {control}</CommandText>
        ))}
      </CommandSurface>

      <Portal>
        <Dialog visible={Boolean(confirmPhase)} onDismiss={() => setConfirmPhase(null)}>
          <Dialog.Title>Advance Game Phase</Dialog.Title>
          <Dialog.Content style={{ gap: spacing.sm }}>
            <CommandText palette={palette} variant="body">
              Advance game phase to {confirmPhase ? humanizeLabel(confirmPhase) : ''}?
            </CommandText>
            {confirmPhase === 'q4_alcohol_cutoff' ? (
              <CommandText palette={palette} variant="caption" style={{ color: palette.warning }}>
                This phase transition will automatically set the concourse alcohol cutoff flag.
              </CommandText>
            ) : null}
            <TextInput
              mode="outlined"
              label="Transition reason (optional)"
              value={phaseReason}
              onChangeText={setPhaseReason}
              placeholder="e.g. Official referee timeout / Q4 start"
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmPhase(null)}>Cancel</Button>
            <Button
              mode="contained"
              buttonColor={palette.primary}
              onPress={() => confirmPhase && void handleAdvance(confirmPhase)}
            >
              Confirm Advance
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScrollView>
  );
}

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../components/ErrorBoundary';
