import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'operations_api.dart';

class EventCloseoutPage extends ConsumerWidget {
  const EventCloseoutPage({
    super.key,
    required this.event,
    required this.people,
    required this.availableTabs,
    required this.onOpenWorkflow,
  });
  final Map<String, dynamic> event;
  final List<Map<String, dynamic>> people;
  final Set<String> availableTabs;
  final ValueChanged<String> onOpenWorkflow;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final eventId = event['id'] as String;
    final state = ref.watch(eventCloseoutProvider(eventId));
    return state.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => _MessagePanel(
        title: 'Closeout could not load',
        message: error.toString(),
        action: 'Retry',
        onAction: () => ref.invalidate(eventCloseoutProvider(eventId)),
      ),
      data: (data) {
        final closeout = data['closeout'] as Map<String, dynamic>?;
        final exceptions = (data['exceptions'] as List? ?? const [])
            .whereType<Map>()
            .map((row) => Map<String, dynamic>.from(row))
            .toList();
        final followups = (data['followups'] as List? ?? const [])
            .whereType<Map>()
            .map((row) => Map<String, dynamic>.from(row))
            .toList();
        final isClosed = closeout?['state'] == 'CLOSED';
        return Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 920),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              children: [
                _Header(
                    event: event,
                    closeout: closeout,
                    blockers: (data['blockers'] as List?)?.length ?? 0),
                const SizedBox(height: 16),
                if (closeout == null)
                  _MessagePanel(
                    title: 'Review the event before closing it',
                    message: exceptions.isEmpty
                        ? 'There are no outstanding exceptions in the connected workflows. Start closeout to record the event outcome and audit the review.'
                        : '${exceptions.length} current exception${exceptions.length == 1 ? '' : 's'} need review. Start closeout to assign follow-up, accept an exception with a reason, or resolve the source work.',
                    action: 'Start closeout',
                    onAction: () => _run(context, ref, eventId, () async {
                      await ref
                          .read(operationsApiProvider)
                          .openEventCloseout(eventId);
                    }),
                  )
                else ...[
                  if (exceptions.isEmpty)
                    const _MessagePanel(
                        title: 'No open operational exceptions',
                        message:
                            'Issues, tasks, attendance, hospitality, and stock are reconciled for this event.')
                  else ...[
                    Text('Needs review',
                        style: Theme.of(context).textTheme.titleLarge),
                    const SizedBox(height: 8),
                    for (final item in exceptions)
                      _ExceptionCard(
                        item: item,
                        handling: _findHandling(followups, item),
                        people: people,
                        disabled: isClosed,
                        workflowTab: _workflowTab(item['sourceType'] as String),
                        canOpenWorkflow: availableTabs.contains(
                            _workflowTab(item['sourceType'] as String)),
                        onOpenWorkflow: onOpenWorkflow,
                        onSave: (input) =>
                            _run(context, ref, eventId, () async {
                          await ref
                              .read(operationsApiProvider)
                              .updateCloseoutFollowup(eventId, input);
                        }),
                      ),
                  ],
                  const SizedBox(height: 16),
                  _SummaryCard(
                    initial: closeout['summary'] as String? ?? '',
                    disabled: isClosed,
                    onSave: (summary) => _run(context, ref, eventId, () async {
                      await ref
                          .read(operationsApiProvider)
                          .updateCloseoutSummary(eventId, summary);
                    }),
                  ),
                  _ActivityCard(
                      events: (closeout['auditEvents'] as List? ?? const [])
                          .whereType<Map>()
                          .map((row) => Map<String, dynamic>.from(row))
                          .toList()),
                  const SizedBox(height: 12),
                  if (isClosed)
                    const _MessagePanel(
                        title: 'Event closed',
                        message:
                            'Ordinary changes to this event are locked. Controlled post-close corrections are not available yet.')
                  else
                    FilledButton.icon(
                      onPressed: data['canFinalize'] == true
                          ? () => _confirmFinalize(context, ref, eventId)
                          : null,
                      icon: const Icon(Icons.lock_outline),
                      label: Text(data['canFinalize'] == true
                          ? 'Finalize event closeout'
                          : '${(data['blockers'] as List?)?.length ?? 0} exception(s) still need a decision'),
                    ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _confirmFinalize(
      BuildContext context, WidgetRef ref, String eventId) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Close this event?'),
        content: const Text(
            'The API will recheck every live exception. When closed, ordinary writes for this event will be rejected.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Keep open')),
          FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Close event')),
        ],
      ),
    );
    if (confirmed == true && context.mounted) {
      await _run(context, ref, eventId, () async {
        await ref.read(operationsApiProvider).finalizeEventCloseout(eventId);
      });
    }
  }

  Future<void> _run(BuildContext context, WidgetRef ref, String eventId,
      Future<void> Function() action) async {
    try {
      await action();
      ref.invalidate(eventCloseoutProvider(eventId));
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Closeout updated.')));
      }
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Could not update closeout: $error')));
      }
      ref.invalidate(eventCloseoutProvider(eventId));
    }
  }

  Map<String, dynamic>? _findHandling(
      List<Map<String, dynamic>> rows, Map<String, dynamic> exception) {
    for (final row in rows) {
      if (row['sourceType'] == exception['sourceType'] &&
          row['sourceId'] == exception['sourceId']) {
        return row;
      }
    }
    return null;
  }

  String _workflowTab(String sourceType) => switch (sourceType) {
        'ISSUE' => 'Issues',
        'TASK' => 'Operations',
        'ATTENDANCE' => 'Staffing',
        'HOSPITALITY' => 'Hospitality',
        'STOCK_COUNT' || 'STOCK_TRANSFER' => 'Stock',
        _ => 'Today',
      };
}

class _Header extends StatelessWidget {
  const _Header(
      {required this.event, required this.closeout, required this.blockers});
  final Map<String, dynamic> event;
  final Map<String, dynamic>? closeout;
  final int blockers;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(children: [
            const CircleAvatar(child: Icon(Icons.fact_check_outlined)),
            const SizedBox(width: 14),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text('Event closeout',
                      style: Theme.of(context).textTheme.titleLarge),
                  Text(event['name'] as String? ?? 'Selected event'),
                ])),
            Chip(
                label: Text(closeout == null
                    ? 'Not started'
                    : closeout!['state'] == 'CLOSED'
                        ? 'Closed'
                        : '$blockers to review')),
          ]),
        ),
      );
}

class _MessagePanel extends StatelessWidget {
  const _MessagePanel(
      {required this.title, required this.message, this.action, this.onAction});
  final String title;
  final String message;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(message),
            if (action != null) ...[
              const SizedBox(height: 12),
              FilledButton(onPressed: onAction, child: Text(action!)),
            ],
          ]),
        ),
      );
}

class _ExceptionCard extends StatelessWidget {
  const _ExceptionCard(
      {required this.item,
      required this.handling,
      required this.people,
      required this.disabled,
      required this.workflowTab,
      required this.canOpenWorkflow,
      required this.onOpenWorkflow,
      required this.onSave});
  final Map<String, dynamic> item;
  final Map<String, dynamic>? handling;
  final List<Map<String, dynamic>> people;
  final bool disabled;
  final String workflowTab;
  final bool canOpenWorkflow;
  final ValueChanged<String> onOpenWorkflow;
  final Future<void> Function(Map<String, Object?>) onSave;

  @override
  Widget build(BuildContext context) {
    final state = handling?['state'] as String? ?? 'OPEN';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Icon(Icons.error_outline, color: Color(0xFFC74B37)),
            const SizedBox(width: 8),
            Expanded(
                child: Text(item['title'] as String? ?? 'Operational exception',
                    style: Theme.of(context).textTheme.titleSmall)),
            Chip(label: Text(state.replaceAll('_', ' ').toLowerCase())),
          ]),
          if (!disabled && state == 'OPEN') ...[
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              if (canOpenWorkflow)
                TextButton.icon(
                    onPressed: () => onOpenWorkflow(workflowTab),
                    icon: const Icon(Icons.open_in_new),
                    label: const Text('Open source workflow')),
              OutlinedButton.icon(
                onPressed: () => _decide(context, accepted: true),
                icon: const Icon(Icons.rule_outlined),
                label: const Text('Accept with reason'),
              ),
              OutlinedButton.icon(
                onPressed: () => _decide(context, accepted: false),
                icon: const Icon(Icons.assignment_ind_outlined),
                label: const Text('Assign follow-up'),
              ),
            ]),
          ],
        ]),
      ),
    );
  }

  Future<void> _decide(BuildContext context, {required bool accepted}) async {
    final result = await showDialog<Map<String, Object?>>(
        context: context,
        builder: (_) => _DecisionDialog(
            accepted: accepted,
            sourceType: item['sourceType'] as String,
            sourceId: item['sourceId'] as String,
            people: people));
    if (result != null) await onSave(result);
  }
}

class _DecisionDialog extends StatefulWidget {
  const _DecisionDialog(
      {required this.accepted,
      required this.sourceType,
      required this.sourceId,
      required this.people});
  final bool accepted;
  final String sourceType;
  final String sourceId;
  final List<Map<String, dynamic>> people;

  @override
  State<_DecisionDialog> createState() => _DecisionDialogState();
}

class _DecisionDialogState extends State<_DecisionDialog> {
  final _reason = TextEditingController();
  String? _owner;
  DateTime _due = DateTime.now().add(const Duration(days: 1));

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(
            widget.accepted ? 'Accept this exception' : 'Assign a follow-up'),
        content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (!widget.accepted) ...[
            DropdownButtonFormField<String>(
              initialValue: _owner,
              decoration: const InputDecoration(labelText: 'Follow-up owner'),
              items: [
                for (final person in widget.people)
                  DropdownMenuItem(
                      value: person['externalSubject'] as String,
                      child: Text(
                          person['displayName'] as String? ?? 'Team member'))
              ],
              onChanged: (value) => setState(() => _owner = value),
            ),
            ListTile(
                title: const Text('Due date'),
                subtitle: Text(
                    MaterialLocalizations.of(context).formatMediumDate(_due)),
                trailing: const Icon(Icons.calendar_month_outlined),
                onTap: () async {
                  final selected = await showDatePicker(
                      context: context,
                      initialDate: _due,
                      firstDate: DateTime.now(),
                      lastDate: DateTime.now().add(const Duration(days: 3650)));
                  if (selected != null) {
                    setState(() => _due = selected);
                  }
                }),
          ],
          TextField(
              controller: _reason,
              autofocus: true,
              minLines: 2,
              maxLines: 4,
              maxLength: 500,
              decoration: InputDecoration(
                  labelText: widget.accepted
                      ? 'Reason for accepting'
                      : 'Follow-up reason')),
        ])),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () {
                if (_reason.text.trim().length < 3 ||
                    (!widget.accepted && _owner == null)) {
                  return;
                }
                Navigator.pop(context, <String, Object?>{
                  'sourceType': widget.sourceType,
                  'sourceId': widget.sourceId,
                  'state': widget.accepted ? 'ACCEPTED' : 'FOLLOW_UP',
                  'reason': _reason.text.trim(),
                  if (!widget.accepted) 'ownerSubject': _owner,
                  if (!widget.accepted)
                    'dueAt': DateTime(_due.year, _due.month, _due.day, 23, 59)
                        .toUtc()
                        .toIso8601String(),
                });
              },
              child: Text(
                  widget.accepted ? 'Accept exception' : 'Assign follow-up')),
        ],
      );
}

class _SummaryCard extends StatefulWidget {
  const _SummaryCard(
      {required this.initial, required this.disabled, required this.onSave});
  final String initial;
  final bool disabled;
  final Future<void> Function(String) onSave;
  @override
  State<_SummaryCard> createState() => _SummaryCardState();
}

class _ActivityCard extends StatelessWidget {
  const _ActivityCard({required this.events});
  final List<Map<String, dynamic>> events;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Review history',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            if (events.isEmpty)
              const Text('No closeout changes have been recorded yet.')
            else
              for (final event in events.take(8))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.history),
                  title: Text((event['action'] as String? ?? 'updated')
                      .replaceAll('_', ' ')),
                  subtitle: Text(
                      '${event['actorId'] ?? 'Operator'} · ${_formatTime(event['createdAt'])}${event['reason'] is String && (event['reason'] as String).isNotEmpty ? ' · ${event['reason']}' : ''}'),
                ),
          ]),
        ),
      );

  String _formatTime(Object? value) {
    final parsed = DateTime.tryParse(value as String? ?? '')?.toLocal();
    if (parsed == null) return 'Time unavailable';
    final date = parsed.toString();
    return date.substring(0, 16);
  }
}

class _SummaryCardState extends State<_SummaryCard> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.initial);
  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Card(
          child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Event outcome', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          TextField(
              controller: _controller,
              enabled: !widget.disabled,
              maxLength: 2000,
              minLines: 2,
              maxLines: 5,
              decoration: const InputDecoration(
                  hintText: 'Optional summary for the event record',
                  border: OutlineInputBorder())),
          if (!widget.disabled)
            Align(
                alignment: Alignment.centerRight,
                child: FilledButton.tonal(
                    onPressed: () => widget.onSave(_controller.text),
                    child: const Text('Save summary'))),
        ]),
      ));
}
