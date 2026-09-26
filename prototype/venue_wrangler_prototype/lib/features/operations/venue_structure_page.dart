import 'package:flutter/material.dart';
import 'operations_api.dart';

class VenueStructurePage extends StatefulWidget {
  const VenueStructurePage(
      {super.key,
      required this.api,
      required this.venueId,
      required this.venueName,
      required this.isTenantAdmin});
  final OperationsApi api;
  final String venueId;
  final String venueName;
  final bool isTenantAdmin;

  @override
  State<VenueStructurePage> createState() => _VenueStructurePageState();
}

class _VenueStructurePageState extends State<VenueStructurePage> {
  late Future<Map<String, dynamic>> _structure =
      widget.api.venueStructure(widget.venueId);
  late Future<List<Map<String, dynamic>>> _templates =
      widget.api.venueTemplates();
  late Future<Map<String, dynamic>> _onboarding =
      widget.api.venueOnboarding(widget.venueId);

  void _refresh() => setState(() {
        _structure = widget.api.venueStructure(widget.venueId);
        _templates = widget.api.venueTemplates();
        _onboarding = widget.api.venueOnboarding(widget.venueId);
      });

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text('${widget.venueName} structure'), actions: [
          IconButton(
              onPressed: _refresh,
              tooltip: 'Refresh',
              icon: const Icon(Icons.refresh)),
        ]),
        body: FutureBuilder<Map<String, dynamic>>(
          future: _structure,
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return Center(
                  child: Text(
                      'Could not load venue structure: ${snapshot.error}'));
            }
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final data = snapshot.data!;
            final departments = _rows(data['departments']);
            final areas = _rows(data['serviceAreas']);
            final locations = _rows(data['locations']);
            return ListView(padding: const EdgeInsets.all(16), children: [
              FutureBuilder<Map<String, dynamic>>(
                future: _onboarding,
                builder: (context, snapshot) {
                  if (snapshot.hasError) {
                    return Text(
                        'Onboarding checklist unavailable: ${snapshot.error}');
                  }
                  if (!snapshot.hasData) return const LinearProgressIndicator();
                  final checks = _rows(snapshot.data!['checks']);
                  return Card(
                      child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('Onboarding checklist',
                                    style: TextStyle(
                                        fontSize: 21,
                                        fontWeight: FontWeight.w800)),
                                ...checks.map((check) => ListTile(
                                      dense: true,
                                      leading: Icon(
                                          check['passed'] == true
                                              ? Icons.check_circle_outline
                                              : Icons.radio_button_unchecked,
                                          color: check['passed'] == true
                                              ? Colors.green
                                              : null),
                                      title: Text(
                                          check['label'] as String? ?? 'Check'),
                                      subtitle:
                                          check['requiredForActivation'] == true
                                              ? const Text(
                                                  'Required for activation')
                                              : null,
                                    )),
                                OutlinedButton.icon(
                                    onPressed: _previewSampleEvent,
                                    icon: const Icon(
                                        Icons.event_available_outlined),
                                    label: const Text(
                                        'Preview sample event time')),
                              ])));
                },
              ),
              const SizedBox(height: 16),
              const Text('Departments',
                  style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800)),
              const Text(
                  'Use stable codes so templates and external systems can refer to the same department.'),
              ...departments.map((row) => Card(
                  child: ListTile(
                      title: Text(row['name'] as String),
                      subtitle: Text(row['code'] as String)))),
              OutlinedButton.icon(
                  onPressed: _addDepartment,
                  icon: const Icon(Icons.add),
                  label: const Text('Add department')),
              const SizedBox(height: 20),
              const Text('Service areas',
                  style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800)),
              const Text(
                  'Areas group operational locations. Location-based work inherits its area and department.'),
              ...areas.map((row) {
                final department = departments
                    .where((item) => item['id'] == row['departmentId'])
                    .firstOrNull;
                return Card(
                    child: ListTile(
                  title: Text(row['name'] as String),
                  subtitle: Text(
                      '${row['code']}${department == null ? '' : ' · ${department['name']}'}'),
                ));
              }),
              OutlinedButton.icon(
                  onPressed: () => _addArea(departments),
                  icon: const Icon(Icons.add),
                  label: const Text('Add service area')),
              const SizedBox(height: 20),
              const Text('Location assignments',
                  style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800)),
              ...locations.map((row) => Card(
                      child: ListTile(
                    title: Text(row['name'] as String),
                    subtitle: Text(areas
                            .where((item) => item['id'] == row['serviceAreaId'])
                            .firstOrNull?['name'] as String? ??
                        'No service area'),
                    trailing: PopupMenuButton<String>(
                      tooltip: 'Assign service area',
                      onSelected: (id) =>
                          _setArea(row['id'] as String, id.isEmpty ? null : id),
                      itemBuilder: (_) => [
                        const PopupMenuItem<String>(
                            value: '', child: Text('No service area')),
                        ...areas.map((area) => PopupMenuItem<String>(
                            value: area['id'] as String,
                            child: Text(area['name'] as String))),
                      ],
                    ),
                  ))),
              if (locations.isEmpty)
                const Card(
                    child: ListTile(
                        title: Text('Add locations in Venue setup first.'))),
              const SizedBox(height: 20),
              const Text('Venue templates',
                  style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800)),
              const Text(
                  'Capture a versioned layout, preview additions, then apply it without changing existing locations or events.'),
              if (widget.isTenantAdmin)
                OutlinedButton.icon(
                    onPressed: _captureTemplate,
                    icon: const Icon(Icons.bookmark_add_outlined),
                    label: const Text('Capture this venue as a template')),
              FutureBuilder<List<Map<String, dynamic>>>(
                future: _templates,
                builder: (context, snapshot) {
                  if (snapshot.hasError) {
                    return Text('Could not load templates: ${snapshot.error}');
                  }
                  if (!snapshot.hasData) return const LinearProgressIndicator();
                  if (snapshot.data!.isEmpty) {
                    return const Text('No templates captured yet.');
                  }
                  return Column(
                      children: snapshot.data!
                          .map((item) => Card(
                                  child: ListTile(
                                leading: const Icon(Icons.bookmark_outline),
                                title: Text(
                                    '${item['name']} · v${item['version']}'),
                                subtitle: Text(item['code'] as String),
                                trailing: TextButton(
                                  onPressed: () =>
                                      _previewTemplate(item['id'] as String),
                                  child: const Text('Preview'),
                                ),
                              )))
                          .toList());
                },
              ),
            ]);
          },
        ),
      );

  List<Map<String, dynamic>> _rows(Object? raw) => (raw as List? ?? const [])
      .whereType<Map>()
      .map((item) => Map<String, dynamic>.from(item))
      .toList();

  Future<(String, String)?> _nameAndCode(String title) async {
    final name = TextEditingController();
    final code = TextEditingController();
    final value = await showDialog<(String, String)>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: SizedBox(
            width: 420,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              TextField(
                  controller: name,
                  maxLength: 120,
                  decoration: const InputDecoration(labelText: 'Name')),
              TextField(
                  controller: code,
                  maxLength: 40,
                  decoration: const InputDecoration(
                      labelText: 'Stable code', hintText: 'GUEST_SERVICES')),
            ])),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(dialogContext,
                  (name.text.trim(), code.text.trim().toUpperCase())),
              child: const Text('Save')),
        ],
      ),
    );
    name.dispose();
    code.dispose();
    return value;
  }

  Future<void> _addDepartment() async {
    final value = await _nameAndCode('Add department');
    if (!mounted || value == null) return;
    try {
      await widget.api
          .createVenueDepartment(widget.venueId, value.$2, value.$1);
      if (mounted) _refresh();
    } catch (error) {
      _error(error);
    }
  }

  Future<void> _addArea(List<Map<String, dynamic>> departments) async {
    final value = await _nameAndCode('Add service area');
    if (!mounted || value == null) return;
    String? departmentId;
    if (departments.isNotEmpty) {
      departmentId = await showDialog<String?>(
          context: context,
          builder: (dialogContext) => SimpleDialog(
                title: const Text('Choose department'),
                children: [
                  SimpleDialogOption(
                      onPressed: () => Navigator.pop(dialogContext),
                      child: const Text('No department')),
                  ...departments.map((row) => SimpleDialogOption(
                      onPressed: () =>
                          Navigator.pop(dialogContext, row['id'] as String),
                      child: Text(row['name'] as String))),
                ],
              ));
    }
    if (!mounted) return;
    try {
      await widget.api.createVenueServiceArea(
          widget.venueId, value.$2, value.$1, departmentId);
      if (mounted) _refresh();
    } catch (error) {
      _error(error);
    }
  }

  Future<void> _setArea(String locationId, String? areaId) async {
    try {
      await widget.api.setLocationServiceArea(locationId, areaId);
      if (mounted) _refresh();
    } catch (error) {
      _error(error);
    }
  }

  Future<void> _previewSampleEvent() async {
    final time = TextEditingController();
    final selected = await showDialog<String>(
        context: context,
        builder: (dialogContext) => AlertDialog(
              title: const Text('Preview venue event time'),
              content: TextField(
                  controller: time,
                  decoration: const InputDecoration(
                      labelText: 'Venue wall time',
                      hintText: 'YYYY-MM-DDTHH:MM')),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(dialogContext),
                    child: const Text('Cancel')),
                FilledButton(
                    onPressed: () =>
                        Navigator.pop(dialogContext, time.text.trim()),
                    child: const Text('Preview'))
              ],
            ));
    time.dispose();
    if (!mounted || selected == null) return;
    try {
      final result =
          await widget.api.previewVenueEvent(widget.venueId, selected);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(
                '$selected ${result['timeZone']} resolves to ${result['startsAt']}. No event was created.')));
      }
    } catch (error) {
      _error(error);
    }
  }

  Future<void> _captureTemplate() async {
    final value = await _nameAndCode('Capture venue template');
    if (!mounted || value == null) return;
    try {
      await widget.api
          .captureVenueTemplate(widget.venueId, value.$2, value.$1, null);
      if (mounted) _refresh();
    } catch (error) {
      _error(error);
    }
  }

  Future<void> _previewTemplate(String templateId) async {
    try {
      final plan =
          await widget.api.previewVenueTemplate(templateId, widget.venueId);
      if (!mounted) return;
      final conflicts = (plan['conflicts'] as List? ?? const [])
          .map((item) => '$item')
          .toList();
      final accepted = await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
                title: const Text('Apply venue template?'),
                content: SizedBox(
                    width: 460,
                    child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                              '${(plan['addDepartments'] as List? ?? const []).length} departments, ${(plan['addServiceAreas'] as List? ?? const []).length} areas, and ${(plan['addLocations'] as List? ?? const []).length} locations will be added.'),
                          if (conflicts.isNotEmpty) ...[
                            const SizedBox(height: 12),
                            const Text(
                                'Resolve these conflicts before applying:'),
                            ...conflicts.map(Text.new),
                          ],
                          const SizedBox(height: 12),
                          const Text(
                              'Existing records and events will not be changed.'),
                        ])),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(dialogContext),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: conflicts.isEmpty
                          ? () => Navigator.pop(dialogContext, true)
                          : null,
                      child: const Text('Apply additions')),
                ],
              ));
      if (accepted != true || !mounted) return;
      await widget.api.applyVenueTemplate(templateId, widget.venueId);
      if (mounted) _refresh();
    } catch (error) {
      _error(error);
    }
  }

  void _error(Object error) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not save venue structure: $error')));
    }
  }
}
