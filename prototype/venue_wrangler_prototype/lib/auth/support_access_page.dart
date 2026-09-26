import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth.dart';
import '../features/operations/operations_api.dart';

class SupportAccessGate extends ConsumerStatefulWidget {
  const SupportAccessGate({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<SupportAccessGate> createState() => _SupportAccessGateState();
}

class _SupportAccessGateState extends ConsumerState<SupportAccessGate> {
  late Future<List<Map<String, dynamic>>> _venues;
  final _search = TextEditingController();
  final _reason = TextEditingController();
  Timer? _expiryTimer;
  String? _timerVenue;
  String? _selectedVenue;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _venues = ref.read(authRepositoryProvider).supportVenues();
    _search.addListener(_refreshSearch);
  }

  void _refreshSearch() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _expiryTimer?.cancel();
    _search.dispose();
    _reason.dispose();
    super.dispose();
  }

  void _scheduleExpiry(AuthSession session) {
    if (_timerVenue == session.supportVenueId) return;
    _expiryTimer?.cancel();
    _timerVenue = session.supportVenueId;
    final remaining =
        session.supportExpiresAt?.difference(DateTime.now().toUtc());
    if (remaining == null) return;
    _expiryTimer =
        Timer(remaining > Duration.zero ? remaining : Duration.zero, () {
      if (mounted) unawaited(_exit());
    });
  }

  Future<void> _enter() async {
    final venueId = _selectedVenue;
    if (venueId == null) {
      setState(() => _error = 'Choose a venue.');
      return;
    }
    if (_reason.text.trim().length < 10) {
      setState(() => _error = 'Enter a ticket number and support reason.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(authSessionProvider.notifier)
          .enterSupport(venueId, _reason.text.trim());
      ref.invalidate(operationsBootstrapProvider);
      _reason.clear();
    } catch (_) {
      if (mounted) {
        setState(() => _error =
            'Support access could not be opened. Check your authorization and try again.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _exit() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authSessionProvider.notifier).exitSupport();
      ref.invalidate(operationsBootstrapProvider);
      _expiryTimer?.cancel();
      _timerVenue = null;
      _selectedVenue = null;
      _venues = ref.read(authRepositoryProvider).supportVenues();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(authSessionProvider).session;
    if (session?.supportVenueId != null) {
      _scheduleExpiry(session!);
      return Column(children: [
        Material(
          color: const Color(0xFFFFE8BE),
          child: SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: Row(children: [
                const Icon(Icons.admin_panel_settings_outlined, size: 22),
                const SizedBox(width: 8),
                Expanded(
                    child: Text(
                        'Technical support · ${session.supportOrganizationName} / ${session.supportVenueName}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis)),
                TextButton(
                    onPressed: _busy ? null : _exit,
                    child: const Text('Exit venue')),
              ]),
            ),
          ),
        ),
        Expanded(child: widget.child),
      ]);
    }
    _expiryTimer?.cancel();
    _timerVenue = null;
    return Scaffold(
      appBar: AppBar(title: const Text('Technical support'), actions: [
        TextButton(
            onPressed: () => ref.read(authSessionProvider.notifier).signOut(),
            child: const Text('Sign out')),
      ]),
      body: FutureBuilder<List<Map<String, dynamic>>>(
        future: _venues,
        builder: (context, snapshot) {
          if (!snapshot.hasData && !snapshot.hasError) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(
                child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                const Text(
                    'Support venue list is unavailable for this account.'),
                const SizedBox(height: 12),
                OutlinedButton(
                    onPressed: () => setState(() => _venues =
                        ref.read(authRepositoryProvider).supportVenues()),
                    child: const Text('Retry')),
              ]),
            ));
          }
          final search = _search.text.trim().toLowerCase();
          final venues = snapshot.data!
              .where((venue) =>
                  search.isEmpty ||
                  '${venue['organizationName']} ${venue['name']}'
                      .toLowerCase()
                      .contains(search))
              .toList();
          return Center(
              child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: ListView(padding: const EdgeInsets.all(20), children: [
              Text('Choose a venue',
                  style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 6),
              const Text(
                  'Access lasts 15 minutes. Every request is recorded with your support identity.'),
              const SizedBox(height: 18),
              TextField(
                  controller: _search,
                  decoration: const InputDecoration(
                      labelText: 'Search organizations and venues',
                      prefixIcon: Icon(Icons.search),
                      border: OutlineInputBorder())),
              const SizedBox(height: 12),
              if (venues.isEmpty)
                const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text('No venues found.')),
              for (final venue in venues)
                Card(
                    child: ListTile(
                  title: Text(venue['name'] as String? ?? 'Venue'),
                  subtitle: Text(
                      '${venue['organizationName']} · ${venue['lifecycleState']}'),
                  selected: _selectedVenue == venue['id'],
                  trailing: Icon(_selectedVenue == venue['id']
                      ? Icons.check_circle
                      : Icons.circle_outlined),
                  onTap: () =>
                      setState(() => _selectedVenue = venue['id'] as String),
                )),
              const SizedBox(height: 16),
              TextField(
                controller: _reason,
                maxLength: 500,
                minLines: 2,
                maxLines: 3,
                decoration: const InputDecoration(
                    labelText: 'Ticket number and reason for access',
                    border: OutlineInputBorder()),
              ),
              const SizedBox(height: 8),
              FilledButton.icon(
                  onPressed: _busy ? null : _enter,
                  icon: const Icon(Icons.login),
                  label: const Text('Enter selected venue')),
              if (_error != null)
                Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(_error!,
                        style: TextStyle(
                            color: Theme.of(context).colorScheme.error))),
            ]),
          ));
        },
      ),
    );
  }
}
