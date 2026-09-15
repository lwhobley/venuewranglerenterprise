import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import { errorMessage } from '../../lib/format';
import { radius, spacing, useDesignTheme } from '../../lib/theme';
import {
  REASON_CODES,
  REASON_REQUIRED,
  formatQuantity,
  type DirectMovementType,
  type InventoryLocation,
} from '../../lib/inventory-types';

type Mode = DirectMovementType | 'transfer';

const MODES: Array<{ key: Mode; label: string; hint: string }> = [
  { key: 'count_adjustment', label: 'Count', hint: 'Enter what is physically on the shelf.' },
  { key: 'receive', label: 'Receive', hint: 'Add a delivery to this location.' },
  { key: 'transfer', label: 'Transfer', hint: 'Move stock to another location.' },
  { key: 'waste', label: 'Waste', hint: 'Record product thrown away.' },
  { key: 'breakage', label: 'Breakage', hint: 'Record broken bottles or items.' },
  { key: 'spill', label: 'Spill', hint: 'Record spilled product.' },
  { key: 'spoilage', label: 'Spoilage', hint: 'Record expired or spoiled product.' },
  { key: 'manual_adjustment', label: 'Adjust ±', hint: 'Correct stock up or down with a reason.' },
];

export type MovementTarget = {
  itemId: string;
  name: string;
  unit: string;
  /** Balances the item already has; the first is preselected. */
  locations: Array<{ id: string; name: string; onHand: number }>;
};

/**
 * One sheet for every direct stock action. The server owns the maths and the
 * rules (reason required, no negative stock); this sheet only collects input
 * and shows the server's refusal verbatim so a counter knows what to fix.
 */
export function MovementSheet({
  target,
  initialMode = 'count_adjustment',
  onClose,
}: {
  target: MovementTarget | null;
  initialMode?: Mode;
  onClose: () => void;
}) {
  const palette = useDesignTheme();
  const locations = useQuery<InventoryLocation[]>(api.inventory.listLocations, target ? {} : 'skip');
  const recordMovement = useMutation(api.inventory.recordMovement);
  const transfer = useMutation(api.inventory.transfer);

  const [mode, setMode] = useState<Mode>(initialMode);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [toLocationId, setToLocationId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setMode(initialMode);
    setLocationId(target.locations[0]?.id ?? null);
    setToLocationId(null);
    setQuantity('');
    setReasonCode(null);
    setNote('');
    setError(null);
  }, [target, initialMode]);

  const allLocations = useMemo(() => {
    const known = new Map<string, { id: string; name: string; onHand: number | null }>();
    for (const l of target?.locations ?? []) known.set(l.id, { ...l });
    for (const l of locations ?? []) if (!known.has(l.id)) known.set(l.id, { id: l.id, name: l.name, onHand: null });
    return [...known.values()];
  }, [target, locations]);

  if (!target) return null;

  const current = allLocations.find((l) => l.id === locationId);
  const needsReason = mode !== 'transfer' && REASON_REQUIRED.has(mode);
  const parsed = Number(quantity.replace(',', '.'));
  const quantityValid = quantity.trim() !== '' && Number.isFinite(parsed)
    && (mode === 'manual_adjustment' ? parsed !== 0 : mode === 'count_adjustment' ? parsed >= 0 : parsed > 0);
  const canSubmit = !submitting && Boolean(locationId) && quantityValid
    && (!needsReason || Boolean(reasonCode))
    && (mode !== 'transfer' || (Boolean(toLocationId) && toLocationId !== locationId));

  const submit = async () => {
    if (!canSubmit || !locationId) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'transfer') {
        await transfer({ fromLocationId: locationId, toLocationId, lines: [{ itemId: target.itemId, quantity: parsed }], note: note || undefined });
      } else {
        await recordMovement({
          itemId: target.itemId, locationId, type: mode, quantity: parsed,
          reasonCode: needsReason ? reasonCode : undefined, note: note || undefined,
        });
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'The stock change was not saved.'));
    } finally {
      setSubmitting(false);
    }
  };

  const hint = MODES.find((m) => m.key === mode)?.hint;
  const quantityLabel = mode === 'count_adjustment' ? 'Counted quantity' : mode === 'manual_adjustment' ? 'Change (use − to reduce)' : 'Quantity';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close stock update" />
        <View style={[styles.sheet, { backgroundColor: palette.surfaceStrong }]}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: palette.charcoal }]} numberOfLines={1}>{target.name}</Text>
              <Text style={[styles.hint, { color: palette.muted }]}>{hint}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
              <MaterialCommunityIcons name="close" size={22} color={palette.muted} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.lg }}>
            <ChipRow
              label="Action"
              options={MODES.map((m) => ({ key: m.key, label: m.label }))}
              value={mode}
              onChange={(key) => { setMode(key as Mode); setReasonCode(null); }}
            />
            <ChipRow
              label={mode === 'transfer' ? 'From' : 'Location'}
              options={allLocations.map((l) => ({ key: l.id, label: l.onHand != null ? `${l.name} · ${formatQuantity(l.onHand)}` : l.name }))}
              value={locationId}
              onChange={setLocationId}
              empty="No locations yet. Add one in the web console or import existing inventory."
            />
            {mode === 'transfer' ? (
              <ChipRow
                label="To"
                options={allLocations.filter((l) => l.id !== locationId).map((l) => ({ key: l.id, label: l.name }))}
                value={toLocationId}
                onChange={setToLocationId}
              />
            ) : null}

            <View style={{ gap: 6 }}>
              <Text style={[styles.fieldLabel, { color: palette.muted }]}>
                {quantityLabel}{current?.onHand != null && mode !== 'receive' ? ` · ${formatQuantity(current.onHand, target.unit)} on hand` : ''}
              </Text>
              <TextInput
                value={quantity}
                onChangeText={setQuantity}
                keyboardType={mode === 'manual_adjustment' ? 'numbers-and-punctuation' : 'decimal-pad'}
                placeholder={`0 ${target.unit}`}
                placeholderTextColor={palette.muted}
                accessibilityLabel={quantityLabel}
                style={[styles.input, styles.qtyInput, { color: palette.charcoal, borderColor: palette.border }]}
              />
            </View>

            {needsReason ? (
              <ChipRow
                label="Reason (required)"
                options={REASON_CODES.map((r) => ({ key: r.code, label: r.label }))}
                value={reasonCode}
                onChange={setReasonCode}
              />
            ) : null}

            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Note (optional)"
              placeholderTextColor={palette.muted}
              accessibilityLabel="Note"
              style={[styles.input, { color: palette.charcoal, borderColor: palette.border }]}
            />

            {error ? (
              <Text style={[styles.error, { color: palette.danger }]} accessibilityRole="alert">{error}</Text>
            ) : null}
          </ScrollView>

          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit, busy: submitting }}
            style={({ pressed }) => [
              styles.submit,
              { backgroundColor: palette.charcoal, opacity: !canSubmit ? 0.4 : pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.submitText, { color: palette.surfaceStrong }]}>
              {submitting ? 'Saving…' : mode === 'transfer' ? 'Transfer stock' : 'Save'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ChipRow({
  label,
  options,
  value,
  onChange,
  empty,
}: {
  label: string;
  options: Array<{ key: string; label: string }>;
  value: string | null;
  onChange: (key: string) => void;
  empty?: string;
}) {
  const palette = useDesignTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.fieldLabel, { color: palette.muted }]}>{label}</Text>
      {options.length === 0 ? (
        <Text style={{ color: palette.muted, fontSize: 13 }}>{empty ?? 'Nothing to choose.'}</Text>
      ) : (
        <View style={styles.chips}>
          {options.map((option) => {
            const selected = option.key === value;
            return (
              <Pressable
                key={option.key}
                onPress={() => onChange(option.key)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? palette.charcoal : 'transparent',
                    borderColor: selected ? palette.charcoal : palette.border,
                  },
                ]}
              >
                <Text style={{ color: selected ? palette.surfaceStrong : palette.charcoal, fontWeight: '600', fontSize: 13 }}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.md },
  title: { fontSize: 18, fontWeight: '800' },
  hint: { fontSize: 13, marginTop: 2 },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, minHeight: 44, fontSize: 15 },
  qtyInput: { fontSize: 22, fontWeight: '700', minHeight: 56 },
  error: { fontSize: 14, fontWeight: '600' },
  submit: { minHeight: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  submitText: { fontSize: 16, fontWeight: '800' },
});
