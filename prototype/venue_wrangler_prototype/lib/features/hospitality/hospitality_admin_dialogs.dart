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
                              trailing: Wrap(spacing: 4, children: [
                                IconButton(
                                  tooltip: 'Configure stock recipe',
                                  onPressed: _saving
                                      ? null
                                      : () => showDialog<void>(
                                            context: context,
                                            builder: (_) =>
                                                _HospitalityRecipeDialog(
                                              venueId: widget.venueId,
                                              itemId: item['id'] as String,
                                              itemName:
                                                  item['name'] as String? ??
                                                      'Menu item',
                                              defaultUnit: item['defaultUnit']
                                                      as String? ??
                                                  'each',
                                            ),
                                          ),
                                  icon: const Icon(Icons.blender_outlined),
                                ),
                                Switch.adaptive(
                                  value: item['active'] == true,
                                  onChanged: _saving
                                      ? null
                                      : (active) => _setActive(
                                          item['id'] as String, active),
                                ),
                              ]),
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

class _HospitalityRecipeDialog extends ConsumerWidget {
  const _HospitalityRecipeDialog({
    required this.venueId,
    required this.itemId,
    required this.itemName,
    required this.defaultUnit,
  });

  final String venueId;
  final String itemId;
  final String itemName;
  final String defaultUnit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final recipe = ref
        .watch(hospitalityRecipeProvider((venueId: venueId, itemId: itemId)));
    final inventory = ref.watch(recipeInventoryItemsProvider(venueId));
    if (recipe.isLoading || inventory.isLoading) {
      return const AlertDialog(
          content: SizedBox(
              width: 340,
              height: 120,
              child: Center(child: CircularProgressIndicator())));
    }
    if (recipe.hasError || inventory.hasError) {
      return AlertDialog(
        title: const Text('Recipe unavailable'),
        content: Text(
            'Could not load recipe ingredients: ${recipe.error ?? inventory.error}'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Close'))
        ],
      );
    }
    final recipeData = recipe.requireValue;
    return _HospitalityRecipeEditor(
      venueId: venueId,
      itemId: itemId,
      itemName: itemName,
      defaultUnit: defaultUnit,
      initialLines: (recipeData['lines'] as List? ?? const [])
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList(),
      stockItems: inventory.requireValue,
    );
  }
}

class _HospitalityRecipeEditor extends ConsumerStatefulWidget {
  const _HospitalityRecipeEditor({
    required this.venueId,
    required this.itemId,
    required this.itemName,
    required this.defaultUnit,
    required this.initialLines,
    required this.stockItems,
  });

  final String venueId;
  final String itemId;
  final String itemName;
  final String defaultUnit;
  final List<Map<String, dynamic>> initialLines;
  final List<Map<String, dynamic>> stockItems;

  @override
  ConsumerState<_HospitalityRecipeEditor> createState() =>
      _HospitalityRecipeEditorState();
}

class _HospitalityRecipeEditorState
    extends ConsumerState<_HospitalityRecipeEditor> {
  late final List<_RecipeIngredientDraft> _lines;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _lines = widget.initialLines
        .map((row) => _RecipeIngredientDraft(
              stockItemId: row['stockItemId'] as String,
              quantity: TextEditingController(
                  text: row['quantityPerMenuUnit'].toString()),
            ))
        .toList();
  }

  @override
  void dispose() {
    for (final line in _lines) {
      line.quantity.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text('${widget.itemName} recipe'),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 620),
          child: SizedBox(
            width: double.maxFinite,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Ingredient quantities per 1 ${widget.defaultUnit}.'),
                  const SizedBox(height: 4),
                  const Text(
                      'Each fulfilled batch deducts its recipe amounts from stock. A substituted item skips the original recipe. Insufficient stock blocks fulfillment. Stock is recorded to 0.001 units.'),
                  const SizedBox(height: 12),
                  if (widget.stockItems
                      .where((item) => item['active'] == true)
                      .isEmpty)
                    const Text(
                        'Add active stock items before configuring this recipe.'),
                  for (var index = 0; index < _lines.length; index++)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Column(children: [
                        DropdownButtonFormField<String>(
                          initialValue: _lines[index].stockItemId,
                          isExpanded: true,
                          decoration: const InputDecoration(
                              labelText: 'Stock ingredient'),
                          items: [
                            for (final item in widget.stockItems.where((item) =>
                                item['active'] == true ||
                                item['id'] == _lines[index].stockItemId))
                              DropdownMenuItem(
                                value: item['id'] as String,
                                child: Text(
                                  '${item['name']} · ${item['onHand']} ${item['unit']}${item['locationName'] is String ? ' · ${item['locationName']}' : ' · venue'}',
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                          ],
                          onChanged: _saving
                              ? null
                              : (value) => setState(
                                  () => _lines[index].stockItemId = value),
                        ),
                        Row(children: [
                          SizedBox(
                            width: 150,
                            child: TextField(
                              controller: _lines[index].quantity,
                              enabled: !_saving,
                              keyboardType:
                                  const TextInputType.numberWithOptions(
                                      decimal: true),
                              decoration: const InputDecoration(
                                  labelText: 'Qty per unit'),
                            ),
                          ),
                          IconButton(
                            tooltip: 'Remove ingredient',
                            onPressed: _saving
                                ? null
                                : () => setState(() {
                                      _lines.removeAt(index).quantity.dispose();
                                    }),
                            icon: const Icon(Icons.remove_circle_outline),
                          ),
                        ]),
                      ]),
                    ),
                  TextButton.icon(
                    onPressed: _saving ||
                            widget.stockItems
                                .where((item) => item['active'] == true)
                                .isEmpty
                        ? null
                        : () {
                            final used =
                                _lines.map((line) => line.stockItemId).toSet();
                            Map<String, dynamic>? next;
                            for (final item in widget.stockItems) {
                              if (item['active'] == true &&
                                  !used.contains(item['id'])) {
                                next = item;
                                break;
                              }
                            }
                            final selected = next;
                            if (selected == null) {
                              setState(() => _error =
                                  'Each stock item can appear only once in a recipe.');
                              return;
                            }
                            setState(() {
                              _error = null;
                              _lines.add(_RecipeIngredientDraft(
                                stockItemId: selected['id'] as String,
                                quantity: TextEditingController(),
                              ));
                            });
                          },
                    icon: const Icon(Icons.add),
                    label: const Text('Add ingredient'),
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
        ),
        actions: [
          TextButton(
              onPressed: _saving ? null : () => Navigator.pop(context),
              child: const Text('Cancel')),
          FilledButton.icon(
            onPressed: _saving ? null : _save,
            icon: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.save_outlined),
            label: const Text('Save recipe'),
          ),
        ],
      );

  Future<void> _save() async {
    final ids = <String>{};
    final lines = <Map<String, Object?>>[];
    for (final line in _lines) {
      final id = line.stockItemId;
      final quantity = double.tryParse(line.quantity.text.trim());
      if (id == null || !ids.add(id) || quantity == null || quantity <= 0) {
        setState(() => _error =
            'Choose a different active stock item for each line and enter a positive quantity.');
        return;
      }
      lines.add({'stockItemId': id, 'quantityPerMenuUnit': quantity});
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(operationsApiProvider)
          .setHospitalityMenuRecipe(widget.venueId, widget.itemId, lines);
      ref.invalidate(hospitalityRecipeProvider(
          (venueId: widget.venueId, itemId: widget.itemId)));
      if (mounted) Navigator.pop(context);
    } catch (error) {
      if (mounted) setState(() => _error = 'Could not save recipe: $error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

class _RecipeIngredientDraft {
  _RecipeIngredientDraft({required this.stockItemId, required this.quantity});
  String? stockItemId;
  final TextEditingController quantity;
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
