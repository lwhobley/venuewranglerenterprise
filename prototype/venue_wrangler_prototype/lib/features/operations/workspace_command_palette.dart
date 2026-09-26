import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class WorkspaceCommandShortcuts extends StatelessWidget {
  const WorkspaceCommandShortcuts({
    required this.onOpen,
    required this.child,
    super.key,
  });

  final VoidCallback onOpen;
  final Widget child;

  @override
  Widget build(BuildContext context) => CallbackShortcuts(
        bindings: {
          const SingleActivator(LogicalKeyboardKey.keyK, control: true): onOpen,
          const SingleActivator(LogicalKeyboardKey.keyK, meta: true): onOpen,
        },
        child: Focus(autofocus: true, child: child),
      );
}

class WorkspaceCommandPaletteDialog extends StatefulWidget {
  const WorkspaceCommandPaletteDialog({required this.tabs, super.key});

  final List<String> tabs;

  @override
  State<WorkspaceCommandPaletteDialog> createState() =>
      _WorkspaceCommandPaletteDialogState();
}

class _WorkspaceCommandPaletteDialogState
    extends State<WorkspaceCommandPaletteDialog> {
  String _query = '';

  static const _icons = <String, IconData>{
    'Today': Icons.today_outlined,
    'Issues': Icons.report_problem_outlined,
    'Operations': Icons.checklist_outlined,
    'Hospitality': Icons.room_service_outlined,
    'Stock': Icons.inventory_2_outlined,
    'Staffing': Icons.badge_outlined,
    'Vendors': Icons.handshake_outlined,
    'Closeout': Icons.fact_check_outlined,
    'Setup': Icons.tune_outlined,
  };

  @override
  Widget build(BuildContext context) {
    final normalizedQuery = _query.trim().toLowerCase();
    final matches = widget.tabs
        .where((tab) => tab.toLowerCase().contains(normalizedQuery))
        .toList();
    final width =
        (MediaQuery.sizeOf(context).width - 80).clamp(0, 420).toDouble();
    return AlertDialog(
      title: const Text('Go to workflow'),
      content: SizedBox(
        width: width,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              autofocus: true,
              onChanged: (value) => setState(() => _query = value),
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Search available workflows',
              ),
            ),
            const SizedBox(height: 8),
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 360),
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final tab in matches)
                    ListTile(
                      leading: Icon(_icons[tab] ?? Icons.dashboard_outlined),
                      title: Text(tab),
                      trailing: const Icon(Icons.keyboard_return),
                      onTap: () => Navigator.pop(context, tab),
                    ),
                  if (matches.isEmpty)
                    const ListTile(title: Text('No matching workflow')),
                ],
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Close'),
        ),
      ],
    );
  }
}
