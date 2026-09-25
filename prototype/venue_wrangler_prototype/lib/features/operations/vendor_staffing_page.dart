import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'operations_api.dart';

class VendorStaffingPage extends ConsumerStatefulWidget {
  const VendorStaffingPage(
      {super.key,
      required this.event,
      required this.people,
      required this.assignableUserIds,
      required this.canManage,
      required this.isVendor});
  final Map<String, dynamic> event;
  final List<Map<String, dynamic>> people;
  final Set<String> assignableUserIds;
  final bool canManage;
  final bool isVendor;

  @override
  ConsumerState<VendorStaffingPage> createState() => _VendorStaffingPageState();
}

class _VendorStaffingPageState extends ConsumerState<VendorStaffingPage> {
  String? _demandId;
  String? _vendorSubject;
  final _quantity = TextEditingController(text: '1');
  final _instructions = TextEditingController();
  final _partial = TextEditingController(text: '1');
  int _responseHours = 24;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _quantity.dispose();
    _instructions.dispose();
    _partial.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final eventId = widget.event['id'] as String;
    final requestState = ref.watch(vendorStaffingRequestsProvider(eventId));
    final demandState =
        widget.canManage ? ref.watch(staffingCoverageProvider(eventId)) : null;
    final vendors = widget.people.where((person) {
      final subject = person['externalSubject'] ?? person['subject'];
      return person['active'] != false &&
          subject is String &&
          widget.assignableUserIds.contains(subject);
    }).toList();
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 980),
        child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
            children: [
              Text('Vendor staffing',
                  style: Theme.of(context)
                      .textTheme
                      .headlineMedium
                      ?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              Text(
                  widget.canManage
                      ? 'Send requests against uncovered event demand and track vendor commitments.'
                      : 'Review requests assigned to your vendor account and report your commitment.',
                  style: Theme.of(context).textTheme.bodyLarge),
              const SizedBox(height: 18),
              if (widget.canManage)
                _requestComposer(context, demandState, vendors),
              if (_error != null)
                Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Text(_error!,
                        style: TextStyle(
                            color: Theme.of(context).colorScheme.error))),
              const SizedBox(height: 16),
              Text('Requests',
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              requestState.when(
                loading: () => const Center(
                    child: Padding(
                        padding: EdgeInsets.all(24),
                        child: CircularProgressIndicator())),
                error: (error, _) => _Panel(
                    title: 'Requests could not load',
                    child: Text('$error\nCheck your connection and retry.',
                        style: Theme.of(context).textTheme.bodyMedium)),
                data: (rows) => rows.isEmpty
                    ? const _Panel(
                        title: 'No vendor requests yet',
                        child: Text(
                            'Vendor requests created for this event will appear here.'))
                    : Column(children: [
                        for (final value in rows)
                          if (value is Map)
                            _requestCard(
                                context, Map<String, dynamic>.from(value))
                      ]),
              ),
            ]),
      ),
    );
  }

  Widget _requestComposer(
      BuildContext context,
      AsyncValue<List<dynamic>>? demandState,
      List<Map<String, dynamic>> vendors) {
    final demands = demandState?.valueOrNull
            ?.whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .where((d) => (d['unfilledHeadcount'] as num? ?? 0) > 0)
            .toList() ??
        const <Map<String, dynamic>>[];
    final demand = _firstOrNull(demands.where((d) => d['id'] == _demandId));
    return _Panel(
        title: 'Create a request',
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (demandState == null || demandState.isLoading)
            const LinearProgressIndicator()
          else if (demandState.hasError)
            Text('Demand could not load: ${demandState.error}')
          else if (demands.isEmpty)
            const Text(
                'All recorded staffing demand is currently covered. Add or update a demand requirement in Staffing before requesting vendor coverage.')
          else ...[
            DropdownButtonFormField<String>(
                initialValue: _demandId,
                isExpanded: true,
                decoration: const InputDecoration(
                    labelText: 'Uncovered staffing demand'),
                items: [
                  for (final d in demands)
                    DropdownMenuItem(
                        value: d['id'] as String,
                        child: Text(
                            '${d['role']} · ${d['unfilledHeadcount']} open · ${_date(d['startsAt'])}'))
                ],
                onChanged: (value) => setState(() => _demandId = value)),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
                initialValue: _vendorSubject,
                isExpanded: true,
                decoration:
                    const InputDecoration(labelText: 'Approved vendor account'),
                items: [
                  for (final p in vendors)
                    DropdownMenuItem(
                        value: (p['externalSubject'] ?? p['subject']) as String,
                        child: Text((p['displayName'] ?? p['email'] ?? 'Vendor')
                            .toString()))
                ],
                onChanged: (value) => setState(() => _vendorSubject = value)),
            const SizedBox(height: 10),
            TextField(
                controller: _quantity,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                    labelText: 'People requested',
                    helperText: demand == null
                        ? null
                        : 'Up to ${demand['unfilledHeadcount']} uncovered position(s).')),
            const SizedBox(height: 10),
            TextField(
                controller: _instructions,
                maxLength: 1000,
                maxLines: 2,
                decoration: const InputDecoration(
                    labelText: 'Event instructions',
                    hintText: 'Arrival point, uniform, check-in contact…')),
            const SizedBox(height: 6),
            DropdownButtonFormField<int>(
                initialValue: _responseHours,
                decoration: const InputDecoration(
                    labelText: 'Vendor response deadline'),
                items: const [4, 12, 24, 48, 72]
                    .map((hours) => DropdownMenuItem(
                        value: hours, child: Text('$hours hours from now')))
                    .toList(),
                onChanged: (hours) =>
                    setState(() => _responseHours = hours ?? 24)),
            const SizedBox(height: 8),
            FilledButton.icon(
                onPressed: _busy || demand == null || _vendorSubject == null
                    ? null
                    : () => _create(context),
                icon: const Icon(Icons.outgoing_mail),
                label: Text(_busy ? 'Sending…' : 'Send vendor request')),
          ],
        ]));
  }

  Widget _requestCard(BuildContext context, Map<String, dynamic> row) {
    final state = row['state'] as String? ?? 'SENT';
    final demand = row['demand'] is Map
        ? Map<String, dynamic>.from(row['demand'] as Map)
        : const <String, dynamic>{};
    final canRespond = widget.isVendor &&
        ['SENT', 'ACKNOWLEDGED', 'PARTIALLY_COMMITTED'].contains(state);
    final canFulfill = widget.canManage &&
        ['COMMITTED', 'PARTIALLY_COMMITTED'].contains(state);
    final canCancel = widget.canManage &&
        !['CANCELLED', 'DECLINED', 'FULFILLED'].contains(state);
    return Card(
        margin: const EdgeInsets.only(bottom: 10),
        child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(children: [
                    Expanded(
                        child: Text(
                            demand['role']?.toString() ?? 'Staffing request',
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(fontWeight: FontWeight.w700))),
                    Chip(label: Text(state.replaceAll('_', ' ')))
                  ]),
                  Text(
                      '${row['committedHeadcount']}/${row['requestedHeadcount']} committed · ${_date(demand['startsAt'])} – ${_date(demand['endsAt'])}'),
                  Text('Response due ${_date(row['responseDueAt'])}'),
                  if ((row['instructions'] as String? ?? '').isNotEmpty)
                    Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(row['instructions'] as String)),
                  if ((row['responseReason'] as String? ?? '').isNotEmpty)
                    Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child:
                            Text('Latest response: ${row['responseReason']}')),
                  if (canRespond) ...[
                    const SizedBox(height: 12),
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      OutlinedButton(
                          onPressed: _busy
                              ? null
                              : () => _respond(context, row, 'ACKNOWLEDGED', 0,
                                  'Request acknowledged; commitment pending.'),
                          child: const Text('Acknowledge')),
                      OutlinedButton(
                          onPressed: _busy
                              ? null
                              : () => _respond(
                                  context,
                                  row,
                                  'COMMITTED',
                                  row['requestedHeadcount'] as int,
                                  'Full commitment confirmed.'),
                          child: const Text('Commit all')),
                      SizedBox(
                          width: 110,
                          child: TextField(
                              controller: _partial,
                              keyboardType: TextInputType.number,
                              decoration: const InputDecoration(
                                  labelText: 'Partial qty'))),
                      OutlinedButton(
                          onPressed: _busy
                              ? null
                              : () => _respond(
                                  context,
                                  row,
                                  'PARTIALLY_COMMITTED',
                                  int.tryParse(_partial.text) ?? 0,
                                  'Partial commitment confirmed.'),
                          child: const Text('Commit partial')),
                      TextButton(
                          onPressed: _busy
                              ? null
                              : () => _respond(context, row, 'DECLINED', 0,
                                  'Vendor declined this request.'),
                          child: const Text('Decline')),
                    ]),
                  ],
                  if (canFulfill || canCancel) ...[
                    const SizedBox(height: 10),
                    Wrap(spacing: 8, children: [
                      if (canFulfill)
                        FilledButton.tonal(
                            onPressed: _busy
                                ? null
                                : () => _resolve(context, row, 'fulfill',
                                    'Manager confirmed vendor fulfillment.'),
                            child: const Text('Mark fulfilled')),
                      if (canCancel)
                        TextButton(
                            onPressed: _busy
                                ? null
                                : () => _resolve(context, row, 'cancel',
                                    'Manager cancelled this request.'),
                            child: const Text('Cancel request')),
                    ]),
                  ],
                ])));
  }

  Future<void> _create(BuildContext context) async {
    final quantity = int.tryParse(_quantity.text);
    if (quantity == null || quantity < 1 || quantity > 500) {
      setState(() => _error = 'Enter a request quantity from 1 to 500.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(operationsApiProvider)
          .createVendorStaffingRequest(widget.event['id'] as String, {
        'demandId': _demandId!,
        'vendorSubject': _vendorSubject!,
        'requestedHeadcount': quantity,
        'responseDueAt': DateTime.now()
            .add(Duration(hours: _responseHours))
            .toUtc()
            .toIso8601String(),
        'instructions': _instructions.text.trim(),
      });
      ref.invalidate(
          vendorStaffingRequestsProvider(widget.event['id'] as String));
      _instructions.clear();
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _respond(BuildContext context, Map<String, dynamic> row,
      String decision, int count, String reason) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(operationsApiProvider).vendorStaffingAction(
          widget.event['id'] as String, row['id'] as String, 'respond', {
        'decision': decision,
        'committedHeadcount': count,
        'reason': reason
      });
      ref.invalidate(
          vendorStaffingRequestsProvider(widget.event['id'] as String));
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resolve(BuildContext context, Map<String, dynamic> row,
      String action, String reason) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(operationsApiProvider).vendorStaffingAction(
          widget.event['id'] as String,
          row['id'] as String,
          action,
          {'reason': reason});
      ref.invalidate(
          vendorStaffingRequestsProvider(widget.event['id'] as String));
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _date(Object? value) {
    final date = DateTime.tryParse(value?.toString() ?? '');
    if (date == null) return 'Time TBD';
    final local = date.toLocal();
    return '${local.month}/${local.day} ${local.hour == 0 ? 12 : local.hour > 12 ? local.hour - 12 : local.hour}:${local.minute.toString().padLeft(2, '0')} ${local.hour < 12 ? 'AM' : 'PM'}';
  }
}

T? _firstOrNull<T>(Iterable<T> values) {
  for (final value in values) {
    return value;
  }
  return null;
}

class _Panel extends StatelessWidget {
  const _Panel({required this.title, required this.child});
  final String title;
  final Widget child;
  @override
  Widget build(BuildContext context) => Card(
      child: Padding(
          padding: const EdgeInsets.all(16),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(title,
                style: Theme.of(context)
                    .textTheme
                    .titleMedium
                    ?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            child
          ])));
}
