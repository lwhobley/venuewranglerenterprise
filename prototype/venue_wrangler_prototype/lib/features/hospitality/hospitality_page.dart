import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../operations/operations_api.dart';

class HospitalityPage extends ConsumerWidget {
  const HospitalityPage(
      {super.key,
      required this.event,
      required this.canOrder,
      required this.canFulfill,
      required this.subject,
      required this.locations});
  final Map<String, dynamic> event;
  final bool canOrder;
  final bool canFulfill;
  final String subject;
  final List<Map<String, dynamic>> locations;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final eventId = event['id'] as String;
    final venueId = event['venueId'] as String;
    return ref.watch(eventHospitalityOrdersProvider(eventId)).when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) =>
              Center(child: Text('Hospitality queue unavailable: $error')),
          data: (orders) => Column(children: [
            if (canOrder || canFulfill)
              Padding(
                padding: const EdgeInsets.all(12),
                child: Row(children: [
                  Expanded(
                      child: Text(
                          canFulfill
                              ? 'Kitchen and service queue'
                              : 'Event service requests',
                          style: Theme.of(context).textTheme.titleMedium)),
                  if (canOrder)
                    FilledButton.icon(
                      onPressed: () async {
                        final outcome = await showDialog<String>(
                            context: context,
                            builder: (_) => _OrderComposer(
                                  venueId: venueId,
                                  locations: locations
                                      .where((row) => row['venueId'] == venueId)
                                      .toList(),
                                  onSubmit: (data) async {
                                    await ref
                                        .read(operationsApiProvider)
                                        .createHospitalityOrder(eventId, data);
                                    ref.invalidate(
                                        eventHospitalityOrdersProvider(
                                            eventId));
                                  },
                                  onSaveDraft: (data) async {
                                    await ref
                                        .read(operationsApiProvider)
                                        .saveHospitalityDraft(eventId, data);
                                    ref.invalidate(
                                        eventHospitalityDraftsProvider(
                                            eventId));
                                  },
                                ));
                        if (outcome != null && context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                              content: Text(outcome == 'submitted'
                                  ? 'Hospitality request submitted.'
                                  : 'Draft saved securely on this device; submit it when online.')));
                        }
                      },
                      icon: const Icon(Icons.room_service_outlined),
                      label: const Text('New request'),
                    ),
                ]),
              ),
            if (canOrder) _PendingHospitalityDrafts(eventId: eventId),
            if (orders.isEmpty)
              const Expanded(
                  child: Center(
                      child: Text('No hospitality requests for this event.')))
            else
              Expanded(
                  child: ListView.separated(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 16),
                itemCount: orders.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (context, index) => _HospitalityOrderCard(
                  order: orders[index],
                  eventId: eventId,
                  subject: subject,
                  canFulfill: canFulfill,
                ),
              )),
          ]),
        );
  }
}

class _PendingHospitalityDrafts extends ConsumerWidget {
  const _PendingHospitalityDrafts({required this.eventId});
  final String eventId;
  @override
  Widget build(BuildContext context, WidgetRef ref) => ref
      .watch(eventHospitalityDraftsProvider(eventId))
      .when(
        loading: () => const SizedBox.shrink(),
        error: (_, __) => const SizedBox.shrink(),
        data: (drafts) => drafts.isEmpty
            ? const SizedBox.shrink()
            : Card(
                margin: const EdgeInsets.symmetric(horizontal: 12),
                child: ExpansionTile(
                  leading: const Icon(Icons.cloud_upload_outlined),
                  title: Text(
                      '${drafts.length} offline draft${drafts.length == 1 ? '' : 's'}'),
                  subtitle: const Text(
                      'Saved in encrypted device storage; not sent to the kitchen.'),
                  children: [
                    for (final draft in drafts)
                      ListTile(
                        title: Text(
                            '${(draft['lines'] as List? ?? const []).length} items · ${DateTime.tryParse(draft['serviceAt'] as String? ?? '')?.toLocal().toString() ?? 'service time unset'}'),
                        trailing: Wrap(children: [
                          IconButton(
                              tooltip: 'Delete draft',
                              onPressed: () async {
                                await ref
                                    .read(operationsApiProvider)
                                    .deleteHospitalityDraft(
                                        eventId, draft['draftId'] as String);
                                ref.invalidate(
                                    eventHospitalityDraftsProvider(eventId));
                              },
                              icon: const Icon(Icons.delete_outline)),
                          IconButton(
                              tooltip: 'Submit when online',
                              onPressed: () async {
                                try {
                                  await ref
                                      .read(operationsApiProvider)
                                      .submitHospitalityDraft(eventId, draft);
                                  ref.invalidate(
                                      eventHospitalityDraftsProvider(eventId));
                                  ref.invalidate(
                                      eventHospitalityOrdersProvider(eventId));
                                } catch (error) {
                                  if (context.mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                        SnackBar(
                                            content: Text(
                                                'Draft remains saved; submission failed: $error')));
                                  }
                                }
                              },
                              icon: const Icon(Icons.sync)),
                        ]),
                      )
                  ],
                ),
              ),
      );
}

class _HospitalityOrderCard extends ConsumerWidget {
  const _HospitalityOrderCard(
      {required this.order,
      required this.eventId,
      required this.subject,
      required this.canFulfill});
  final Map<String, dynamic> order;
  final String eventId;
  final String subject;
  final bool canFulfill;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = order['state'] as String? ?? 'SUBMITTED';
    final orderId = order['id'] as String;
    final isRequester = order['requestedBy'] == subject;
    final lines = (order['lines'] as List? ?? const [])
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList();
    final actions = <(String, String)>[];
    if (canFulfill) {
      if (state == 'SUBMITTED') {
        actions.add(('accept', 'Accept'));
        actions.add(('reject', 'Reject'));
      }
      if (state == 'ACCEPTED') {
        actions.add(('preparing', 'Start prep'));
      }
      if (state == 'PREPARING') {
        actions.add(('ready', 'Mark ready'));
      }
      if (state == 'READY') {
        actions.add(('distribute', 'Mark distributed'));
      }
      if (state == 'ACCEPTED' || state == 'PREPARING' || state == 'READY') {
        actions.add(('cancel', 'Cancel order'));
      }
    }
    if (isRequester && state == 'SUBMITTED') {
      actions.add(('cancel', 'Cancel request'));
    }
    if (isRequester && state == 'DISTRIBUTED') {
      actions.add(('pickup', 'Confirm pickup'));
    }
    return Card(
        child: ExpansionTile(
      leading: Icon(_icon(state),
          color: state == 'REJECTED' || state == 'CANCELLED'
              ? Theme.of(context).colorScheme.error
              : null),
      title: Text(
          '${state.replaceAll('_', ' ')} · ${DateTime.tryParse(order['serviceAt'] as String? ?? '')?.toLocal().toString() ?? 'time not set'}'),
      subtitle: Text(
          '${lines.length} item${lines.length == 1 ? '' : 's'}${order['locationId'] == null ? ' · venue-wide service' : ' · assigned service area'}'),
      children: [
        for (final line in lines)
          ListTile(
            dense: true,
            title: Text(
                '${line['quantity']} ${line['unit']} · ${line['itemName']}'),
            subtitle: (line['note'] as String? ?? '').isEmpty
                ? null
                : Text(line['note'] as String),
          ),
        if ((order['instructions'] as String? ?? '').isNotEmpty)
          Padding(
              padding: const EdgeInsets.all(12),
              child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Service notes: ${order['instructions']}'))),
        if (actions.isNotEmpty)
          Padding(
              padding: const EdgeInsets.all(12),
              child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: actions
                      .map((action) => OutlinedButton(
                            onPressed: () =>
                                _act(context, ref, orderId, action.$1),
                            child: Text(action.$2),
                          ))
                      .toList())),
      ],
    ));
  }

  IconData _icon(String state) => switch (state) {
        'READY' => Icons.notifications_active_outlined,
        'DISTRIBUTED' => Icons.local_shipping_outlined,
        'PICKED_UP' => Icons.task_alt,
        'REJECTED' || 'CANCELLED' => Icons.block_outlined,
        'PREPARING' => Icons.soup_kitchen_outlined,
        _ => Icons.receipt_long_outlined,
      };

  Future<void> _act(BuildContext context, WidgetRef ref, String orderId,
      String action) async {
    String? reason;
    if (action == 'reject' || action == 'cancel') {
      reason = await showDialog<String>(
          context: context,
          builder: (dialogContext) {
            final controller = TextEditingController();
            return AlertDialog(
              title: Text(action == 'reject'
                  ? 'Reason for rejection'
                  : 'Reason for cancellation'),
              content: TextField(
                  controller: controller,
                  autofocus: true,
                  maxLength: 500,
                  minLines: 2,
                  maxLines: 4,
                  decoration:
                      const InputDecoration(hintText: 'Add a short reason')),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(dialogContext),
                    child: const Text('Back')),
                FilledButton(
                    onPressed: () =>
                        Navigator.pop(dialogContext, controller.text.trim()),
                    child: const Text('Continue'))
              ],
            );
          });
      if (reason == null || reason.trim().length < 3) return;
    }
    try {
      await ref
          .read(operationsApiProvider)
          .hospitalityOrderAction(eventId, orderId, action, reason: reason);
      ref.invalidate(eventHospitalityOrdersProvider(eventId));
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text('Could not update hospitality order: $error')));
      }
    }
  }
}

class _OrderComposer extends StatefulWidget {
  const _OrderComposer(
      {required this.venueId,
      required this.locations,
      required this.onSubmit,
      required this.onSaveDraft});
  final String venueId;
  final List<Map<String, dynamic>> locations;
  final Future<void> Function(Map<String, Object?> data) onSubmit;
  final Future<void> Function(Map<String, Object?> data) onSaveDraft;
  @override
  State<_OrderComposer> createState() => _OrderComposerState();
}

class _OrderComposerState extends State<_OrderComposer> {
  final _item = TextEditingController();
  final _quantity = TextEditingController(text: '1');
  final _unit = TextEditingController(text: 'each');
  final _note = TextEditingController();
  final _instructions = TextEditingController();
  final _lines = <Map<String, Object?>>[];
  late DateTime _serviceAt;
  String? _locationId;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _serviceAt = DateTime(now.year, now.month, now.day, now.hour + 1);
  }

  @override
  void dispose() {
    _item.dispose();
    _quantity.dispose();
    _unit.dispose();
    _note.dispose();
    _instructions.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('New hospitality request'),
        content: SizedBox(
            width: 520,
            child: SingleChildScrollView(
                child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  OutlinedButton.icon(
                      onPressed: _chooseTime,
                      icon: const Icon(Icons.schedule),
                      label: Text(
                          'Service time: ${MaterialLocalizations.of(context).formatMediumDate(_serviceAt)} ${MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(_serviceAt))}')),
                  if (widget.locations.isNotEmpty)
                    DropdownButtonFormField<String>(
                      initialValue: _locationId ?? '',
                      decoration:
                          const InputDecoration(labelText: 'Service area'),
                      items: [
                        const DropdownMenuItem(
                            value: '', child: Text('Venue-wide')),
                        ...widget.locations.map((location) => DropdownMenuItem(
                            value: location['id'] as String,
                            child: Text(location['name'] as String)))
                      ],
                      onChanged: _saving
                          ? null
                          : (value) => setState(
                              () => _locationId = value == '' ? null : value),
                    ),
                  const SizedBox(height: 8),
                  Row(children: [
                    Expanded(
                        flex: 3,
                        child: TextField(
                            controller: _item,
                            decoration: const InputDecoration(
                                labelText: 'Food or beverage'))),
                    const SizedBox(width: 8),
                    Expanded(
                        child: TextField(
                            controller: _quantity,
                            keyboardType: const TextInputType.numberWithOptions(
                                decimal: true),
                            decoration:
                                const InputDecoration(labelText: 'Qty'))),
                    const SizedBox(width: 8),
                    Expanded(
                        child: TextField(
                            controller: _unit,
                            decoration:
                                const InputDecoration(labelText: 'Unit')))
                  ]),
                  TextField(
                      controller: _note,
                      decoration: const InputDecoration(
                          labelText: 'Item note (optional)')),
                  Align(
                      alignment: Alignment.centerRight,
                      child: TextButton.icon(
                          onPressed: _saving ? null : _addLine,
                          icon: const Icon(Icons.add),
                          label: const Text('Add item'))),
                  for (var i = 0; i < _lines.length; i++)
                    ListTile(
                        dense: true,
                        title: Text(
                            '${_lines[i]['quantity']} ${_lines[i]['unit']} · ${_lines[i]['itemName']}'),
                        subtitle: (_lines[i]['note'] as String).isEmpty
                            ? null
                            : Text(_lines[i]['note'] as String),
                        trailing: IconButton(
                            onPressed: _saving
                                ? null
                                : () => setState(() => _lines.removeAt(i)),
                            icon: const Icon(Icons.close))),
                  TextField(
                      controller: _instructions,
                      maxLength: 1000,
                      maxLines: 2,
                      decoration: const InputDecoration(
                          labelText: 'Delivery or dietary instructions')),
                  if (_error != null)
                    Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(_error!,
                            style: TextStyle(
                                color: Theme.of(context).colorScheme.error))),
                ]))),
        actions: [
          TextButton(
              onPressed: _saving ? null : () => Navigator.pop(context),
              child: const Text('Close')),
          OutlinedButton(
              onPressed: _saving ? null : _saveDraft,
              child: const Text('Save offline draft')),
          FilledButton.icon(
              onPressed: _saving ? null : _submit,
              icon: _saving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.send),
              label: const Text('Submit request'))
        ],
      );

  void _addLine() {
    final name = _item.text.trim();
    final quantity = double.tryParse(_quantity.text.trim());
    final unit = _unit.text.trim();
    if (name.length < 2 ||
        name.length > 160 ||
        quantity == null ||
        quantity <= 0 ||
        unit.isEmpty ||
        unit.length > 24) {
      setState(() =>
          _error = 'Enter an item, a positive quantity, and a count unit.');
      return;
    }
    if (_lines.length >= 40) {
      setState(() => _error = 'An order can include up to 40 items.');
      return;
    }
    setState(() {
      _lines.add({
        'itemName': name,
        'quantity': quantity,
        'unit': unit,
        'note': _note.text.trim()
      });
      _item.clear();
      _quantity.text = '1';
      _note.clear();
      _error = null;
    });
  }

  Future<void> _chooseTime() async {
    final date = await showDatePicker(
        context: context,
        initialDate: _serviceAt,
        firstDate: DateTime.now().subtract(const Duration(days: 1)),
        lastDate: DateTime.now().add(const Duration(days: 90)));
    if (date == null || !mounted) return;
    final time = await showTimePicker(
        context: context, initialTime: TimeOfDay.fromDateTime(_serviceAt));
    if (time != null && mounted) {
      setState(() => _serviceAt =
          DateTime(date.year, date.month, date.day, time.hour, time.minute));
    }
  }

  Future<void> _submit() async {
    final draft = _draftData();
    if (draft == null) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.onSubmit(draft);
      if (mounted) Navigator.pop(context, 'submitted');
    } catch (error) {
      if (mounted) {
        setState(() => _error =
            'Request not sent. Your entries are still here. Check the connection and retry, or save an offline draft. ($error)');
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _saveDraft() async {
    final draft = _draftData();
    if (draft == null) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.onSaveDraft(draft);
      if (mounted) Navigator.pop(context, 'draft');
    } catch (error) {
      if (mounted) {
        setState(() => _error =
            'Could not save the draft securely. Your entries remain open here. ($error)');
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Map<String, Object?>? _draftData() {
    if (_lines.isEmpty) {
      setState(() => _error = 'Add at least one food or beverage item.');
      return null;
    }
    return {
      'venueId': widget.venueId,
      if (_locationId != null) 'locationId': _locationId,
      'serviceAt': _serviceAt.toUtc().toIso8601String(),
      'instructions': _instructions.text.trim(),
      'lines': List<Map<String, Object?>>.from(_lines)
    };
  }
}
