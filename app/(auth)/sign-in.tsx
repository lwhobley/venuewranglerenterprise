import { useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Button, Text, TextInput } from "react-native-paper";
import { appApi } from "../../lib/api-client";
import { authColors, fontFamily, radius, type } from "../../lib/theme";
import { useAuthStore, type AuthState } from "../../lib/auth-store";

const logoSource = require("../../assets/stadium-wrangler-logo-icon.png");
const midnight = "#0A1B2A";
const teal = "#1C7C82";
const warmWhite = "#FCFAF6";

const highlights = [
  { icon: "stadium-variant", label: "Venue-wide command" },
  { icon: "shield-check-outline", label: "Role-secure access" },
  { icon: "lightning-bolt-outline", label: "Live event intelligence" },
] as const;

export default function SignInScreen() {
  const setSession = useAuthStore((state: AuthState) => state.setSession);
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  const submit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes("@") || !/^\d{6}$/.test(pin)) {
      const message = "Enter the email assigned by your administrator and your six-digit access PIN.";
      setFormError(message);
      Alert.alert("Check your access details", message);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      clearSession();
      const { profile, venue, token } = await appApi.pinAuth({ email: normalizedEmail, pin, flow: "signIn" });
      setSession({
        user: {
          id: profile._id, email: profile.email, full_name: profile.fullName,
          email_verified: profile.emailVerified === true, role: profile.role,
          job_title: profile.jobTitle, venue_id: profile.venueId ?? null,
          all_access: profile.allAccess === true,
        },
        venue: venue ? {
          id: venue._id, name: venue.name, latitude: venue.latitude,
          longitude: venue.longitude, geofence_radius_m: venue.geofenceRadiusM,
        } : null,
        token,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(venue ? "/(tabs)/home" : "/(auth)/no-venue");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sign in. Please try again.";
      setFormError(message);
      Alert.alert("Sign in failed", message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.page}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={[styles.content, !isWide && styles.contentCompact]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={[styles.shell, !isWide && styles.shellCompact]}>
            <View style={[styles.story, !isWide && styles.storyCompact]}>
              <View style={styles.orbLarge} />
              <View style={styles.orbSmall} />
              <View style={styles.gridLineOne} />
              <View style={styles.gridLineTwo} />
              <View style={styles.storyTop}>
                <View style={styles.brandMark}>
                  <MaterialCommunityIcons name="compass-rose" size={20} color={authColors.primary} />
                </View>
                <View>
                  <Text style={styles.brandName}>VENUE WRANGLER</Text>
                  <Text style={styles.brandEdition}>ENTERPRISE</Text>
                </View>
              </View>
              <View style={[styles.storyCopy, !isWide && styles.storyCopyCompact]}>
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>OPERATIONS ONLINE</Text>
                </View>
                <Text style={[styles.storyTitle, !isWide && styles.storyTitleCompact]}>
                  Run the room.{"\n"}<Text style={styles.storyTitleAccent}>Own the moment.</Text>
                </Text>
                {isWide ? <Text style={styles.storyBody}>One beautifully orchestrated command layer for every suite, stand, kitchen, roster, and event-day decision.</Text> : null}
              </View>
              {isWide ? <View style={styles.highlights}>
                {highlights.map((item) => <View key={item.label} style={styles.highlightRow}>
                  <View style={styles.highlightIcon}><MaterialCommunityIcons name={item.icon} size={16} color="#CDB07B" /></View>
                  <Text style={styles.highlightLabel}>{item.label}</Text>
                </View>)}
              </View> : null}
            </View>

            <View style={[styles.formPanel, !isWide && styles.formPanelCompact]}>
              <View style={styles.formInner}>
                <Image source={logoSource} style={styles.logo} />
                <View style={styles.headingGroup}>
                  <Text style={styles.eyebrow}>PRIVATE COMMAND ACCESS</Text>
                  <Text style={styles.heading}>Welcome back.</Text>
                  <Text style={styles.subtitle}>Sign in with the credentials assigned by your venue administrator.</Text>
                </View>
                <View style={styles.form}>
                  {formError ? <View style={styles.errorPanel}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={18} color={authColors.danger} />
                    <Text selectable style={styles.error}>{formError}</Text>
                  </View> : null}
                  <TextInput label="Administrator email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" mode="outlined" left={<TextInput.Icon icon="email-outline" color={authColors.muted} />} outlineColor={authColors.border} activeOutlineColor={teal} textColor={authColors.text} placeholderTextColor={authColors.muted} style={styles.input} outlineStyle={styles.inputOutline} />
                  <TextInput label="Six-digit administrator PIN" value={pin} onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" secureTextEntry maxLength={6} mode="outlined" left={<TextInput.Icon icon="lock-outline" color={authColors.muted} />} outlineColor={authColors.border} activeOutlineColor={teal} textColor={authColors.text} style={styles.input} outlineStyle={styles.inputOutline} />
                  <Button mode="contained" buttonColor={midnight} textColor="#FFFFFF" loading={submitting} disabled={submitting} onPress={() => void submit()} style={styles.submitBtn} contentStyle={styles.submitContent} labelStyle={styles.submitLabel} icon="arrow-right">
                    Enter command center
                  </Button>
                </View>
                <View style={styles.securityNote}>
                  <MaterialCommunityIcons name="shield-lock-outline" size={17} color={teal} />
                  <Text style={styles.securityText}>Encrypted access · Monitored enterprise session</Text>
                </View>
                <Text selectable style={styles.help}>Need access or a new PIN? Contact your venue owner.</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: "#E9E3D9" },
  content: { flexGrow: 1, justifyContent: "center", padding: 32 },
  contentCompact: { padding: 0, justifyContent: "flex-start" },
  shell: { width: "100%", maxWidth: 1180, minHeight: 720, alignSelf: "center", flexDirection: "row", borderRadius: 30, overflow: "hidden", backgroundColor: warmWhite, shadowColor: "#06111B", shadowOpacity: 0.18, shadowRadius: 42, shadowOffset: { width: 0, height: 24 }, elevation: 12 },
  shellCompact: { minHeight: "100%", flexDirection: "column", borderRadius: 0 },
  story: { width: "48%", minHeight: 720, backgroundColor: midnight, padding: 48, justifyContent: "space-between", overflow: "hidden" },
  storyCompact: { width: "100%", minHeight: 286, padding: 24 },
  orbLarge: { position: "absolute", width: 430, height: 430, borderRadius: 215, right: -180, top: 90, backgroundColor: "rgba(35, 143, 148, 0.22)", borderWidth: 1, borderColor: "rgba(119, 217, 214, 0.20)" },
  orbSmall: { position: "absolute", width: 210, height: 210, borderRadius: 105, left: -92, bottom: -36, backgroundColor: "rgba(205, 176, 123, 0.10)", borderWidth: 1, borderColor: "rgba(205, 176, 123, 0.24)" },
  gridLineOne: { position: "absolute", width: 760, height: 1, backgroundColor: "rgba(255,255,255,0.07)", transform: [{ rotate: "-38deg" }], left: -130, top: 340 },
  gridLineTwo: { position: "absolute", width: 760, height: 1, backgroundColor: "rgba(255,255,255,0.05)", transform: [{ rotate: "-38deg" }], left: -80, top: 410 },
  storyTop: { flexDirection: "row", alignItems: "center", gap: 12, zIndex: 1 },
  brandMark: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  brandName: { color: "#FFFFFF", fontSize: 13, lineHeight: 16, letterSpacing: 1.8, fontWeight: "800" },
  brandEdition: { color: "#CDB07B", fontSize: 10, lineHeight: 14, letterSpacing: 2.5, fontWeight: "800" },
  storyCopy: { gap: 20, zIndex: 1, marginVertical: 28 },
  storyCopyCompact: { gap: 12, marginVertical: 24 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.08)" },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#5BD4A8" },
  liveText: { color: "#D8E8E6", fontSize: 10, letterSpacing: 1.3, fontWeight: "800" },
  storyTitle: { color: "#FFFFFF", fontFamily: fontFamily.display, fontSize: 50, lineHeight: 57, letterSpacing: -1.2 },
  storyTitleCompact: { fontSize: 35, lineHeight: 39, letterSpacing: -0.6 },
  storyTitleAccent: { color: "#D8BE8C", fontFamily: fontFamily.display },
  storyBody: { color: "#B7C5CE", fontSize: 16, lineHeight: 25, maxWidth: 410 },
  highlights: { gap: 15, zIndex: 1 },
  highlightRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  highlightIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(205, 176, 123, 0.10)" },
  highlightLabel: { color: "#D9E0E5", fontSize: 13, fontWeight: "600", letterSpacing: 0.2 },
  formPanel: { flex: 1, backgroundColor: warmWhite, alignItems: "center", justifyContent: "center", padding: 56 },
  formPanelCompact: { paddingHorizontal: 24, paddingVertical: 38 },
  formInner: { width: "100%", maxWidth: 420, alignItems: "stretch" },
  logo: { width: 74, height: 74, borderRadius: 19, resizeMode: "cover", marginBottom: 30 },
  headingGroup: { gap: 8, marginBottom: 30 },
  eyebrow: { color: teal, fontSize: 11, lineHeight: 15, letterSpacing: 1.6, fontWeight: "800" },
  heading: { ...type.display, color: midnight, fontSize: 42, lineHeight: 48 },
  subtitle: { color: authColors.muted, fontSize: 15, lineHeight: 23, maxWidth: 380 },
  form: { gap: 14 },
  input: { backgroundColor: "#FFFFFF", height: 56 },
  inputOutline: { borderRadius: 14 },
  submitBtn: { borderRadius: 14, marginTop: 4 },
  submitContent: { height: 56, flexDirection: "row-reverse" },
  submitLabel: { fontSize: 14, fontWeight: "800", letterSpacing: 0.2 },
  errorPanel: { flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 12, borderRadius: 12, backgroundColor: "#FFF1EF", borderWidth: StyleSheet.hairlineWidth, borderColor: "#F1C2BC" },
  error: { flex: 1, color: authColors.danger, fontSize: 13, lineHeight: 18 },
  securityNote: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "center", marginTop: 24 },
  securityText: { color: "#607069", fontSize: 11, fontWeight: "600" },
  help: { color: authColors.muted, fontSize: 12, textAlign: "center", marginTop: 14 },
});

export { RouteErrorBoundary as ErrorBoundary } from "../../components/ErrorBoundary";
