import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../operations/operations_api.dart';
import 'hospitality_admin_dialogs.dart';

List<List<Offset>> _signatureStrokes(Object? value) {
  if (value is! List) return const [];
  return value
      .whereType<List>()
      .map((stroke) => stroke.whereType<Map>().map((point) {
            final x = point['x'];
            final y = point['y'];
            return Offset(
              x is num ? x.toDouble() : 0,
              y is num ? y.toDouble() : 0,
            );
          }).toList())
      .where((stroke) => stroke.length >= 2)
      .toList();
}

class HospitalityPage extends ConsumerWidget {
  const HospitalityPage(
      {super.key,
      required this.event,
      required this.canOrder,
      required this.canFulfill,
      this.canApprove = false,
      this.canManageMenu = false,
      this.canManagePolicy = false,
      required this.subject,
      required this.locations});
  final Map<String, dynamic> event;
  final bool canOrder;
  final bool canFulfill;
  final bool canApprove;
  final bool canManageMenu;
  final bool canManagePolicy;
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
            if (canOrder || canFulfill || canManageMenu || canManagePolicy)
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
                  if (canManageMenu)
                    IconButton(
                      tooltip: 'Manage hospitality menu',
                      onPressed: () async {
                        await showDialog<void>(
                            context: context,
                            builder: (_) =>
                                HospitalityMenuManagerDialog(venueId: venueId));
                        ref.invalidate(
                            venueHospitalityMenuItemsProvider(venueId));
                        ref.invalidate(
                            adminVenueHospitalityMenuItemsProvider(venueId));
                      },
                      icon: const Icon(Icons.restaurant_menu_outlined),
                    ),
                  if (canManagePolicy)
                    IconButton(
                      tooltip: 'Hospitality approval policy',
                      onPressed: () => showDialog<void>(
                          context: context,
                          builder: (_) => const HospitalityPolicyDialog()),
                      icon: const Icon(Icons.rule_outlined),
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
                  canOrder: canOrder,
                  canFulfill: canFulfill,
                  canApprove: canApprove,
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
      required this.canOrder,
      required this.canFulfill,
      required this.canApprove});
  final Map<String, dynamic> order;
  final String eventId;
  final String subject;
  final bool canOrder;
  final bool canFulfill;
  final bool canApprove;

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
    if (state == 'AWAITING_APPROVAL') {
      if (canApprove) {
        actions.add(('approve', 'Approve request'));
      }
      if (canApprove || canFulfill) {
        actions.add(('reject', 'Reject'));
      }
      if (isRequester) {
        actions.add(('cancel', 'Cancel request'));
      }
    }
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
      if (state == 'READY' || state == 'PARTIALLY_DISTRIBUTED') {
        actions.add(('fulfill', 'Record items delivered'));
      }
      if (state == 'ACCEPTED' ||
          state == 'PREPARING' ||
          state == 'READY' ||
          state == 'PARTIALLY_DISTRIBUTED') {
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
        if (state == 'AWAITING_APPROVAL')
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            child: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Theme.of(context)
                    .colorScheme
                    .tertiaryContainer
                    .withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(children: [
                Icon(Icons.pending_actions_outlined,
                    size: 18,
                    color: Theme.of(context).colorScheme.onTertiaryContainer),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Awaiting manager approval before kitchen acceptance. The configured value uses priced menu items; unpriced custom items also require approval.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              ]),
            ),
          ),
        for (final line in lines)
          ListTile(
            dense: true,
            title: Text(
                '${line['itemName']} · ${line['quantity']} ${line['unit']}'),
            subtitle: Text([
              'Delivered ${line['fulfilledQuantity'] ?? 0} of ${line['quantity']} ${line['unit']}',
              if ((line['note'] as String? ?? '').isNotEmpty)
                line['note'] as String,
              for (final fulfillment
                  in (line['fulfillments'] as List? ?? const [])
                      .whereType<Map>())
                if (fulfillment['substituteItemName'] is String)
                  '${fulfillment['quantity']} substituted with ${fulfillment['substituteItemName']}${fulfillment['reason'] is String ? ' · ${fulfillment['reason']}' : ''}'
                else if (fulfillment['reason'] is String)
                  '${fulfillment['quantity']} delivered · ${fulfillment['reason']}',
            ].join('\n')),
          ),
        if ((order['instructions'] as String? ?? '').isNotEmpty)
          Padding(
              padding: const EdgeInsets.all(12),
              child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Service notes: ${order['instructions']}'))),
        if ((order['beoReference'] as String? ?? '').isNotEmpty)
          ListTile(
            dense: true,
            leading: const Icon(Icons.event_note_outlined),
            title: Text('BEO ${order['beoReference']}'),
            subtitle:
                const Text('Venue-provided banquet event order reference'),
          ),
        if (order['deliveryReceipt'] is Map)
          ListTile(
            leading: const Icon(Icons.fact_check_outlined),
            title: Text(
                'Received by ${(order['deliveryReceipt'] as Map)['receivedByName']}'),
            subtitle: Text([
              'Handoff acknowledged · ${DateTime.tryParse((order['deliveryReceipt'] as Map)['acknowledgedAt']?.toString() ?? '')?.toLocal().toString() ?? 'time unavailable'}',
              if ((order['deliveryReceipt'] as Map)['receiverSignature'] is List)
                'Receiver signature captured',
              if (((order['deliveryReceipt'] as Map)['note'] as String? ?? '')
                  .isNotEmpty)
                (order['deliveryReceipt'] as Map)['note'] as String,
            ].join(' · ')),
            trailing: (order['deliveryReceipt'] as Map)['receiverSignature'] is List
                ? TextButton(
                    onPressed: () => showDialog<void>(
                      context: context,
                      builder: (context) => AlertDialog(
                        title: const Text('Receiver handoff signature'),
                        content: SizedBox(
                          width: 420,
                          height: 120,
                          child: CustomPaint(
                            painter: _ReceiverSignaturePainter(_signatureStrokes(
                                (order['deliveryReceipt'] as Map)['receiverSignature'])),
                          ),
                        ),
                        actions: [
                          TextButton(
                              onPressed: () => Navigator.pop(context),
                              child: const Text('Close')),
                        ],
                      ),
                    ),
                    child: const Text('View signature'),
                  )
                : null,
          ),
        if (actions.isNotEmpty)
          Padding(
              padding: const EdgeInsets.all(12),
              child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: actions
                      .map((action) => OutlinedButton(
                            onPressed: () =>
                                _act(context, ref, orderId, action.$1, lines),
                            child: Text(action.$2),
                          ))
                      .toList())),
      ],
    ));
  }

  IconData _icon(String state) => switch (state) {
        'AWAITING_APPROVAL' => Icons.pending_actions_outlined,
        'READY' => Icons.notifications_active_outlined,
        'DISTRIBUTED' ||
        'PARTIALLY_DISTRIBUTED' =>
          Icons.local_shipping_outlined,
        'PICKED_UP' => Icons.task_alt,
        'REJECTED' || 'CANCELLED' => Icons.block_outlined,
        'PREPARING' => Icons.soup_kitchen_outlined,
        _ => Icons.receipt_long_outlined,
      };

  Future<void> _act(BuildContext context, WidgetRef ref, String orderId,
      String action, List<Map<String, dynamic>> lines) async {
    String? reason;
    List<Map<String, Object?>>? fulfillments;
    String? receivedByName;
    String? receiptNote;
    bool? receiverAcknowledged;
    String? receiverSignature;
    if (action == 'fulfill') {
      final result = await showDialog<Map<String, Object?>>(
        context: context,
        builder: (_) => _FulfillmentComposer(lines: lines),
      );
      if (!context.mounted || result == null) return;
      reason = result['reason'] as String?;
      fulfillments = (result['fulfillments'] as List)
          .whereType<Map>()
          .map((entry) => Map<String, Object?>.from(entry))
          .toList();
    }
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
    if (action == 'pickup') {
      if (!context.mounted) return;
      final receipt = await showDialog<Map<String, Object?>>(
        context: context,
        builder: (_) => const _PickupReceiptDialog(),
      );
      if (!context.mounted || receipt == null) return;
      receivedByName = receipt['receivedByName'] as String;
      receiptNote = receipt['receiptNote'] as String?;
      receiverAcknowledged = receipt['receiverAcknowledged'] as bool;
      receiverSignature = receipt['receiverSignature'] as String;
    }
    try {
      await ref.read(operationsApiProvider).hospitalityOrderAction(
          eventId, orderId, action,
          reason: reason,
          fulfillments: fulfillments,
          receivedByName: receivedByName,
          receiptNote: receiptNote,
          receiverAcknowledged: receiverAcknowledged,
          receiverSignature: receiverSignature);
      ref.invalidate(eventHospitalityOrdersProvider(eventId));
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text('Could not update hospitality order: $error')));
      }
    }
  }
}

class _FulfillmentComposer extends StatefulWidget {
  const _FulfillmentComposer({required this.lines});
  final List<Map<String, dynamic>> lines;

  @override
  State<_FulfillmentComposer> createState() => _FulfillmentComposerState();
}

class _FulfillmentComposerState extends State<_FulfillmentComposer> {
  final _reason = TextEditingController();
  late final List<TextEditingController> _quantities;
  late final List<TextEditingController> _substitutions;
  late final List<TextEditingController> _substitutionReasons;
  String? _error;

  double _amount(Object? value) =>
      value is num ? value.toDouble() : double.tryParse('$value') ?? 0;

  @override
  void initState() {
    super.initState();
    _quantities = widget.lines.map((line) {
      final remaining =
          (_amount(line['quantity']) - _amount(line['fulfilledQuantity']))
              .clamp(0, double.infinity);
      return TextEditingController(text: remaining.toStringAsFixed(3));
    }).toList();
    _substitutions =
        List.generate(widget.lines.length, (_) => TextEditingController());
    _substitutionReasons =
        List.generate(widget.lines.length, (_) => TextEditingController());
  }

  @override
  void dispose() {
    _reason.dispose();
    for (final controller in [
      ..._quantities,
      ..._substitutions,
      ..._substitutionReasons
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  void _submit() {
    final fulfillments = <Map<String, Object?>>[];
    var remainingTotal = 0.0;
    var batchTotal = 0.0;
    for (var index = 0; index < widget.lines.length; index++) {
      final line = widget.lines[index];
      final remaining =
          (_amount(line['quantity']) - _amount(line['fulfilledQuantity']))
              .clamp(0, double.infinity);
      remainingTotal += remaining;
      final quantity = double.tryParse(_quantities[index].text.trim());
      if (quantity == null || quantity < 0 || quantity > remaining) {
        setState(() => _error =
            'Enter a valid quantity up to the remaining amount for each item.');
        return;
      }
      if (quantity == 0) continue;
      batchTotal += quantity;
      final substitute = _substitutions[index].text.trim();
      final substituteReason = _substitutionReasons[index].text.trim();
      if (substitute.isNotEmpty && substituteReason.length < 3) {
        setState(() => _error = 'Add a reason for each item substitution.');
        return;
      }
      fulfillments.add({
        'lineId': line['id'] as String,
        'quantity': quantity,
        if (substitute.isNotEmpty) 'substituteItemName': substitute,
        if (substitute.isNotEmpty) 'reason': substituteReason,
      });
    }
    if (fulfillments.isEmpty) {
      setState(() => _error = 'Enter at least one delivered quantity.');
      return;
    }
    if (batchTotal < remainingTotal && _reason.text.trim().length < 3) {
      setState(
          () => _error = 'Explain why the remaining items were not delivered.');
      return;
    }
    Navigator.pop(context, {
      'fulfillments': fulfillments,
      if (_reason.text.trim().isNotEmpty) 'reason': _reason.text.trim(),
    });
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('Record delivered items'),
        content: SizedBox(
          width: 520,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                    'Enter the quantity delivered in this batch. Leave an item at 0 when none was delivered.'),
                const SizedBox(height: 12),
                for (var index = 0; index < widget.lines.length; index++) ...[
                  Text(
                      '${widget.lines[index]['itemName']} · ${widget.lines[index]['unit']}',
                      style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text(
                      'Remaining ${(_amount(widget.lines[index]['quantity']) - _amount(widget.lines[index]['fulfilledQuantity'])).clamp(0, double.infinity)}'),
                  TextField(
                    controller: _quantities[index],
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    decoration:
                        const InputDecoration(labelText: 'Delivered now'),
                  ),
                  TextField(
                    controller: _substitutions[index],
                    decoration: const InputDecoration(
                        labelText: 'Substitute item (optional)'),
                  ),
                  TextField(
                    controller: _substitutionReasons[index],
                    decoration:
                        const InputDecoration(labelText: 'Substitution reason'),
                  ),
                  const Divider(height: 24),
                ],
                TextField(
                  controller: _reason,
                  maxLength: 500,
                  minLines: 2,
                  maxLines: 3,
                  decoration: const InputDecoration(
                      labelText:
                          'Reason for remaining quantities (required for partial fulfillment)'),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(_error!,
                        style: TextStyle(
                            color: Theme.of(context).colorScheme.error)),
                  ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Back')),
          FilledButton(
              onPressed: _submit, child: const Text('Save fulfillment')),
        ],
      );
}

class _PickupReceiptDialog extends StatefulWidget {
  const _PickupReceiptDialog();

  @override
  State<_PickupReceiptDialog> createState() => _PickupReceiptDialogState();
}

class _PickupReceiptDialogState extends State<_PickupReceiptDialog> {
  final _receiver = TextEditingController();
  final _note = TextEditingController();
  final List<List<Offset>> _strokes = [];
  List<Offset>? _activeStroke;
  bool _acknowledged = false;

  void _addPoint(Offset position, Size size, {bool start = false}) {
    if (_strokes.fold<int>(0, (sum, stroke) => sum + stroke.length) >= 512) return;
    final point = Offset(
      (position.dx / size.width).clamp(0.0, 1.0).toDouble(),
      (position.dy / size.height).clamp(0.0, 1.0).toDouble(),
    );
    setState(() {
      if (start || _activeStroke == null) {
        _activeStroke = <Offset>[point];
        _strokes.add(_activeStroke!);
      } else {
        _activeStroke!.add(point);
      }
    });
  }

  String _signatureJson() => jsonEncode(_strokes
      .map((stroke) => stroke
          .map((point) => {'x': point.dx, 'y': point.dy})
          .toList())
      .toList());

  @override
  void dispose() {
    _receiver.dispose();
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('Confirm handoff'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text(
                'Record who received the completed order and capture their signature for the handoff record.'),
            const Text(
                'The signature mark is stored with this order as operational evidence.'),
            const SizedBox(height: 12),
            TextField(
              controller: _receiver,
              autofocus: true,
              maxLength: 120,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(labelText: 'Received by'),
            ),
            TextField(
              controller: _note,
              maxLength: 500,
              decoration:
                  const InputDecoration(labelText: 'Handoff note (optional)'),
            ),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerLeft,
              child: Text('Receiver signature',
                  style: Theme.of(context).textTheme.titleSmall),
            ),
            const SizedBox(height: 6),
            SizedBox(
              height: 120,
              width: double.infinity,
              child: LayoutBuilder(builder: (context, constraints) {
                final size = Size(constraints.maxWidth, constraints.maxHeight);
                return GestureDetector(
                  onPanStart: (details) =>
                      _addPoint(details.localPosition, size, start: true),
                  onPanUpdate: (details) => _addPoint(details.localPosition, size),
                  onPanEnd: (_) => setState(() {
                    if ((_activeStroke?.length ?? 0) < 2 && _strokes.isNotEmpty) {
                      _strokes.removeLast();
                    }
                    _activeStroke = null;
                  }),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.surfaceContainerLow,
                      border: Border.all(color: Theme.of(context).dividerColor),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: CustomPaint(
                      painter: _ReceiverSignaturePainter(_strokes),
                      child: const SizedBox.expand(),
                    ),
                  ),
                );
              }),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: _strokes.isEmpty
                    ? null
                    : () => setState(() {
                          _strokes.clear();
                          _activeStroke = null;
                        }),
                icon: const Icon(Icons.undo),
                label: const Text('Clear signature'),
              ),
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _acknowledged,
              onChanged: (value) =>
                  setState(() => _acknowledged = value ?? false),
              title: const Text('I confirmed this handoff in person'),
              controlAffinity: ListTileControlAffinity.leading,
            ),
          ]),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Back')),
          FilledButton(
            onPressed: _receiver.text.trim().length >= 2 &&
                    _acknowledged &&
                    _strokes.isNotEmpty
                ? () => Navigator.pop(context, {
                      'receivedByName': _receiver.text.trim(),
                      'receiptNote': _note.text.trim(),
                      'receiverAcknowledged': true,
                      'receiverSignature': _signatureJson(),
                    })
                : null,
            child: const Text('Save receipt'),
          ),
        ],
      );
}

class _ReceiverSignaturePainter extends CustomPainter {
  const _ReceiverSignaturePainter(this.strokes);
  final List<List<Offset>> strokes;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xFF17202B)
      ..strokeWidth = 2.4
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;
    for (final stroke in strokes) {
      if (stroke.length < 2) continue;
      final path = Path()
        ..moveTo(stroke.first.dx * size.width, stroke.first.dy * size.height);
      for (final point in stroke.skip(1)) {
        path.lineTo(point.dx * size.width, point.dy * size.height);
      }
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _ReceiverSignaturePainter oldDelegate) => true;
}

class _OrderComposer extends ConsumerStatefulWidget {
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
  ConsumerState<_OrderComposer> createState() => _OrderComposerState();
}

class _OrderComposerState extends ConsumerState<_OrderComposer> {
  final _item = TextEditingController();
  final _quantity = TextEditingController(text: '1');
  final _unit = TextEditingController(text: 'each');
  final _note = TextEditingController();
  final _instructions = TextEditingController();
  final _beoReference = TextEditingController();
  final _lines = <Map<String, Object?>>[];
  late DateTime _serviceAt;
  String? _locationId;
  String? _selectedMenuItemId;
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
    _beoReference.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final menuItemsAsync =
        ref.watch(venueHospitalityMenuItemsProvider(widget.venueId));
    final menuItems = menuItemsAsync.valueOrNull ?? const [];
    return AlertDialog(
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
                if (menuItems.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: DropdownButtonFormField<String?>(
                      initialValue: _selectedMenuItemId,
                      decoration: const InputDecoration(
                          labelText: 'Menu catalog item (optional)'),
                      items: [
                        const DropdownMenuItem(
                            value: null,
                            child: Text('Custom item (not in catalog)')),
                        ...menuItems.map((item) => DropdownMenuItem(
                            value: item['id'] as String,
                            child: Text(
                                '${item['name']} (${item['category']}) · ${item['currencyCode'] ?? 'USD'} ${item['unitPrice']} / ${item['defaultUnit']}'))),
                      ],
                      onChanged: _saving
                          ? null
                          : (id) {
                              setState(() {
                                _selectedMenuItemId = id;
                                if (id != null) {
                                  final found = menuItems.firstWhere(
                                      (it) => it['id'] == id,
                                      orElse: () => const {});
                                  if (found.isNotEmpty) {
                                    _item.text = found['name'] as String;
                                    _unit.text = found['defaultUnit'] as String;
                                  }
                                }
                              });
                            },
                    ),
                  ),
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
                          decoration: const InputDecoration(labelText: 'Qty'))),
                  const SizedBox(width: 8),
                  Expanded(
                      child: TextField(
                          controller: _unit,
                          decoration: const InputDecoration(labelText: 'Unit')))
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
                  controller: _beoReference,
                  maxLength: 120,
                  decoration: const InputDecoration(
                      labelText: 'Banquet event order reference (optional)',
                      helperText:
                          'Reference only; the venue system remains the source of truth.'),
                ),
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
  }

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
        'note': _note.text.trim(),
        if (_selectedMenuItemId != null) 'menuItemId': _selectedMenuItemId,
      });
      _item.clear();
      _quantity.text = '1';
      _note.clear();
      _selectedMenuItemId = null;
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
      if (_beoReference.text.trim().isNotEmpty)
        'beoReference': _beoReference.text.trim(),
      'instructions': _instructions.text.trim(),
      'lines': List<Map<String, Object?>>.from(_lines)
    };
  }
}
