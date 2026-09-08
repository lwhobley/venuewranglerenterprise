import { Injectable } from '@nestjs/common';
import { zonedIsoDate } from '../../../common/venue-time';
import { PrismaService } from '../../../prisma/prisma.service';

export type WranglerHistoricalPattern = { id: string; title: string; detail: string; confidence: 'emerging' };

@Injectable()
export class WranglerHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getPatterns(args: { venueId: string; timezone?: string | null; nowMs: number; todayCovers: number; todayReservations: number }): Promise<WranglerHistoricalPattern[]> {
    const lookbackStart = new Date(args.nowMs - 35 * 24 * 60 * 60_000);
    const today = zonedIsoDate(args.timezone, args.nowMs);
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const [reservations, checks, punches] = await Promise.all([
      this.prisma.reservation.findMany({ where: { venueId: args.venueId, reservationTime: { gte: lookbackStart, lt: new Date(args.nowMs) } }, select: { reservationTime: true, partySize: true, status: true }, orderBy: { reservationTime: 'desc' }, take: 2000 }),
      this.prisma.posCheck.findMany({ where: { venueId: args.venueId, openedAt: { gte: lookbackStart, lt: new Date(args.nowMs) }, status: 'paid' }, select: { openedAt: true, totalCents: true, guestCount: true }, orderBy: { openedAt: 'desc' }, take: 5000 }),
      this.prisma.posLaborPunch.findMany({ where: { venueId: args.venueId, clockInAt: { gte: lookbackStart, lt: new Date(args.nowMs) } }, select: { businessDate: true, totalPayCents: true, regularMinutes: true, overtimeMinutes: true }, orderBy: { clockInAt: 'desc' }, take: 5000 }),
    ]);
    const serviceDates = new Map<string, { reservations: number; covers: number; noShows: number; salesCents: number; laborCents: number }>();
    const get = (date: string) => { const current = serviceDates.get(date) ?? { reservations: 0, covers: 0, noShows: 0, salesCents: 0, laborCents: 0 }; serviceDates.set(date, current); return current; };
    for (const reservation of reservations) { const date = zonedIsoDate(args.timezone, reservation.reservationTime.getTime()); if (date === today || new Date(`${date}T12:00:00Z`).getUTCDay() !== weekday) continue; const row = get(date); row.reservations += 1; if (reservation.status === 'no_show') row.noShows += 1; if (!['cancelled', 'no_show'].includes(reservation.status)) row.covers += reservation.partySize; }
    for (const check of checks) { const date = zonedIsoDate(args.timezone, check.openedAt.getTime()); if (date === today || new Date(`${date}T12:00:00Z`).getUTCDay() !== weekday) continue; get(date).salesCents += check.totalCents; }
    for (const punch of punches) { const date = punch.businessDate; if (date === today || new Date(`${date}T12:00:00Z`).getUTCDay() !== weekday) continue; get(date).laborCents += punch.totalPayCents ?? 0; }
    const samples = [...serviceDates.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 4).map(([, value]) => value);
    if (samples.length < 2) return [];
    const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
    const avgCovers = avg(samples.map((row) => row.covers));
    const avgReservations = avg(samples.map((row) => row.reservations));
    const salesSamples = samples.filter((row) => row.salesCents > 0);
    const avgSales = salesSamples.length ? avg(salesSamples.map((row) => row.salesCents)) : 0;
    // Labor as a percent of sales is only meaningful over days that have BOTH
    // figures. Averaging labor over one day set and sales over another (a day
    // whose POS totals have not posted yet has labor but zero sales) produces a
    // ratio that matches no actual day and overstates labor.
    const laborPctSamples = samples.filter((row) => row.salesCents > 0 && row.laborCents > 0);
    const avgLaborPct = laborPctSamples.length
      ? (avg(laborPctSamples.map((row) => row.laborCents)) / avg(laborPctSamples.map((row) => row.salesCents))) * 100
      : 0;
    const totalReservations = samples.reduce((sum, row) => sum + row.reservations, 0);
    const noShowRate = totalReservations ? (samples.reduce((sum, row) => sum + row.noShows, 0) / totalReservations) * 100 : 0;
    const patterns: WranglerHistoricalPattern[] = [];
    if (avgCovers >= 1 && args.todayCovers >= avgCovers * 1.15) patterns.push({ id: 'history-demand-up', title: 'Demand running above pattern', detail: `Today is tracking ${Math.round(((args.todayCovers / avgCovers) - 1) * 100)}% above the last ${samples.length} comparable service days by booked covers.`, confidence: 'emerging' });
    else if (avgCovers >= 1 && args.todayCovers <= avgCovers * 0.85) patterns.push({ id: 'history-demand-down', title: 'Demand running below pattern', detail: `Today is tracking ${Math.round((1 - (args.todayCovers / avgCovers)) * 100)}% below the last ${samples.length} comparable service days by booked covers.`, confidence: 'emerging' });
    if (avgReservations >= 1 && args.todayReservations > avgReservations * 1.2) patterns.push({ id: 'history-reservation-wave', title: 'Heavier reservation load', detail: `${args.todayReservations} reservations are on the books versus a ${avgReservations.toFixed(1)}-reservation average on comparable days.`, confidence: 'emerging' });
    if (noShowRate >= 8) patterns.push({ id: 'history-no-show', title: 'Recurring no-show exposure', detail: `Comparable recent service days are averaging a ${noShowRate.toFixed(1)}% no-show rate. Consider confirmation or deposit follow-up for high-value arrivals.`, confidence: 'emerging' });
    if (avgSales > 0) patterns.push({ id: 'history-sales-baseline', title: 'Comparable-day sales baseline', detail: `The last ${salesSamples.length} comparable service days averaged $${Math.round(avgSales / 100).toLocaleString()} in POS sales${avgLaborPct > 0 ? ` with labor near ${avgLaborPct.toFixed(1)}% of sales` : ''}.`, confidence: 'emerging' });
    return patterns.slice(0, 3);
  }
}
