import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { Card } from 'react-native-paper';
import { colors, spacing } from '../lib/theme';

function Bar({ width, height = 14, pulse }: { width: number | string; height?: number; pulse: Animated.Value }) {
  return (
    <Animated.View
      style={{
        width: width as any,
        height,
        borderRadius: 6,
        backgroundColor: colors.border,
        opacity: pulse,
      }}
    />
  );
}

// Lightweight loading placeholder for card-and-row screens. Pulses opacity so
// the wait reads as "loading" rather than a frozen empty state.
export function CardListSkeleton({ rows = 4 }: { rows?: number }) {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View accessibilityLabel="Loading" style={{ gap: spacing.md }}>
      <Card style={{ backgroundColor: colors.surface, borderRadius: 10 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Bar width="40%" height={20} pulse={pulse} />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Bar width={120} pulse={pulse} />
            <Bar width={120} pulse={pulse} />
            <Bar width={120} pulse={pulse} />
          </View>
        </Card.Content>
      </Card>
      <Card style={{ backgroundColor: colors.surface, borderRadius: 10 }}>
        <Card.Content style={{ gap: spacing.md }}>
          {Array.from({ length: rows }).map((_, i) => (
            <View key={i} style={{ gap: 8 }}>
              <Bar width="55%" pulse={pulse} />
              <Bar width="80%" height={10} pulse={pulse} />
            </View>
          ))}
        </Card.Content>
      </Card>
    </View>
  );
}
