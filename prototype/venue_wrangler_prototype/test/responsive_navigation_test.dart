import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:venue_wrangler_prototype/main.dart';

void main() {
  const tabs = ['Today', 'Issues', 'Staffing', 'Hospitality', 'Stock'];

  Future<void> setViewport(WidgetTester tester, Size size) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = size;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }

  testWidgets('tablet rail keeps destinations visible and selects a workflow',
      (tester) async {
    await setViewport(tester, const Size(800, 600));
    String? selected;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ResponsiveWorkspaceNavigation(
          tabs: tabs,
          selectedTab: 0,
          desktop: false,
          onSelect: (tab) => selected = tab,
        ),
      ),
    ));

    expect(find.text('Today'), findsOneWidget);
    expect(find.text('Hospitality'), findsOneWidget);
    await tester.tap(find.text('Staffing'));
    expect(selected, 'Staffing');
  });

  testWidgets('phone navigation keeps overflow workflows reachable',
      (tester) async {
    await setViewport(tester, const Size(390, 844));
    String? selected;
    var openedMore = false;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: const Center(child: Text('Event work')),
        bottomNavigationBar: ResponsiveMobileNavigation(
          primaryTabs: const ['Today', 'Issues', 'Staffing', 'Operations'],
          selectedTab: 'Hospitality',
          hasMore: true,
          onSelect: (tab) => selected = tab,
          onMore: () => openedMore = true,
        ),
      ),
    ));

    expect(find.text('More'), findsOneWidget);
    expect(tester.getSemantics(find.text('More')), isNotNull);
    await tester.tap(find.text('More'));
    expect(openedMore, isTrue);
    await tester.tap(find.text('Issues'));
    expect(selected, 'Issues');
  });

  testWidgets('desktop navigation presents a persistent labeled sidebar',
      (tester) async {
    await setViewport(tester, const Size(1280, 800));
    String? selected;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ResponsiveWorkspaceNavigation(
          tabs: tabs,
          selectedTab: 2,
          desktop: true,
          onSelect: (tab) => selected = tab,
        ),
      ),
    ));

    expect(find.text('Today'), findsOneWidget);
    expect(find.text('Stock'), findsOneWidget);
    await tester.tap(find.text('Hospitality'));
    expect(selected, 'Hospitality');
  });
}
