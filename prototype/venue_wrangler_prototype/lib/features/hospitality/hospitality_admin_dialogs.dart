import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../operations/operations_api.dart';

class HospitalityMenuManagerDialog extends ConsumerStatefulWidget {
  const HospitalityMenuManagerDialog({super.key, required this.venueId});
  final String venueId;

  @override
  ConsumerState<HospitalityMenuManagerDialog> createState() =>
      _HospitalityMenuManagerDialogState();
}

class _HospitalityMenuManagerDialogState
    extends ConsumerState<HospitalityMenuManagerDialog> {
  final _name = TextEditingController();
  final _description = TextEditingController();
  final _category = TextEditingController(text: 'General');
  final _unit = TextEditingController(text: 'each');
  final _price = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    _category.dispose();
    _unit.dispose();
    _price.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('Hospitality menu catalog'),
        content: SizedBox(
          width: 560,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                    'Menu prices use the tenant currency configured in approval policy.'),
                const SizedBox(height: 12),
                ref
                    .watch(
                        adminVenueHospitalityMenuItemsProvider(widget.venueId))
                    .when(
                      loading: () => const LinearProgressIndicator(),
                      error: (error, _) =>
                          Text('Menu catalog unavailable: $error'),
                      data: (items) => Column(
                        children: [
                          for (final item in items)
                            ListTile(
                              contentPadding: EdgeInsets.zero,
                              title:
                                  Text(item['name'] as String? ?? 'Menu item'),
                              subtitle: Text(
                                  '${item['category']} · ${item['currencyCode'] ?? 'USD'} ${item['unitPrice']} / ${item['defaultUnit']}${item['active'] == true ? '' : ' · inactive'}'),
                              trailing: Switch.adaptive(
                                value: item['active'] == true,
                                onChanged: _saving
                                    ? null
                                    : (active) => _setActive(
                                        item['id'] as String, active),
                              ),
                            ),
                        ],
                      ),
                    ),
                const Divider(height: 24),
                Text('Add menu item',
                    style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 8),
                TextField(
                    controller: _name,
                    maxLength: 160,
                    decoration: const InputDecoration(labelText: 'Item name')),
                Row(children: [
                  Expanded(
                    child: TextField(
                        controller: _category,
                        maxLength: 80,
                        decoration:
                            const InputDecoration(labelText: 'Category')),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                        controller: _unit,
                        maxLength: 24,
                        decoration:
                            const InputDecoration(labelText: 'Default unit')),
                  ),
                ]),
                Row(children: [
                  Expanded(
                    child: TextField(
                        controller: _price,
                        keyboardType: const TextInputType.numberWithOptions(
                            decimal: true),
                        decoration: const InputDecoration(
                            labelText: 'Unit price', prefixText: '¤ ')),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                        controller: _description,
                        maxLength: 1000,
                        decoration:
                            const InputDecoration(labelText: 'Description')),
                  ),
                ]),
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
              onPressed: _saving ? null : () => Navigator.pop(context),
              child: const Text('Done')),
          FilledButton.icon(
            onPressed: _saving ? null : _create,
            icon: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.add),
            label: const Text('Add item'),
          ),
        ],
      );

  Future<void> _create() async {
    final name = _name.text.trim();
    final unit = _unit.text.trim();
    final category = _category.text.trim();
    final price = double.tryParse(_price.text.trim());
    if (name.length < 2 ||
        unit.isEmpty ||
        category.isEmpty ||
        price == null ||
        price < 0) {
      setState(() => _error =
          'Enter an item name, category, unit, and valid non-negative price.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(operationsApiProvider)
          .createHospitalityMenuItem(widget.venueId, {
        'name': name,
        'description': _description.text.trim(),
        'category': category,
        'unit': unit,
        'unitPrice': price,
      });
      _name.clear();
      _description.clear();
      _price.clear();
      ref.invalidate(adminVenueHospitalityMenuItemsProvider(widget.venueId));
      ref.invalidate(venueHospitalityMenuItemsProvider(widget.venueId));
    } catch (error) {
      setState(() => _error = 'Could not add menu item: $error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _setActive(String itemId, bool active) async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(operationsApiProvider)
          .setHospitalityMenuItemActive(widget.venueId, itemId, active);
      ref.invalidate(adminVenueHospitalityMenuItemsProvider(widget.venueId));
      ref.invalidate(venueHospitalityMenuItemsProvider(widget.venueId));
    } catch (error) {
      setState(() => _error = 'Could not update menu item: $error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

class HospitalityPolicyDialog extends ConsumerWidget {
  const HospitalityPolicyDialog({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => AlertDialog(
        title: const Text('Hospitality approval policy'),
        content: SizedBox(
          width: 420,
          child: ref.watch(hospitalityPolicyProvider).when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, _) => Text('Policy unavailable: $error'),
                data: (policy) => _HospitalityPolicyForm(
                    policy: policy,
                    onSave: (threshold, currency) async {
                      await ref
                          .read(operationsApiProvider)
                          .updateHospitalityPolicy(
                              threshold: threshold, currencyCode: currency);
                      ref.invalidate(hospitalityPolicyProvider);
                    }),
              ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Close')),
        ],
      );
}

class _HospitalityPolicyForm extends StatefulWidget {
  const _HospitalityPolicyForm({required this.policy, required this.onSave});
  final Map<String, dynamic> policy;
  final Future<void> Function(double? threshold, String currencyCode) onSave;

  @override
  State<_HospitalityPolicyForm> createState() => _HospitalityPolicyFormState();
}

class _HospitalityPolicyFormState extends State<_HospitalityPolicyForm> {
  late final TextEditingController _threshold;
  late final TextEditingController _currency;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _threshold = TextEditingController(
        text: widget.policy['hospitalityApprovalThreshold']?.toString() ?? '');
    _currency = TextEditingController(
        text: widget.policy['hospitalityCurrencyCode'] as String? ?? 'USD');
  }

  @override
  void dispose() {
    _threshold.dispose();
    _currency.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
              'Orders above this estimated total require a manager to approve before the kitchen can accept them. Unpriced custom lines also require approval while a threshold is active.'),
          const SizedBox(height: 12),
          TextField(
              controller: _currency,
              maxLength: 3,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(
                  labelText: 'Tenant currency (ISO 4217)')),
          TextField(
              controller: _threshold,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                  labelText: 'Approval threshold (leave blank to disable)')),
          if (_error != null)
            Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(_error!,
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error))),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: _saving ? null : _save,
              child: _saving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Save policy'),
            ),
          ),
        ],
      );

  Future<void> _save() async {
    final currency = _currency.text.trim().toUpperCase();
    final thresholdText = _threshold.text.trim();
    final threshold =
        thresholdText.isEmpty ? null : double.tryParse(thresholdText);
    if (!RegExp(r'^[A-Z]{3}$').hasMatch(currency) ||
        (thresholdText.isNotEmpty && (threshold == null || threshold < 0))) {
      setState(() => _error =
          'Enter a three-letter currency and a non-negative threshold.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.onSave(threshold, currency);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Hospitality approval policy saved.')));
      }
    } catch (error) {
      setState(() => _error = 'Could not save policy: $error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

final hospitalityPolicyProvider =
    FutureProvider.autoDispose<Map<String, dynamic>>(
        (ref) => ref.watch(operationsApiProvider).hospitalityPolicy());
