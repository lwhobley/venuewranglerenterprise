import { StyleSheet } from "react-native";
import { MD3DarkTheme, MD3LightTheme } from "react-native-paper";
import { create } from "zustand";

// Brand Standard HUD Tokens
export const surfaceIvory = "#f3eee4";
export const ink = "#12110e";
export const chromeGold = "#c4a574";
export const stone = "#6B645B";

// Department signals: saturated UI colors for 4px rails, 2px rings, or chip borders
export const dept = {
  culinary: "#EA580C",
  suites: "#2563EB",
  banquets: "#16A34A",
  beverage: "#1E3A8A",
  concessions: "#DC2626",
  warehouse: "#475569",
} as const;

export type DepartmentCode =
  | "CULINARY"
  | "SUITES"
  | "BANQUETS"
  | "BEVERAGE"
  | "CONCESSIONS"
  | "WAREHOUSE"
  | string;

export const deptTint = (code?: string | null): string => {
  if (!code) return chromeGold;
  const upper = code.toUpperCase().trim();
  if (upper === "CULINARY" || upper === "KITCHEN") return dept.culinary;
  if (upper === "SUITES" || upper === "PREMIUM") return dept.suites;
  if (upper === "BANQUETS" || upper === "STAFFING" || upper === "CATERING") return dept.banquets;
  if (upper === "BEVERAGE" || upper === "BAR") return dept.beverage;
  if (upper === "CONCESSIONS" || upper === "86") return dept.concessions;
  if (upper === "WAREHOUSE" || upper === "PROCUREMENT") return dept.warehouse;
  return chromeGold;
};

// Status chips: full saturation, colored border + label
export const statusColors = {
  confirmed: "#16A34A",
  needs_review: "#D97706",
  in_service: "#EA580C",
  closed: "#475569",
  cancelled: "#475569",
  alert: "#DC2626",
} as const;

export const hairline = StyleSheet.hairlineWidth || 1;

type ThemeMode = "dark" | "light";

type AppearanceState = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
};

export const useAppearanceStore = create<AppearanceState>((set) => ({
  mode: "light",
  setMode: (mode) => set({ mode }),
  toggleMode: () =>
    set((state) => ({ mode: state.mode === "dark" ? "light" : "dark" })),
}));

export const designPalettes = {
  dark: {
    mode: "dark" as const,
    background: "#07111F",
    backgroundAlt: "#0C1A2E",
    surface: "#0F2138",
    surfaceStrong: "#132A45",
    surfaceSoft: "#183552",
    glass: "#0F2138",
    primary: "#5B9BD5",
    secondary: "#FF5A5A",
    charcoal: "#F5F7FA",
    muted: "#9AA8BC",
    border: "#2A3F5C",
    divider: "#1E3250",
    success: "#5B9BD5",
    danger: "#FF6B6B",
    warning: "#F0B429",
    info: "#7EB6E8",
    cream: "#132A45",
    glow: "#132A45",
    shadow: "#000000",
    buttonText: "#07111F",
  },
  light: {
    mode: "light" as const,
    background: surfaceIvory,
    backgroundAlt: "#FFFFFF",
    surface: surfaceIvory,
    surfaceStrong: "#FFFFFF",
    surfaceSoft: "#EAE3D6",
    glass: surfaceIvory,
    primary: chromeGold,
    secondary: dept.concessions,
    charcoal: ink,
    muted: stone,
    border: "#D8CFC0",
    divider: "#E5DDD0",
    success: dept.banquets,
    danger: dept.concessions,
    warning: statusColors.needs_review,
    info: dept.suites,
    cream: surfaceIvory,
    glow: "#EAE3D6",
    shadow: "#000000",
    buttonText: ink,
  },
} as const;

export type DesignPalette = (typeof designPalettes)[ThemeMode];

export const useDesignTheme = () => {
  const mode = useAppearanceStore((state) => state.mode);
  return designPalettes[mode];
};

export const colors = designPalettes.light;

export const authColors = {
  background: surfaceIvory,
  surface: "#FFFFFF",
  primary: chromeGold,
  text: ink,
  muted: stone,
  border: "#D8CFC0",
  danger: dept.concessions,
  success: dept.banquets,
  buttonText: ink,
  highlight: "#EAE3D6",
};

export const authInputProps = {
  outlineColor: authColors.border,
  activeOutlineColor: authColors.primary,
  textColor: authColors.text,
  placeholderTextColor: authColors.muted,
  style: { backgroundColor: authColors.surface },
};

// Screens index this list by fixed position (accents[0] .. accents[5]) for KPI
// tiles and callout cards, so it must keep at least six entries — a shorter
// list crashes those screens with "cannot read properties of undefined".
export const accents = [
  { bg: chromeGold, fg: ink, icon: chromeGold },
  { bg: dept.suites, fg: "#FFFFFF", icon: dept.suites },
  { bg: dept.culinary, fg: "#FFFFFF", icon: dept.culinary },
  { bg: dept.banquets, fg: "#FFFFFF", icon: dept.banquets },
  { bg: dept.concessions, fg: "#FFFFFF", icon: dept.concessions },
  { bg: stone, fg: "#FFFFFF", icon: stone },
];

/**
 * Palette for the stadium operations consoles (KDS, stand sheets, commissary,
 * runner and kiosk screens). Those run on wall-mounted kitchen displays and
 * back-of-house tablets, so they stay dark regardless of the app's light/dark
 * setting — but they were each hardcoding the same slate ramp inline, which
 * meant a dozen near-identical hex values and no single place to adjust them.
 */
export const opsConsole = {
  background: "#0F172A",
  surface: "#1E293B",
  border: "#334155",
  text: "#F8FAFC",
  textStrong: "#FFFFFF",
  muted: "#94A3B8",
  mutedDim: "#64748B",
  subtle: "#CBD5E1",
  accent: "#3B82F6",
  accentSoft: "#38BDF8",
  good: "#10B981",
  warn: "#F59E0B",
  danger: "#EF4444",
} as const;

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48, huge: 64,
};

export const radius = {
  sharp: 6, soft: 14, sm: 10, md: 14, lg: 18, xl: 24, pill: 999,
  control: 16, metric: 999,
};

// Loaded via useFonts() in app/_layout.tsx. These string literals must match
// the keys passed there exactly, or React Native silently falls back to the
// system font with no warning.
export const fontFamily = {
  display: "Fraunces_600SemiBold",
  displayItalic: "Fraunces_600SemiBold_Italic",
  displayMedium: "Fraunces_500Medium",
} as const;

export const type = {
  micro: { fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
  label: { fontSize: 13, lineHeight: 18, letterSpacing: 0.4 },
  subtitle: { fontSize: 14, lineHeight: 20, letterSpacing: 0.1 },
  body: { fontSize: 15, lineHeight: 22, letterSpacing: 0 },
  bodyLarge: { fontSize: 17, lineHeight: 24, letterSpacing: 0 },
  heading: { fontSize: 20, lineHeight: 26, letterSpacing: -0.2, fontWeight: "700" as const },
  title: { fontSize: 28, lineHeight: 34, letterSpacing: -0.4, fontWeight: "600" as const, fontFamily: fontFamily.display },
  display: { fontSize: 40, lineHeight: 44, letterSpacing: -0.6, fontWeight: "600" as const, fontFamily: fontFamily.display },
} as const;

export const shadow = {
  shadowColor: designPalettes.light.shadow,
  shadowOpacity: 0.08, shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 }, elevation: 3,
} as const;

export const shadowSoft = {
  shadowColor: designPalettes.light.shadow,
  shadowOpacity: 0.06, shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 }, elevation: 2,
} as const;

export const shadowFloat = {
  shadowColor: designPalettes.light.shadow,
  shadowOpacity: 0.12, shadowRadius: 24,
  shadowOffset: { width: 0, height: 10 }, elevation: 6,
} as const;

export const authCardStyle = {
  backgroundColor: "transparent", borderRadius: 16, borderWidth: 0, borderColor: "transparent",
} as const;

export const glass = {
  backgroundColor: "transparent", borderWidth: 0, borderColor: "transparent",
} as const;

export const makePaperTheme = (mode: ThemeMode) => {
  const palette = designPalettes[mode];
  const base = mode === "dark" ? MD3DarkTheme : MD3LightTheme;
  return {
    ...base,
    dark: mode === "dark",
    roundness: radius.control,
    colors: {
      ...base.colors,
      primary: palette.primary,
      onPrimary: palette.buttonText,
      secondary: palette.secondary,
      background: palette.background,
      surface: palette.surface,
      surfaceVariant: palette.surfaceSoft,
      onSurface: palette.charcoal,
      onBackground: palette.charcoal,
      outline: palette.border,
      error: palette.danger,
      elevation: {
        ...base.colors.elevation,
        level0: "transparent",
        level1: palette.surface,
        level2: palette.surfaceSoft,
      },
    },
  };
};

export const lightTheme = makePaperTheme("light");
export const darkTheme = makePaperTheme("dark");
