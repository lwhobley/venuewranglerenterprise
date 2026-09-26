import 'dart:convert';

import 'package:flutter/material.dart';
import 'operations_api.dart';

class IntegrationAdminPage extends StatefulWidget {
  const IntegrationAdminPage(
      {super.key,
      required this.api,
      required this.venues,
      required this.events,
      required this.locations});

  final OperationsApi api;
  final List<Map<String, dynamic>> venues;
  final List<Map<String, dynamic>> events;
  final List<Map<String, dynamic>> locations;

  @override
  State<IntegrationAdminPage> createState() => _IntegrationAdminPageState();
}

class _IntegrationAdminPageState extends State<IntegrationAdminPage> {
  late Future<
      ({
        List<Map<String, dynamic>> sources,
        List<Map<String, dynamic>> mappings,
        List<Map<String, dynamic>> transforms
      })> _loaded = _load();

  Future<
      ({
        List<Map<String, dynamic>> sources,
        List<Map<String, dynamic>> mappings,
        List<Map<String, dynamic>> transforms
      })> _load() async {
    final sources = await widget.api.integrationSources();
    final mappings = await widget.api.integrationIdentifiers();
    final transforms = await widget.api.integrationTransforms();
    return (sources: sources, mappings: mappings, transforms: transforms);
  }

  void _refresh() => setState(() => _loaded = _load());

  Future<void> _poll(String sourceId) async {
    try {
      await widget.api.pollIntegrationSource(sourceId);
      _refresh();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Could not poll source: $error')));
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('External systems'), actions: [
          IconButton(
              tooltip: 'Refresh',
              onPressed: _refresh,
              icon: const Icon(Icons.refresh)),
        ]),
        body: FutureBuilder(
          future: _loaded,
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return Center(
                  child:
                      Text('Could not load integrations: ${snapshot.error}'));
            }
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final data = snapshot.data!;
            return ListView(padding: const EdgeInsets.all(16), children: [
              const Text('Configured sources',
                  style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              const Text(
                  'Each source is bound to this organization. Credentials are managed in the server secret store and are never shown here.'),
              const SizedBox(height: 12),
              if (data.sources.isEmpty)
                const Card(
                    child: ListTile(
                        title: Text('No external source configured'),
                        subtitle: Text(
                            'A deploy administrator must configure a source and credential before mappings can be added.'))),
              ...data.sources.map((source) {
                final latest = data.transforms
                    .where((item) => item['source'] == source['id'])
                    .firstOrNull;
                return Card(
                    child: ListTile(
                  leading: const Icon(Icons.hub_outlined),
                  title: Text(source['id'] as String? ?? 'Source'),
                  subtitle: Text(
                      'Credential configured${source['credentialVersion'] == null ? '' : ' · version ${source['credentialVersion']}'} · ${source['eventsLast24Hours']} events in 24h · ${source['pollConfigured'] == true ? 'poll ${source['pollStatus']}' : 'webhook only'} · ${source['openDeadLetters'] ?? 0} open dead letters · ${latest == null ? 'no raw transform' : 'transform v${latest['version']}'}'),
                  trailing: Wrap(spacing: 8, children: [
                    if (source['pollConfigured'] == true)
                      TextButton(
                        onPressed: () => _poll(source['id'] as String),
                        child: const Text('Poll'),
                      ),
                    TextButton(
                      onPressed: () =>
                          _configureTransform(source['id'] as String, latest),
                      child: const Text('Configure transform'),
                    ),
                  ]),
                ));
              }),
              const SizedBox(height: 20),
              Row(children: [
                const Expanded(
                    child: Text('Identifier mappings',
                        style: TextStyle(
                            fontSize: 21, fontWeight: FontWeight.w800))),
                FilledButton.icon(
                  onPressed: data.sources.isEmpty
                      ? null
                      : () => _addMapping(data.sources),
                  icon: const Icon(Icons.add),
                  label: const Text('Add mapping'),
                ),
              ]),
              const SizedBox(height: 6),
              const Text(
                  'External venue, event, and location IDs resolve to your existing Venue Wrangler records. Mappings cannot silently change targets.'),
              const SizedBox(height: 8),
              if (data.mappings.isEmpty)
                const Card(
                    child: ListTile(title: Text('No identifiers mapped yet'))),
              ...data.mappings.map((mapping) => Card(
                      child: ListTile(
                    leading: const Icon(Icons.link_outlined),
                    title: Text(
                        '${mapping['source']} · ${mapping['kind']} · ${mapping['externalId']}'),
                    subtitle: Text(_targetLabel(mapping['kind'] as String?,
                        mapping['internalId'] as String?)),
                    trailing: TextButton(
                        onPressed: () => _correctMapping(mapping),
                        child: const Text('Correct')),
                  ))),
              const SizedBox(height: 20),
              OutlinedButton.icon(
                onPressed:
                    data.sources.isEmpty ? null : () => _preview(data.sources),
                icon: const Icon(Icons.fact_check_outlined),
                label: const Text('Validate sample event'),
              ),
              const SizedBox(height: 6),
              const Text(
                  'Validation resolves identifiers and checks the event shape without recording or changing any operational data.'),
            ]);
          },
        ),
      );

  String _targetLabel(String? kind, String? id) {
    final records = switch (kind) {
      'VENUE' => widget.venues,
      'EVENT' => widget.events,
      'LOCATION' => widget.locations,
      _ => <Map<String, dynamic>>[],
    };
    for (final record in records) {
      if (record['id'] == id) return '${record['name']} · $id';
    }
    return id ?? 'Unknown target';
  }

  Future<void> _configureTransform(
      String source, Map<String, dynamic>? latest) async {
    final example = {
      'externalId': {'path': 'id'},
      'eventType': {'literal': 'operations.task.upserted'},
      'occurredAt': {'path': 'timestamp'},
      'externalEventId': {'path': 'event.id'},
      'payload': {
        'externalTaskId': {'path': 'task.id'},
        'kind': {'literal': 'STAFFING'},
        'title': {'path': 'task.title'},
      },
    };
    final definition = TextEditingController(
        text: const JsonEncoder.withIndent('  ')
            .convert(latest?['definition'] ?? example));
    final raw = TextEditingController(
        text: const JsonEncoder.withIndent('  ').convert({
      'id': 'record-1',
      'timestamp': '2026-09-26T18:00:00Z',
      'event': {'id': 'mapped-event-id'},
      'task': {'id': 'task-1', 'title': 'Sample coverage'},
    }));
    final choice = await showDialog<(String, String, String)>(
        context: context,
        builder: (dialogContext) => AlertDialog(
              title: Text('Transform raw records · $source'),
              content: SizedBox(
                  width: 620,
                  height: 500,
                  child: ListView(children: [
                    const Text(
                        'Use fixed values or safe dot-separated paths. A new save creates an immutable version; incoming raw records use the latest version.'),
                    TextField(
                        controller: definition,
                        maxLines: 13,
                        decoration: const InputDecoration(
                            labelText: 'Transform definition JSON',
                            border: OutlineInputBorder())),
                    const SizedBox(height: 12),
                    TextField(
                        controller: raw,
                        maxLines: 7,
                        decoration: const InputDecoration(
                            labelText: 'Sample raw record JSON',
                            border: OutlineInputBorder())),
                  ])),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(dialogContext),
                    child: const Text('Cancel')),
                OutlinedButton(
                    onPressed: () => Navigator.pop(
                        dialogContext, ('preview', definition.text, raw.text)),
                    child: const Text('Preview')),
                FilledButton(
                    onPressed: () => Navigator.pop(
                        dialogContext, ('save', definition.text, raw.text)),
                    child: const Text('Save version')),
              ],
            ));
    definition.dispose();
    raw.dispose();
    if (!mounted || choice == null) return;
    try {
      final parsed = jsonDecode(choice.$2);
      if (parsed is! Map<String, dynamic>) {
        throw const FormatException(
            'Transform definition must be a JSON object.');
      }
      if (choice.$1 == 'save') {
        await widget.api.saveIntegrationTransform(source, parsed);
        if (mounted) _refresh();
      } else {
        final record = jsonDecode(choice.$3);
        if (record is! Map<String, dynamic>) {
          throw const FormatException('Raw sample must be a JSON object.');
        }
        final result =
            await widget.api.previewRawIntegration(source, parsed, record);
        if (mounted) {
          await showDialog<void>(
              context: context,
              builder: (dialogContext) => AlertDialog(
                    title: const Text('Transform preview'),
                    content: SizedBox(
                        width: 520,
                        child: SingleChildScrollView(
                            child: SelectableText(
                                const JsonEncoder.withIndent('  ')
                                    .convert(result)))),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(dialogContext),
                          child: const Text('Done'))
                    ],
                  ));
        }
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Transform rejected: $error')));
      }
    }
  }

  Future<void> _correctMapping(Map<String, dynamic> mapping) async {
    try {
      final mappingId = mapping['id'] as String;
      final impact = await widget.api.integrationIdentifierImpact(mappingId);
      if (!mounted) return;
      final targets = switch (mapping['kind']) {
        'VENUE' => widget.venues,
        'EVENT' => widget.events,
        _ => widget.locations,
      };
      String? targetId;
      final reason = TextEditingController();
      final correction = await showDialog<(String, String)>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
            builder: (dialogContext, setDialogState) => AlertDialog(
                  title: const Text('Correct identifier mapping'),
                  content: SizedBox(
                      width: 480,
                      child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                                'Current: ${_targetLabel(mapping['kind'] as String?, mapping['internalId'] as String?)}'),
                            Text(
                                'Existing activity at this target: ${impact['eventCount']} events and ${impact['taskCount']} tasks.'),
                            const SizedBox(height: 8),
                            const Text(
                                'Historical records stay where they were recorded. Future signed events will use the new target.'),
                            DropdownButtonFormField<String>(
                              decoration: const InputDecoration(
                                  labelText: 'New target'),
                              items: targets
                                  .where((item) =>
                                      item['id'] != mapping['internalId'])
                                  .map((item) => DropdownMenuItem(
                                      value: item['id'] as String,
                                      child: Text(
                                          item['name'] as String? ?? 'Record')))
                                  .toList(),
                              onChanged: (value) =>
                                  setDialogState(() => targetId = value),
                            ),
                            TextField(
                                controller: reason,
                                maxLength: 500,
                                decoration: const InputDecoration(
                                    labelText: 'Reason for correction')),
                          ])),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(dialogContext),
                        child: const Text('Cancel')),
                    FilledButton(
                        onPressed: targetId == null
                            ? null
                            : () => Navigator.pop(
                                dialogContext, (targetId!, reason.text.trim())),
                        child: const Text('Correct mapping')),
                  ],
                )),
      );
      reason.dispose();
      if (!mounted || correction == null) return;
      await widget.api.correctIntegrationIdentifier(mappingId, {
        'expectedInternalId': mapping['internalId'],
        'newInternalId': correction.$1,
        'reason': correction.$2,
        'observedCount': impact['observedCount'],
      });
      if (mounted) _refresh();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Could not correct mapping: $error')));
      }
    }
  }

  Future<void> _addMapping(List<Map<String, dynamic>> sources) async {
    final externalId = TextEditingController();
    var source = sources.first['id'] as String;
    var kind = 'VENUE';
    String? targetId = widget.venues.firstOrNull?['id'] as String?;
    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (context) => StatefulBuilder(builder: (context, setDialogState) {
        final targets = switch (kind) {
          'VENUE' => widget.venues,
          'EVENT' => widget.events,
          _ => widget.locations,
        };
        return AlertDialog(
          title: const Text('Map external identifier'),
          content: SizedBox(
              width: 450,
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                DropdownButtonFormField<String>(
                  initialValue: source,
                  decoration: const InputDecoration(labelText: 'Source'),
                  items: sources
                      .map((row) => DropdownMenuItem(
                          value: row['id'] as String,
                          child: Text(row['id'] as String)))
                      .toList(),
                  onChanged: (value) =>
                      setDialogState(() => source = value ?? source),
                ),
                DropdownButtonFormField<String>(
                  initialValue: kind,
                  decoration: const InputDecoration(labelText: 'Record type'),
                  items: const ['VENUE', 'EVENT', 'LOCATION']
                      .map((value) =>
                          DropdownMenuItem(value: value, child: Text(value)))
                      .toList(),
                  onChanged: (value) => setDialogState(() {
                    kind = value ?? kind;
                    targetId = switch (kind) {
                      'VENUE' => widget.venues.firstOrNull?['id'] as String?,
                      'EVENT' => widget.events.firstOrNull?['id'] as String?,
                      _ => widget.locations.firstOrNull?['id'] as String?,
                    };
                  }),
                ),
                TextField(
                    controller: externalId,
                    decoration:
                        const InputDecoration(labelText: 'External ID')),
                DropdownButtonFormField<String>(
                  key: ValueKey(kind),
                  initialValue: targetId,
                  decoration:
                      const InputDecoration(labelText: 'Venue Wrangler record'),
                  items: targets
                      .map((row) => DropdownMenuItem(
                          value: row['id'] as String,
                          child: Text(row['name'] as String? ?? 'Record')))
                      .toList(),
                  onChanged: (value) => setDialogState(() => targetId = value),
                ),
              ])),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Cancel')),
            FilledButton(
              onPressed: () => Navigator.pop(context, {
                'source': source,
                'kind': kind,
                'externalId': externalId.text.trim(),
                'internalId': targetId ?? '',
              }),
              child: const Text('Save mapping'),
            ),
          ],
        );
      }),
    );
    externalId.dispose();
    if (!mounted || result == null) return;
    if (result['externalId']!.isEmpty || result['internalId']!.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Choose a record and enter its external ID.')));
      return;
    }
    try {
      await widget.api.putIntegrationIdentifier(result);
      if (mounted) _refresh();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Could not save mapping: $error')));
      }
    }
  }

  Future<void> _preview(List<Map<String, dynamic>> sources) async {
    var source = sources.first['id'] as String;
    final sample = TextEditingController(
        text: const JsonEncoder.withIndent('  ').convert({
      'externalEventId': 'your-event-id',
      'externalId': 'sample-record-1',
      'eventType': 'operations.task.upserted',
      'occurredAt': '2026-09-26T18:00:00Z',
      'payload': {
        'externalTaskId': 'sample-task-1',
        'kind': 'STAFFING',
        'title': 'Sample shift coverage'
      },
    }));
    final result = await showDialog<(String, String)>(
      context: context,
      builder: (context) => StatefulBuilder(
          builder: (context, setDialogState) => AlertDialog(
                title: const Text('Validate sample event'),
                content: SizedBox(
                    width: 560,
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      DropdownButtonFormField<String>(
                        initialValue: source,
                        decoration: const InputDecoration(labelText: 'Source'),
                        items: sources
                            .map((row) => DropdownMenuItem(
                                value: row['id'] as String,
                                child: Text(row['id'] as String)))
                            .toList(),
                        onChanged: (value) =>
                            setDialogState(() => source = value ?? source),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                          controller: sample,
                          maxLines: 12,
                          decoration: const InputDecoration(
                              labelText: 'Normalized JSON event',
                              border: OutlineInputBorder())),
                    ])),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () =>
                          Navigator.pop(context, (source, sample.text)),
                      child: const Text('Validate')),
                ],
              )),
    );
    sample.dispose();
    if (!mounted || result == null) return;
    try {
      final decoded = jsonDecode(result.$2);
      if (decoded is! Map<String, dynamic>) {
        throw const FormatException('Enter a JSON object.');
      }
      final outcome =
          await widget.api.previewIntegrationEvent(result.$1, decoded);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content:
                Text('Valid: event ${outcome['eventId']} · no data written')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Sample rejected: $error')));
      }
    }
  }
}
