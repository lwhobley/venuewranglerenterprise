import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:venue_wrangler_prototype/features/issues/issue_outbox.dart';
import 'package:venue_wrangler_prototype/main.dart';

void main() {
  testWidgets('reports an issue and keeps it visible as pending sync',
      (tester) async {
    final outbox = _FakeIssueOutbox();
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        issueSyncProvider.overrideWith(
          (ref) => IssueSyncController(outbox, _FakeIssueApi())..restore(),
        ),
      ],
      child: MediaQuery(
        data: MediaQueryData(textScaler: TextScaler.linear(2)),
        child: const VenueWranglerPrototype(),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('HARBOR CITY ARENA'), findsOneWidget);
    await tester.tap(find.text('Report issue'));
    await tester.pumpAndSettle();

    final titleField = find.widgetWithText(TextField, 'What is happening?');
    final detailsField = find.widgetWithText(TextField, 'Details');
    expect(find.bySemanticsLabel(RegExp('What is happening')), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp('Location')), findsOneWidget);
    final locationFocusFinder = find.byWidgetPredicate((widget) =>
        widget is Focus && widget.focusNode?.debugLabel == 'issue-location');
    final locationFocus = tester.widget<Focus>(locationFocusFinder).focusNode!;
    await tester.tap(titleField);
    await tester.testTextInput.receiveAction(TextInputAction.next);
    await tester.pump();
    expect(locationFocus.hasFocus, isTrue,
        reason:
            'Next on the title field should move keyboard focus to Location.');
    await tester.enterText(titleField, 'Ice machine stopped');
    await tester.enterText(
        detailsField, 'The east bar ice machine has stopped.');
    expect(tester.widget<TextField>(titleField).controller?.text,
        'Ice machine stopped');
    expect(tester.widget<TextField>(detailsField).controller?.text,
        'The east bar ice machine has stopped.');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    tester.testTextInput.hide();
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Submit issue'));
    await tester.tap(find.text('Submit issue'));
    await tester.pumpAndSettle();

    expect(outbox.items, hasLength(1));
    await tester.pump(const Duration(seconds: 6));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Your issue reports'), 240,
        scrollable: find.byType(Scrollable).first);
    expect(find.text('Your issue reports'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Ice machine stopped'), 240,
        scrollable: find.byType(Scrollable).first);
    expect(find.text('Ice machine stopped'), findsOneWidget);
    expect(find.text('PENDING SYNC'), findsOneWidget);
    final pendingStatus = find.bySemanticsLabel('PENDING SYNC');
    expect(
        tester
            .getSemantics(pendingStatus)
            .getSemanticsData()
            .flagsCollection
            .isLiveRegion,
        isTrue);
    expect(outbox.items, hasLength(1));
    semantics.dispose();
  });
}

class _FakeIssueOutbox implements IssueOutbox {
  final List<PendingIssueReport> items = [];

  @override
  Future<void> enqueue(PendingIssueReport command) async {
    items.add(command);
  }

  @override
  Future<List<PendingIssueReport>> pending() async => List.unmodifiable(items);

  @override
  Future<void> markAccepted(String idempotencyKey) async {
    items.removeWhere((item) => item.idempotencyKey == idempotencyKey);
  }

  @override
  Future<void> markFailed(String idempotencyKey) async {}
}

class _FakeIssueApi implements IssueApi {
  @override
  Future<void> create(PendingIssueReport command) async {}
}
