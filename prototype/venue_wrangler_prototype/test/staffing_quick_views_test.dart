import 'package:flutter_test/flutter_test.dart';
import 'package:venue_wrangler_prototype/main.dart';

void main() {
  final shifts = <Map<String, dynamic>>[
    {
      'id': 'mine',
      'state': 'PUBLISHED',
      'assignedSubject': 'worker-1',
      'response': 'ACKNOWLEDGED',
      'revision': 2,
      'responseRevision': 2,
      'attendanceClaims': <Object>[],
    },
    {
      'id': 'open',
      'state': 'PUBLISHED',
      'assignedSubject': null,
      'attendanceClaims': <Object>[],
    },
    {
      'id': 'draft',
      'state': 'DRAFT',
      'assignedSubject': null,
      'attendanceClaims': <Object>[],
    },
    {
      'id': 'awaiting-response',
      'state': 'PUBLISHED',
      'assignedSubject': 'worker-2',
      'response': 'PENDING',
      'revision': 1,
      'responseRevision': 1,
      'attendanceClaims': <Object>[],
    },
    {
      'id': 'attendance-review',
      'state': 'PUBLISHED',
      'assignedSubject': 'worker-2',
      'response': 'ACKNOWLEDGED',
      'revision': 1,
      'responseRevision': 1,
      'attendanceClaims': <Object>[
        {'id': 'claim-1'},
      ],
    },
  ];

  test('worker views show only published open shifts and their own shifts', () {
    expect(
      filterStaffingShifts(shifts,
              view: 'OPEN', subject: 'worker-1', canWrite: false)
          .map((shift) => shift['id']),
      ['open'],
    );
    expect(
      filterStaffingShifts(shifts,
              view: 'MINE', subject: 'worker-1', canWrite: false)
          .map((shift) => shift['id']),
      ['mine'],
    );
    expect(
      filterStaffingShifts(shifts,
              view: 'NEEDS_ACTION', subject: 'worker-1', canWrite: false)
          .map((shift) => shift['id']),
      ['open'],
    );
  });

  test(
      'manager needs-action view includes drafts, responses, and attendance review',
      () {
    expect(
      filterStaffingShifts(shifts,
              view: 'NEEDS_ACTION', subject: 'manager', canWrite: true)
          .map((shift) => shift['id']),
      ['open', 'draft', 'awaiting-response', 'attendance-review'],
    );
  });
}
