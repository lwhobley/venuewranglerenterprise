import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, useApiQuery } from '../../lib/api-client';
import { asArray } from '../../lib/format';
import { OpsQueryState } from '../../components/stadium/OpsQueryState';
import { opsConsole } from '../../lib/theme';
import { requiredCount, requiredCents } from '../../lib/concourse-counts';

export interface RestockTransfer {
  id: string;
  fromOutletId: string;
  toOutletId: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'in_transit' | 'completed' | 'rejected';
  items: Array<{ code: string; name: string; quantity: number }>;
  createdAt: string;
}

export interface HawkerSession {
  itemsCheckedOut: Array<{ code: string; name: string; quantity: number; unitPriceCents: number }>;
  id: string;
  hawkerId: string;
  hawkerName: string;
  grossSalesCents: number;
  commissionRateBps: number;
  commissionPayoutCents: number;
  status: 'active' | 'checked_in' | 'settled';
}

const TRANSFERS_KEY = ['stadium', 'concourse', 'transfers'];
const HAWKERS_KEY = ['stadium', 'concourse', 'hawkers'];

type Settlement = { itemsCheckedIn: Array<{ code: string; name: string; quantity: number }>; cashCollectedCents: number; cardCollectedCents: number };

function HawkerSettlementForm({ session, onSettle }: { session: HawkerSession; onSettle: (body: Settlement) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [returns, setReturns] = useState<Record<string, string>>({});
  const [cash, setCash] = useState('');
  const [card, setCard] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (!session.itemsCheckedOut?.length) throw new Error('Checkout inventory is unavailable. Reload the session before settling.');
      let gross = 0;
      const itemsCheckedIn = session.itemsCheckedOut.map(item => {
        const quantity = requiredCount(returns[item.code], `${item.name} returned`);
        if (quantity > item.quantity) throw new Error(`${item.name} returns exceed checkout quantity.`);
        gross += Math.round((item.quantity - quantity) * item.unitPriceCents);
        return { code: item.code, name: item.name, quantity };
      }).filter(item => item.quantity > 0);
      const cashCollectedCents = requiredCents(cash, 'cash collected');
      const cardCollectedCents = requiredCents(card, 'card collected');
      if (cashCollectedCents + cardCollectedCents !== gross) throw new Error(`Collected cash and card must total $${(gross / 100).toFixed(2)}.`);
      await onSettle({ itemsCheckedIn, cashCollectedCents, cardCollectedCents });
    } catch (error) {
      Alert.alert('Settlement failed', error instanceof Error ? error.message : 'Settlement was not recorded.');
    } finally { setSaving(false); }
  };
  if (!open) return <TouchableOpacity accessibilityRole="button" style={styles.settleBtn} onPress={() => setOpen(true)}><Text style={styles.btnText}>Enter returns & settle</Text></TouchableOpacity>;
  return <View style={{ gap: 8 }}>
    {(session.itemsCheckedOut ?? []).map(item => <View key={item.code}>
      <Text style={styles.itemText}>{item.name} · Checked out {item.quantity} · Returned:</Text>
      <TextInput accessibilityLabel={`${item.name} returned`} editable={!saving} keyboardType="decimal-pad" value={returns[item.code] ?? ''} onChangeText={value => setReturns(previous => ({ ...previous, [item.code]: value }))} style={styles.countInput} />
    </View>)}
    <Text style={styles.itemText}>Cash collected ($)</Text>
    <TextInput accessibilityLabel="Cash collected" editable={!saving} keyboardType="decimal-pad" value={cash} onChangeText={setCash} style={styles.countInput} />
    <Text style={styles.itemText}>Card collected ($)</Text>
    <TextInput accessibilityLabel="Card collected" editable={!saving} keyboardType="decimal-pad" value={card} onChangeText={setCard} style={styles.countInput} />
    <TouchableOpacity accessibilityRole="button" disabled={saving} style={styles.settleBtn} onPress={submit}><Text style={styles.btnText}>{saving ? 'Saving…' : 'Confirm settlement'}</Text></TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => setOpen(false)}><Text style={styles.btnText}>Cancel</Text></TouchableOpacity>
  </View>;
}

export default function CentralCommissaryDashboard() {
  const queryClient = useQueryClient();
  const transfersQuery = useApiQuery<RestockTransfer[]>(TRANSFERS_KEY, '/v1/stadium/concourse/transfers');
  const hawkersQuery = useApiQuery<HawkerSession[]>(HAWKERS_KEY, '/v1/stadium/concourse/hawkers');
  const transfers = asArray<RestockTransfer>(transfersQuery.data);
  const hawkerSessions = asArray<HawkerSession>(hawkersQuery.data);
  const loading = transfersQuery.isLoading || hawkersQuery.isLoading;

  const handleUpdateTransfer = async (id: string, nextStatus: 'approved' | 'completed') => {
    try {
      await apiRequest(`/v1/stadium/concourse/transfers/${id}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
    } catch (error) {
      Alert.alert('Transfer update failed', error instanceof Error ? error.message : 'The transfer was not changed.');
      return;
    }
    await queryClient.invalidateQueries({ queryKey: TRANSFERS_KEY });
    Alert.alert('Transfer Dispatched', `Restock Transfer marked ${nextStatus.toUpperCase()}. Restock items appended to Stand Sheet.`);
  };

  const handleSettleHawker = async (session: HawkerSession, body: Settlement) => {
    try {
      const settled = await apiRequest<HawkerSession & { grossSalesCents: number; commissionPayoutCents: number }>(
        `/v1/stadium/concourse/hawkers/${session.id}/settle`,
        { method: 'POST', body },
      );
      await queryClient.invalidateQueries({ queryKey: HAWKERS_KEY });
      Alert.alert(
        'Hawker Commission Settled',
        `${session.hawkerName}: Gross Sales $${(settled.grossSalesCents / 100).toFixed(2)} | Commission Payout $${(settled.commissionPayoutCents / 100).toFixed(2)}`,
      );
    } catch (error) {
      Alert.alert('Settlement failed', error instanceof Error ? error.message : 'No settlement was recorded.');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>CENTRAL COMMISSARY DISPATCH</Text>
          <Text style={styles.headerSub}>WAREHOUSE TABLET DASHBOARD • HAWKER COMMISSION SETTLEMENT</Text>
        </View>
      </View>

      <OpsQueryState
        isLoading={loading}
        error={transfersQuery.error ?? hawkersQuery.error}
        loadingMessage="Loading commissary dashboard…"
        onRetry={() => {
          void transfersQuery.refetch();
          void hawkersQuery.refetch();
        }}
      >
        <ScrollView contentContainerStyle={styles.body}>
          {/* Transfer Requests Section */}
          <Text style={styles.sectionTitle}>CONCOURSE RESTOCK TRANSFER REQUESTS</Text>
          {transfers.length === 0 ? <Text style={styles.emptyText}>No restock transfers pending.</Text> : null}
          {transfers.map((t) => (
            <View key={t.id} style={styles.transferCard}>
              <View style={styles.cardHeader}>
                <Text style={styles.destText}>TO: {t.toOutletId}</Text>
                <Text style={styles.badgeText}>{t.status.toUpperCase()}</Text>
              </View>
              <Text style={styles.reqByText}>REQUESTED BY: {t.requestedBy}</Text>
              <View style={styles.itemsBox}>
                {t.items.map((i, idx) => (
                  <Text key={idx} style={styles.itemText}>📦 {i.quantity}x {i.name} ({i.code})</Text>
                ))}
              </View>
              <View style={styles.actionRow}>
                {t.status === 'pending' && (
                  <TouchableOpacity style={styles.approveBtn} onPress={() => handleUpdateTransfer(t.id, 'approved')}>
                    <Text style={styles.btnText}>APPROVE & DISPATCH 🚚</Text>
                  </TouchableOpacity>
                )}
                {t.status === 'approved' && (
                  <TouchableOpacity style={styles.completeBtn} onPress={() => handleUpdateTransfer(t.id, 'completed')}>
                    <Text style={styles.btnText}>CONFIRM DELIVERED TO STAND ✅</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}

          {/* Hawker Vendor Commission Section */}
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>HAWKER VENDOR COMMISSION TRACKING</Text>
          {hawkerSessions.length === 0 ? <Text style={styles.emptyText}>No hawker vendors checked out right now.</Text> : null}
          {hawkerSessions.map((h) => (
            <View key={h.id} style={styles.hawkerCard}>
              <View style={styles.cardHeader}>
                <Text style={styles.destText}>{h.hawkerName} ({h.hawkerId})</Text>
                <Text style={styles.badgeText}>{h.status.toUpperCase()}</Text>
              </View>
              <View style={styles.statsRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>GROSS SALES</Text>
                  <Text style={styles.statVal}>${(h.grossSalesCents / 100).toFixed(2)}</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>COMMISSION RATE</Text>
                  <Text style={styles.statVal}>{(h.commissionRateBps / 100).toFixed(2)}%</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>PAYOUT AMOUNT</Text>
                  <Text style={[styles.statVal, { color: opsConsole.good }]}>${(h.commissionPayoutCents / 100).toFixed(2)}</Text>
                </View>
              </View>
              {h.status !== 'settled' && (
                <HawkerSettlementForm session={h} onSettle={body => handleSettleHawker(h, body)} />
              )}
            </View>
          ))}
        </ScrollView>
      </OpsQueryState>
    </View>
  );
}

const styles = StyleSheet.create({
  countInput: { color: opsConsole.text, borderWidth: 1, borderColor: opsConsole.border, borderRadius: 8, padding: 12 },
  container: { flex: 1, backgroundColor: opsConsole.background },
  header: { padding: 16, backgroundColor: opsConsole.surface, borderBottomWidth: 2, borderBottomColor: opsConsole.border },
  headerTitle: { color: opsConsole.text, fontSize: 22, fontWeight: '900' },
  headerSub: { color: opsConsole.muted, fontSize: 11, fontWeight: '700', marginTop: 2 },
  emptyText: { color: opsConsole.mutedDim, fontSize: 13, fontStyle: 'italic' },
  body: { padding: 16, gap: 12 },
  sectionTitle: { color: opsConsole.accentSoft, fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  transferCard: { backgroundColor: opsConsole.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: opsConsole.border },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  destText: { color: opsConsole.textStrong, fontSize: 16, fontWeight: '800', flex: 1, minWidth: 0 },
  badgeText: { color: opsConsole.warn, fontSize: 12, fontWeight: '900', flexShrink: 0 },
  reqByText: { color: opsConsole.muted, fontSize: 12 },
  itemsBox: { backgroundColor: opsConsole.background, padding: 10, borderRadius: 8, marginVertical: 10 },
  itemText: { color: opsConsole.text, fontSize: 13, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: 10 },
  approveBtn: { flex: 1, backgroundColor: opsConsole.accent, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  completeBtn: { flex: 1, backgroundColor: opsConsole.good, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  btnText: { color: opsConsole.textStrong, fontSize: 13, fontWeight: '900', textAlign: 'center' },
  hawkerCard: { backgroundColor: opsConsole.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: opsConsole.border },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginVertical: 12 },
  statBox: { flexGrow: 1, flexBasis: 120, minWidth: 0, backgroundColor: opsConsole.background, padding: 10, borderRadius: 8 },
  statLabel: { color: opsConsole.mutedDim, fontSize: 10, fontWeight: '800' },
  statVal: { color: opsConsole.textStrong, fontSize: 16, fontWeight: '900', marginTop: 2 },
  settleBtn: { backgroundColor: opsConsole.good, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
});

// Expo Router renders this boundary around this route only, so a render
// error here shows a recovery card in place instead of unmounting the
// whole app through the root boundary.
export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
