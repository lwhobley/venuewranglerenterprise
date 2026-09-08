import React, { ReactNode } from "react";
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import {
  chromeGold,
  dept,
  deptTint,
  hairline,
  ink,
  radius,
  shadowSoft,
  spacing,
  statusColors,
  stone,
  surfaceIvory,
} from "../lib/theme";

/**
 * HairlinePanel: A crisp, ivory-surfaced HUD card.
 * 16px corner radius, 1px hairline border, subtle short gray shadow.
 * Never washed in color or liquid glows.
 */
export function HairlinePanel({
  children,
  style,
  onPress,
  borderTint,
  backgroundColor = "#FFFFFF",
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  borderTint?: string;
  backgroundColor?: string;
}) {
  const containerStyle: ViewStyle = {
    backgroundColor,
    borderRadius: radius.control,
    borderWidth: hairline,
    borderColor: borderTint || "#D8CFC0",
    overflow: "hidden",
    ...shadowSoft,
  };

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          containerStyle,
          { opacity: pressed ? 0.92 : 1 },
          style,
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={[containerStyle, style]}>{children}</View>;
}

/**
 * MetricRing: 2px circular ring with value and label.
 * Color is strictly confined to the 2px perimeter ring.
 */
export function MetricRing({
  value,
  label,
  tint,
  size = 68,
  onPress,
  style,
}: {
  value: string | number;
  label: string;
  tint: string;
  size?: number;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const content = (
    <View
      style={[
        {
          alignItems: "center",
          justifyContent: "center",
          width: size + 20,
        },
        style,
      ]}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius.metric,
          borderWidth: 2,
          borderColor: tint,
          backgroundColor: "#FFFFFF",
          alignItems: "center",
          justifyContent: "center",
          padding: 2,
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            color: ink,
            fontSize: size >= 70 ? 20 : 16,
            fontWeight: "700",
            letterSpacing: -0.3,
          }}
        >
          {value}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={{
          marginTop: 6,
          fontSize: 11,
          fontWeight: "600",
          color: stone,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
        {content}
      </Pressable>
    );
  }

  return content;
}

export type HudStatus =
  | "confirmed"
  | "needs_review"
  | "in_service"
  | "closed"
  | "cancelled"
  | "alert"
  | string;

/**
 * StatusChip: Full saturation status indicator.
 * White or ivory fill, colored 1px border and colored label text.
 * No pastel washes.
 */
export function StatusChip({
  status,
  label,
  style,
  size = "regular",
}: {
  status: HudStatus;
  label?: string;
  style?: StyleProp<ViewStyle>;
  size?: "small" | "regular";
}) {
  const norm = (status || "").toLowerCase().replace(/[\s-]/g, "_");
  let color: string = statusColors.needs_review;
  if (norm === "confirmed" || norm === "ready" || norm === "active") color = statusColors.confirmed;
  else if (norm === "needs_review" || norm === "pending" || norm === "draft") color = statusColors.needs_review;
  else if (norm === "in_service" || norm === "in_progress") color = statusColors.in_service;
  else if (norm === "closed" || norm === "completed" || norm === "cancelled") color = statusColors.closed;
  else if (norm === "alert" || norm === "86" || norm === "urgent") color = statusColors.alert;

  const displayText = label || status.replace(/_/g, " ").toUpperCase();
  const isSmall = size === "small";

  return (
    <View
      style={[
        {
          backgroundColor: "#FFFFFF",
          borderWidth: 1,
          borderColor: color,
          borderRadius: 999,
          paddingHorizontal: isSmall ? 8 : 10,
          paddingVertical: isSmall ? 2 : 4,
          alignSelf: "flex-start",
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <Text
        style={{
          color,
          fontSize: isSmall ? 10 : 11,
          fontWeight: "700",
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
      >
        {displayText}
      </Text>
    </View>
  );
}

/**
 * DeptRailRow: List card with 3-4px solid department color rail on the left.
 * The card body remains crisp ivory/white.
 */
export function DeptRailRow({
  tint,
  title,
  subtitle,
  meta,
  status,
  statusLabel,
  rightElement,
  onPress,
  style,
}: {
  tint: string;
  title: string;
  subtitle?: string;
  meta?: string;
  status?: HudStatus;
  statusLabel?: string;
  rightElement?: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const content = (
    <View
      style={[
        {
          backgroundColor: "#FFFFFF",
          borderRadius: radius.control,
          borderWidth: hairline,
          borderColor: "#D8CFC0",
          flexDirection: "row",
          overflow: "hidden",
          ...shadowSoft,
        },
        style,
      ]}
    >
      {/* 4px Department Left Rail */}
      <View style={{ width: 4, backgroundColor: tint }} />

      <View
        style={{
          flex: 1,
          paddingVertical: 12,
          paddingHorizontal: 14,
          justifyContent: "center",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: subtitle || meta ? 4 : 0,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: ink,
              fontSize: 15,
              fontWeight: "600",
              marginRight: 8,
            }}
          >
            {title}
          </Text>
          {status && <StatusChip status={status} label={statusLabel} size="small" />}
          {rightElement}
        </View>

        {subtitle && (
          <Text
            numberOfLines={1}
            style={{
              color: ink,
              fontSize: 13,
              fontWeight: "400",
              marginBottom: meta ? 2 : 0,
            }}
          >
            {subtitle}
          </Text>
        )}

        {meta && (
          <Text
            numberOfLines={1}
            style={{
              color: stone,
              fontSize: 12,
              fontWeight: "500",
            }}
          >
            {meta}
          </Text>
        )}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
        {content}
      </Pressable>
    );
  }

  return content;
}

/**
 * StraightTimeline: Straight hairline + circular node pips (not a ribbon).
 */
export function StraightTimeline({
  steps,
  currentStepIndex,
  tint = chromeGold,
  style,
}: {
  steps: Array<{ id: string; label: string; time?: string; status?: string }>;
  currentStepIndex?: number;
  tint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ paddingVertical: 8 }, style]}>
      {steps.map((step, index) => {
        const isPast = currentStepIndex !== undefined && index < currentStepIndex;
        const isCurrent = currentStepIndex !== undefined && index === currentStepIndex;
        const isLast = index === steps.length - 1;

        const nodeColor = isCurrent ? tint : isPast ? stone : "#D8CFC0";

        return (
          <View key={step.id || index} style={{ flexDirection: "row", minHeight: 44 }}>
            {/* Timeline spine and node */}
            <View style={{ width: 24, alignItems: "center" }}>
              {/* Circular node pip */}
              <View
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  borderWidth: 2,
                  borderColor: nodeColor,
                  backgroundColor: isCurrent ? nodeColor : "#FFFFFF",
                  marginTop: 4,
                  zIndex: 2,
                }}
              />
              {/* Hairline connecting line */}
              {!isLast && (
                <View
                  style={{
                    position: "absolute",
                    top: 16,
                    bottom: 0,
                    width: hairline,
                    backgroundColor: "#D8CFC0",
                    zIndex: 1,
                  }}
                />
              )}
            </View>

            {/* Label and Meta */}
            <View style={{ flex: 1, paddingLeft: 10, paddingBottom: isLast ? 0 : 16 }}>
              <Text
                style={{
                  color: isCurrent ? ink : stone,
                  fontSize: 13,
                  fontWeight: isCurrent ? "700" : "500",
                }}
              >
                {step.label}
              </Text>
              {step.time && (
                <Text
                  style={{
                    color: stone,
                    fontSize: 11,
                    marginTop: 2,
                  }}
                >
                  {step.time}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * CapsuleDock: Horizontal container for switcher tabs or tools.
 * Pill radius (999), 1px border, ivory background.
 * Active pill uses that dept tint as border ONLY (never solid block wash).
 */
export function CapsuleDock({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: surfaceIvory,
          borderRadius: radius.pill,
          borderWidth: hairline,
          borderColor: "#D8CFC0",
          padding: 4,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * CapsulePill: Individual item inside a CapsuleDock.
 * Active state: 1-2px border of tint, white/ivory fill, charcoal ink text.
 */
export function CapsulePill({
  label,
  active,
  tint = chromeGold,
  onPress,
  style,
}: {
  label: string;
  active?: boolean;
  tint?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          paddingHorizontal: 14,
          paddingVertical: 6,
          borderRadius: radius.pill,
          borderWidth: active ? 1.5 : 0,
          borderColor: active ? tint : "transparent",
          backgroundColor: active ? "#FFFFFF" : "transparent",
          opacity: pressed ? 0.8 : 1,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <Text
        style={{
          color: active ? ink : stone,
          fontSize: 12,
          fontWeight: active ? "700" : "500",
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
