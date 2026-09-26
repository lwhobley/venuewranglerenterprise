import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'operations_api.dart';

class StaffingScheduleGrid extends StatefulWidget {
  const StaffingScheduleGrid(
      {super.key,
      required this.api,
      required this.eventId,
      required this.shifts,
      required this.locations,
      required this.serviceAreas,
      required this.people,
      required this.canWrite,
      required this.canShare,
      required this.onChanged,
      this.savedViews});
  final OperationsApi api;
  final String eventId;
  final List<Map<String, dynamic>> shifts;
  final List<Map<String, dynamic>> locations;
  final List<Map<String, dynamic>> serviceAreas;
  final List<Map<String, dynamic>> people;
  final bool canWrite;
  final bool canShare;
  final VoidCallback onChanged;
  final List<Map<String, dynamic>>? savedViews;

  @override
  State<StaffingScheduleGrid> createState() => _StaffingScheduleGridState();
}

class _StaffingScheduleGridState extends State<StaffingScheduleGrid> {
  late Future<List<Map<String, dynamic>>> _views = _loadViews();
  String? _viewId;
  String? _role;
  String? _areaId;
  String? _worker;
  DateTime? _day;
  final Set<String> _selected = {};
  int _focusIndex = 0;
  bool _busy = false;

  @override
  void didUpdateWidget(covariant StaffingScheduleGrid oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.eventId != widget.eventId) {
      _selected.clear();
      _viewId = null;
      _role = null;
      _areaId = null;
      _worker = null;
      _day = null;
      _views = _loadViews();
    }
  }

  Future<List<Map<String, dynamic>>> _loadViews() => widget.savedViews == null
      ? widget.api.scheduleViews(widget.eventId)
      : Future.value(widget.savedViews!);

  String? _areaFor(Map<String, dynamic> shift) {
    final location = widget.locations
        .where((item) => item['id'] == shift['locationId'])
        .firstOrNull;
    return location?['serviceAreaId'] as String?;
  }

  String _personName(String? subject) => subject == null
      ? 'Open'
      : widget.people
              .where((item) => item['externalSubject'] == subject)
              .firstOrNull?['displayName'] as String? ??
          subject;

  List<Map<String, dynamic>> get _visible => widget.shifts
      .where((shift) =>
          (_role == null || shift['role'] == _role) &&
          (_areaId == null || _areaFor(shift) == _areaId) &&
          (_worker == null || shift['assignedSubject'] == _worker) &&
          (_day == null ||
              (() {
                final start =
                    DateTime.tryParse(shift['startsAt'] as String? ?? '')
                        ?.toUtc();
                return start != null &&
                    start.year == _day!.year &&
                    start.month == _day!.month &&
                    start.day == _day!.day;
              })()))
      .toList()
    ..sort((a, b) => (a['startsAt'] as String? ?? '')
        .compareTo(b['startsAt'] as String? ?? ''));

  @override
  Widget build(BuildContext context) {
    final roles = widget.shifts
        .map((item) => item['role'])
        .whereType<String>()
        .toSet()
        .toList()
      ..sort();
    final visible = _visible;
    if (_focusIndex >= visible.length) _focusIndex = 0;
    final focused = visible.isEmpty ? null : visible[_focusIndex];
    return CallbackShortcuts(
        bindings: {
          const SingleActivator(LogicalKeyboardKey.arrowDown): () => _moveFocus(1, visible.length),
          const SingleActivator(LogicalKeyboardKey.arrowUp): () => _moveFocus(-1, visible.length),
          const SingleActivator(LogicalKeyboardKey.space): () => _toggleFocused(focused),
        },
        child: Focus(
            autofocus: true,
            child: SingleChildScrollView(
        child: Card(
            child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            const Text('Schedule grid',
                                style: TextStyle(
                                    fontSize: 20, fontWeight: FontWeight.w800)),
                            Text(
                                focused == null
                                    ? 'No shifts in this view'
                                    : 'Focused shift ${_focusIndex + 1} of ${visible.length}: ${focused['role'] ?? 'Role'}',
                                key: const Key('schedule-grid-focus')),
                            FutureBuilder<List<Map<String, dynamic>>>(
                                future: _views,
                                builder: (context, snapshot) {
                                  final rows = snapshot.data ??
                                      const <Map<String, dynamic>>[];
                                  return DropdownButton<String?>(
                                    value: rows.any(
                                            (item) => item['id'] == _viewId)
                                        ? _viewId
                                        : null,
                                    hint: const Text('Saved views'),
                                    items: [
                                      const DropdownMenuItem<String?>(
                                          value: null,
                                          child: Text('Custom view')),
                                      ...rows.map((item) => DropdownMenuItem<
                                              String?>(
                                          value: item['id'] as String,
                                          child: Text(
                                              '${item['name']}${item['shared'] == true ? ' · shared' : ''}')))
                                    ],
                                    onChanged: (value) => setState(() {
                                      _viewId = value;
                                      final filters = rows
                                          .where((item) => item['id'] == value)
                                          .firstOrNull?['filters'] as Map?;
                                      _role = filters?['role'] as String?;
                                      _areaId =
                                          filters?['serviceAreaId'] as String?;
                                      _worker =
                                          filters?['workerSubject'] as String?;
                                      _day = DateTime.tryParse(
                                              filters?['from'] as String? ?? '')
                                          ?.toUtc();
                                      _selected.clear();
                                    }),
                                  );
                                }),
                            DropdownButton<String?>(
                                value: roles.contains(_role) ? _role : null,
                                hint: const Text('All roles'),
                                items: [
                                  const DropdownMenuItem<String?>(
                                      value: null, child: Text('All roles')),
                                  ...roles.map((role) =>
                                      DropdownMenuItem<String?>(
                                          value: role, child: Text(role)))
                                ],
                                onChanged: (value) => setState(() {
                                      _role = value;
                                      _viewId = null;
                                      _selected.clear();
                                    })),
                            DropdownButton<String?>(
                                value: widget.serviceAreas
                                        .any((item) => item['id'] == _areaId)
                                    ? _areaId
                                    : null,
                                hint: const Text('All areas'),
                                items: [
                                  const DropdownMenuItem<String?>(
                                      value: null, child: Text('All areas')),
                                  ...widget.serviceAreas.map((area) =>
                                      DropdownMenuItem<String?>(
                                          value: area['id'] as String,
                                          child: Text(area['name'] as String)))
                                ],
                                onChanged: (value) => setState(() {
                                      _areaId = value;
                                      _viewId = null;
                                      _selected.clear();
                                    })),
                            DropdownButton<String?>(
                                value: widget.people.any((item) =>
                                        item['externalSubject'] == _worker)
                                    ? _worker
                                    : null,
                                hint: const Text('All workers'),
                                items: [
                                  const DropdownMenuItem<String?>(
                                      value: null, child: Text('All workers')),
                                  ...widget.people.map((person) =>
                                      DropdownMenuItem<String?>(
                                          value: person['externalSubject']
                                              as String,
                                          child: Text(person['displayName']
                                                  as String? ??
                                              'Worker')))
                                ],
                                onChanged: (value) => setState(() {
                                      _worker = value;
                                      _viewId = null;
                                      _selected.clear();
                                    })),
                            TextButton.icon(
                                onPressed: () async {
                                  final picked = await showDatePicker(
                                      context: context,
                                      initialDate: _day ?? DateTime.now(),
                                      firstDate: DateTime(2020),
                                      lastDate: DateTime(2100));
                                  if (picked != null && mounted) {
                                    setState(() {
                                      _day = DateTime.utc(picked.year,
                                          picked.month, picked.day);
                                      _viewId = null;
                                      _selected.clear();
                                    });
                                  }
                                },
                                icon: const Icon(Icons.today_outlined),
                                label: Text(_day == null
                                    ? 'All UTC days'
                                    : '${_day!.month}/${_day!.day}/${_day!.year} UTC')),
                            if (_day != null)
                              IconButton(
                                  onPressed: () => setState(() {
                                        _day = null;
                                        _viewId = null;
                                        _selected.clear();
                                      }),
                                  tooltip: 'Clear day',
                                  icon: const Icon(Icons.close)),
                            OutlinedButton.icon(
                                onPressed: _saveView,
                                icon: const Icon(Icons.bookmark_add_outlined),
                                label: const Text('Save view')),
                            if (_viewId != null)
                              TextButton.icon(
                                  onPressed: _deleteView,
                                  icon: const Icon(Icons.delete_outline),
                                  label: const Text('Delete view')),
                            if (widget.canWrite && _selected.isNotEmpty)
                              PopupMenuButton<String>(
                                  enabled: !_busy,
                                  tooltip: 'Bulk actions',
                                  onSelected: _bulkAction,
                                  itemBuilder: (_) => const [
                                        PopupMenuItem(
                                            value: 'PUBLISH',
                                            child: Text('Publish selected')),
                                        PopupMenuItem(
                                            value: 'CANCEL',
                                            child: Text('Cancel selected')),
                                        PopupMenuItem(
                                            value: 'ASSIGN',
                                            child: Text('Assign selected')),
                                        PopupMenuItem(
                                            value: 'MOVE',
                                            child: Text('Move selected')),
                                      ],
                                  child: Chip(
                                      label: Text(
                                          '${_selected.length} selected · Actions'),
                                      avatar: const Icon(
                                          Icons.edit_calendar_outlined))),
                          ]),
                      const SizedBox(height: 8),
                      SizedBox(
                          height: 290,
                          child: SingleChildScrollView(
                              child: SingleChildScrollView(
                                  scrollDirection: Axis.horizontal,
                                  child: DataTable(
                                    columns: const [
                                      DataColumn(label: Text('Select')),
                                      DataColumn(label: Text('Date / time')),
                                      DataColumn(label: Text('Role')),
                                      DataColumn(
                                          label: Text('Area / location')),
                                      DataColumn(label: Text('Worker')),
                                      DataColumn(label: Text('State'))
                                    ],
                                     rows: visible.take(150).toList().asMap().entries.map((entry) {
                                       final shift = entry.value;
                                       final id = shift['id'] as String;
                                       final focusedRow = entry.key == _focusIndex;
                                      final location = widget.locations
                                          .where((item) =>
                                              item['id'] == shift['locationId'])
                                          .firstOrNull;
                                      final area = widget.serviceAreas
                                          .where((item) =>
                                              item['id'] ==
                                              location?['serviceAreaId'])
                                          .firstOrNull;
                                      final start = DateTime.tryParse(
                                          shift['startsAt'] as String? ?? '');
                                       return DataRow(
                                           selected: focusedRow,
                                           cells: [
                                        DataCell(Checkbox(
                                            value: _selected.contains(id),
                                            onChanged: widget.canWrite
                                                ? (value) => setState(() {
                                                      if (value == true) {
                                                        _selected.add(id);
                                                      } else {
                                                        _selected.remove(id);
                                                      }
                                                    })
                                                : null)),
                                        DataCell(Text(start == null
                                            ? 'Unknown'
                                            : '${start.month}/${start.day} ${start.hour.toString().padLeft(2, '0')}:${start.minute.toString().padLeft(2, '0')} UTC')),
                                        DataCell(Text(
                                            shift['role'] as String? ??
                                                'Role')),
                                        DataCell(Text(
                                            '${area?['name'] ?? 'No area'} · ${location?['name'] ?? 'Venue'}')),
                                        DataCell(Text(_personName(
                                            shift['assignedSubject']
                                                as String?))),
                                        DataCell(Text(
                                            '${shift['state'] ?? 'DRAFT'}${shift['response'] == 'DECLINED' ? ' · declined' : ''}${shift['attendance'] != 'NOT_STARTED' ? ' · started' : ''}')),
                                      ]);
                                    }).toList(),
                                  )))),
                      if (visible.length > 150)
                        Text(
                            'Showing the first 150 of ${visible.length} shifts. Narrow the view to see more.'),
                      ]))))));
  }

  void _moveFocus(int delta, int length) {
    if (length == 0) return;
    setState(() => _focusIndex = (_focusIndex + delta + length) % length);
  }

  void _toggleFocused(Map<String, dynamic>? shift) {
    if (!widget.canWrite || shift == null) return;
    final id = shift['id'] as String;
    setState(() {
      if (_selected.contains(id)) {
        _selected.remove(id);
      } else {
        _selected.add(id);
      }
    });
  }

  Future<void> _saveView() async {
    final name = TextEditingController();
    var shared = false;
    final result = await showDialog<(String, bool)>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
            builder: (context, setDialogState) => AlertDialog(
                  title: const Text('Save schedule view'),
                  content: Column(mainAxisSize: MainAxisSize.min, children: [
                    TextField(
                        controller: name,
                        maxLength: 80,
                        decoration:
                            const InputDecoration(labelText: 'View name')),
                    if (widget.canShare)
                      SwitchListTile(
                          title: const Text('Share with venue'),
                          value: shared,
                          onChanged: (value) =>
                              setDialogState(() => shared = value)),
                  ]),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(dialogContext),
                        child: const Text('Cancel')),
                    FilledButton(
                        onPressed: () => Navigator.pop(
                            dialogContext, (name.text.trim(), shared)),
                        child: const Text('Save'))
                  ],
                )));
    name.dispose();
    if (!mounted || result == null) return;
    try {
      await widget.api
          .createScheduleView(widget.eventId, result.$1, result.$2, {
        if (_role != null) 'role': _role,
        if (_areaId != null) 'serviceAreaId': _areaId,
        if (_worker != null) 'workerSubject': _worker,
        if (_day != null) 'from': _day!.toIso8601String(),
        if (_day != null)
          'to': _day!.add(const Duration(days: 1)).toIso8601String(),
      });
      if (mounted) {
        setState(() => _views = widget.api.scheduleViews(widget.eventId));
      }
    } catch (error) {
      _showError(error);
    }
  }

  Future<void> _deleteView() async {
    final id = _viewId;
    if (id == null) return;
    try {
      await widget.api.deleteScheduleView(widget.eventId, id);
      if (mounted) {
        setState(() {
          _viewId = null;
      _views = _loadViews();
        });
      }
    } catch (error) {
      _showError(error);
    }
  }

  Future<void> _bulkAction(String action) async {
    if (_selected.isEmpty) return;
    final input = <String, Object?>{
      'action': action,
      'shiftIds': _selected.toList()
    };
    if (action == 'ASSIGN') {
      final subject = await showDialog<String>(
          context: context,
          builder: (dialogContext) => SimpleDialog(
              title: const Text('Assign selected shifts to'),
              children: widget.people
                  .map((person) => SimpleDialogOption(
                      onPressed: () => Navigator.pop(
                          dialogContext, person['externalSubject'] as String),
                      child:
                          Text(person['displayName'] as String? ?? 'Person')))
                  .toList()));
      if (subject == null) return;
      input['assignedSubject'] = subject;
    }
    if (action == 'MOVE') {
      if (!mounted) return;
      final start = TextEditingController();
      final end = TextEditingController();
      final values = await showDialog<(String, String)>(
          context: context,
          builder: (dialogContext) => AlertDialog(
                title: const Text('Move selected shifts'),
                content: Column(mainAxisSize: MainAxisSize.min, children: [
                  TextField(
                      controller: start,
                      decoration: const InputDecoration(
                          labelText: 'New start ISO time',
                          hintText: '2026-09-26T18:00:00Z')),
                  TextField(
                      controller: end,
                      decoration: const InputDecoration(
                          labelText: 'New end ISO time',
                          hintText: '2026-09-26T22:00:00Z')),
                ]),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(dialogContext),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(
                          dialogContext, (start.text.trim(), end.text.trim())),
                      child: const Text('Review'))
                ],
              ));
      start.dispose();
      end.dispose();
      if (values == null) return;
      if (values.$1.isNotEmpty) input['startsAt'] = values.$1;
      if (values.$2.isNotEmpty) input['endsAt'] = values.$2;
    }
    setState(() => _busy = true);
    try {
      final preview = await widget.api.previewBulkShifts(widget.eventId, input);
      if (!mounted) return;
      final unavailable =
          preview.where((item) => item['ready'] != true).toList();
      final approved = await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
                title: Text('$action ${_selected.length} shifts?'),
                content: Text(
                    '${preview.length - unavailable.length} pass current state checks. ${unavailable.length} have an immediate conflict. Availability, qualifications, rest, and overlap rules are checked again for each write. Successful items remain applied if another item fails.'),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(dialogContext),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(dialogContext, true),
                      child: const Text('Apply'))
                ],
              ));
      if (approved != true) return;
      final result = await widget.api.bulkShifts(widget.eventId, input);
      final failed = (result['results'] as List? ?? const [])
          .whereType<Map>()
          .where((row) => row['status'] == 'FAILED')
          .map((row) => row['shiftId'] as String)
          .toSet();
      if (mounted) {
        setState(() {
          _selected
            ..clear()
            ..addAll(failed);
        });
        widget.onChanged();
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(
                '${result['applied']} applied · ${result['failed']} failed. Failed shifts remain selected for review.')));
      }
    } catch (error) {
      _showError(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _showError(Object error) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Schedule action failed: $error')));
    }
  }
}
