import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:venue_wrangler_prototype/main.dart';

void main() {
  const issues = [
    {
      'id': 'issue-1',
      'title': 'Concourse leak',
      'description': 'Water is pooling by the north entrance.',
      'state': 'REPORTED',
      'severity': 'HIGH',
      'category': 'Facilities',
      'createdAt': '2026-09-25T14:00:00.000Z',
    },
    {
      'id': 'issue-2',
      'title': 'Power outage',
      'description': 'The east service counter lost power.',
      'state': 'TRIAGED',
      'severity': 'CRITICAL',
      'category': 'Electrical',
      'createdAt': '2026-09-25T14:05:00.000Z',
    },
  ];

  Future<void> setViewport(WidgetTester tester, Size size) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = size;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }

  Widget buildWorkspace() => MaterialApp(
        home: Scaffold(
          body: ResponsiveIssueWorkspace(
            issues: issues
                .map((issue) => Map<String, dynamic>.from(issue))
                .toList(),
            capabilities: const {'issue:triage', 'issue:resolve'},
            canAssign: true,
            onAction: (_, __) {},
            onEvidence: (_) {},
          ),
        ),
      );

  testWidgets('desktop issues open in a selectable split list and detail view',
      (tester) async {
    await setViewport(tester, const Size(1440, 900));
    await tester.pumpWidget(buildWorkspace());

    expect(
        find.byKey(const ValueKey('issue-desktop-split-view')), findsOneWidget);
    expect(find.byKey(const ValueKey('issue-detail-issue-1')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('issue-row-issue-2')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('issue-detail-issue-2')), findsOneWidget);

    await tester.enterText(
        find.byKey(const ValueKey('issue-search')), 'north entrance');
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('issue-detail-issue-1')), findsOneWidget);
    expect(find.byKey(const ValueKey('issue-row-issue-2')), findsNothing);
  });

  testWidgets('phone keeps the issue cards in a single-column workflow',
      (tester) async {
    await setViewport(tester, const Size(390, 844));
    await tester.pumpWidget(buildWorkspace());

    expect(find.byKey(const ValueKey('issue-mobile-list')), findsOneWidget);
    expect(
        find.byKey(const ValueKey('issue-desktop-split-view')), findsNothing);
    expect(find.text('Concourse leak'), findsOneWidget);
  });
}
