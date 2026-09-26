import 'package:flutter_test/flutter_test.dart';
import 'package:venue_wrangler_prototype/features/operations/venue_wall_time.dart';

void main() {
  test('keeps picker wall-clock components without a device offset', () {
    final wall = DateTime.utc(2027, 1, 1, 20, 0);
    expect(venueWallTime(wall), '2027-01-01T20:00');
    expect(venueWallCarrier('2027-01-01T20:00'), wall);
    expect(venueWallLabel('2027-01-01T20:00', 'America/Chicago'),
        'Jan 1, 2027 · 8:00 PM · America/Chicago');
  });

  test('preserves a venue time that is missing in the device time zone', () {
    final wall = venueWallDate(2026, 3, 8, 2, 30);
    expect(wall.isUtc, isTrue);
    expect(venueWallTime(wall), '2026-03-08T02:30');
    expect(venueWallCarrier('2026-03-08T02:30'), wall);
  });
}
