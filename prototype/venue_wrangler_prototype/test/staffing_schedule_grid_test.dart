import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:venue_wrangler_prototype/features/operations/operations_api.dart';
import 'package:venue_wrangler_prototype/features/operations/staffing_schedule_grid.dart';

void main() {
  testWidgets('arrow keys move the focused shift and space selects it',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: StaffingScheduleGrid(
          api: _UnusedApi(),
          eventId: 'event-1',
          shifts: const [
            {'id': 'shift-1', 'role': 'Usher', 'startsAt': '2027-01-01T20:00:00.000Z', 'state': 'DRAFT', 'attendance': 'NOT_STARTED'},
            {'id': 'shift-2', 'role': 'Lead', 'startsAt': '2027-01-01T21:00:00.000Z', 'state': 'DRAFT', 'attendance': 'NOT_STARTED'},
          ],
          locations: const [],
          serviceAreas: const [],
          people: const [],
          canWrite: true,
          canShare: false,
          savedViews: const [],
          onChanged: () {},
        ),
      ),
    ));

    expect(find.text('Focused shift 1 of 2: Usher'), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();
    expect(find.text('Focused shift 2 of 2: Lead'), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    await tester.pump();
    expect(find.text('1 selected · Actions'), findsOneWidget);
  });

  test('marks overlapping assigned shifts and ignores cancelled or open slots', () {
    expect(overlappingShiftIds(const [
      {'id': 'a', 'assignedSubject': 'worker-1', 'state': 'PUBLISHED', 'startsAt': '2027-01-01T18:00:00.000Z', 'endsAt': '2027-01-01T22:00:00.000Z'},
      {'id': 'b', 'assignedSubject': 'worker-1', 'state': 'DRAFT', 'startsAt': '2027-01-01T21:00:00.000Z', 'endsAt': '2027-01-02T01:00:00.000Z'},
      {'id': 'c', 'assignedSubject': 'worker-1', 'state': 'CANCELLED', 'startsAt': '2027-01-01T18:00:00.000Z', 'endsAt': '2027-01-01T22:00:00.000Z'},
      {'id': 'd', 'assignedSubject': null, 'state': 'PUBLISHED', 'startsAt': '2027-01-01T18:00:00.000Z', 'endsAt': '2027-01-01T22:00:00.000Z'},
    ]), {'a', 'b'});
  });
}

class _UnusedApi implements OperationsApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}
