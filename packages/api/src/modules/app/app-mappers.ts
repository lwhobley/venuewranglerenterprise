// Response mappers and pure formatting helpers for the /v1/app routes.
//
// IMPORTANT: these intentionally emit BOTH camelCase and snake_case keys. The
// Expo client reads both shapes across screens, so the dual keys are part of
// the API contract — do not "clean them up" to one casing. This is distinct
// from common/mappers.ts, which serves the newer leaner /v1/* module routes.
import { Role } from '@prisma/client';

export function toMs(date: Date | null | undefined) {
  return date ? date.getTime() : null;
}

export function minutesToTime(total: number) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

export function dayLabel(dayIndex: number) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayIndex] ?? 'Day';
}

export function mapVenue(venue: { id: string; name: string; latitude: number; longitude: number; geofenceRadiusM: number }) {
  return {
    _id: venue.id,
    id: venue.id,
    name: venue.name,
    latitude: venue.latitude,
    longitude: venue.longitude,
    geofenceRadiusM: venue.geofenceRadiusM,
    geofence_radius_m: venue.geofenceRadiusM,
  };
}

export function mapProfile(
  profile: { id: string; email: string; fullName: string; role: Role; jobTitle: string; venueId: string | null; allAccess: boolean; trialEndsAt?: Date | null; phone?: string | null; altPhone?: string | null; address?: string | null; dateOfBirth?: Date | null; certifications?: string[]; sickHoursAccrued?: number; ptoHoursAccrued?: number },
  emailVerified = false,
) {
  return {
    _id: profile.id,
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    full_name: profile.fullName,
    emailVerified,
    email_verified: emailVerified,
    role: profile.role,
    jobTitle: profile.jobTitle,
    job_title: profile.jobTitle,
    venueId: profile.venueId,
    venue_id: profile.venueId,
    allAccess: profile.allAccess,
    all_access: profile.allAccess,
    trialEndsAt: profile.trialEndsAt?.getTime() ?? null,
    phone: profile.phone ?? null,
    altPhone: profile.altPhone ?? null,
    address: profile.address ?? null,
    dateOfBirth: profile.dateOfBirth?.toISOString() ?? null,
    certifications: profile.certifications ?? [],
    sickHoursAccrued: profile.sickHoursAccrued ?? 0,
    ptoHoursAccrued: profile.ptoHoursAccrued ?? 0,
  };
}

export function mapClockEntry(
  entry: {
    id: string;
    profileId: string | null;
    profileFullName?: string | null;
    venueId: string;
    clockInAt: Date;
    clockOutAt: Date | null;
    clockInLat: number;
    clockInLng: number;
    clockInAccuracyM: number;
    clockInMocked: boolean;
    clockOutLat: number | null;
    clockOutLng: number | null;
    clockOutAccuracyM: number | null;
    clockOutMocked: boolean | null;
    isOpen: boolean;
    breaks?: any;
  },
  // Null when the staff member deleted their account; wage records are
  // retained with a snapshotted name (entry.profileFullName).
  profile: { fullName: string; role: Role; jobTitle: string } | null,
  venue: { name: string },
) {
  const memberName = profile?.fullName ?? entry.profileFullName ?? 'Former staff';
  const role = profile?.role ?? 'staff';
  const jobTitle = profile?.jobTitle ?? 'Former staff';
  return {
    _id: entry.id,
    id: entry.id,
    memberId: entry.profileId,
    member_id: entry.profileId,
    memberName,
    member_name: memberName,
    role,
    jobTitle,
    job_title: jobTitle,
    venueId: entry.venueId,
    venue_id: entry.venueId,
    venueName: venue.name,
    venue_name: venue.name,
    clockInAt: entry.clockInAt.getTime(),
    clock_in_at: entry.clockInAt.getTime(),
    clockOutAt: toMs(entry.clockOutAt),
    clock_out_at: toMs(entry.clockOutAt),
    clockInLat: entry.clockInLat,
    clock_in_lat: entry.clockInLat,
    clockInLng: entry.clockInLng,
    clock_in_lng: entry.clockInLng,
    clockInAccuracyM: entry.clockInAccuracyM,
    clock_in_accuracy_m: entry.clockInAccuracyM,
    clockInMocked: entry.clockInMocked,
    clock_in_mocked: entry.clockInMocked,
    clockOutLat: entry.clockOutLat,
    clock_out_lat: entry.clockOutLat,
    clockOutLng: entry.clockOutLng,
    clock_out_lng: entry.clockOutLng,
    clockOutAccuracyM: entry.clockOutAccuracyM,
    clock_out_accuracy_m: entry.clockOutAccuracyM,
    clockOutMocked: entry.clockOutMocked,
    clock_out_mocked: entry.clockOutMocked,
    isOpen: entry.isOpen,
    is_open: entry.isOpen,
    breaks: entry.breaks ?? null,
  };
}
