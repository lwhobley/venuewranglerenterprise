import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:venue_wrangler_prototype/features/operations/workspace_command_palette.dart';

void main() {
  testWidgets('Ctrl+K opens the capability-scoped workflow palette',
      (tester) async {
    var opened = 0;
    await tester.pumpWidget(MaterialApp(
      home: WorkspaceCommandShortcuts(
        onOpen: () => opened++,
        child: const Scaffold(body: Text('Operations')),
      ),
    ));

    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyDownEvent(LogicalKeyboardKey.keyK);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.keyK);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);

    expect(opened, 1);
  });

  testWidgets('palette filters and returns a selected available workflow',
      (tester) async {
    String? selected;
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () async {
              selected = await showDialog<String>(
                context: context,
                builder: (_) => const WorkspaceCommandPaletteDialog(
                  tabs: ['Today', 'Stock', 'Setup'],
                ),
              );
            },
            child: const Text('Open palette'),
          ),
        ),
      ),
    ));

    await tester.tap(find.text('Open palette'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'sto');
    await tester.pumpAndSettle();

    expect(find.text('Today'), findsNothing);
    expect(find.text('Setup'), findsNothing);
    expect(find.text('Stock'), findsOneWidget);
    await tester.tap(find.text('Stock'));
    await tester.pumpAndSettle();

    expect(selected, 'Stock');
  });
}
