import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import 'config/api_configuration.dart';
import 'auth/auth.dart';
import 'auth/sign_in_page.dart';
import 'features/issues/issue_outbox.dart';
import 'features/issues/secure_evidence_store.dart';
import 'features/operations/operations_api.dart';
import 'features/notifications/push_notifications.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await PushNotifications.initialize();
  runApp(const ProviderScope(child: VenueWranglerPrototype()));
}

const _ink = Color(0xFF16261F);
const _canvas = Color(0xFFF6F4EF);
const _paper = Color(0xFFFFFDF9);
const _pine = Color(0xFF1D5A43);
const _brass = Color(0xFFC88A2B);
const _coral = Color(0xFFC74B37);

class VenueWranglerPrototype extends StatelessWidget {
  const VenueWranglerPrototype({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = ColorScheme.fromSeed(
      seedColor: _pine,
      brightness: Brightness.light,
      surface: _paper,
      onSurface: _ink,
    );
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Venue Wrangler',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: scheme,
        scaffoldBackgroundColor: _canvas,
        textTheme: ThemeData.light().textTheme.apply(
              bodyColor: _ink,
              displayColor: _ink,
              fontFamily: 'Arial',
            ),
        appBarTheme: const AppBarTheme(backgroundColor: _canvas, elevation: 0),
        cardTheme: CardThemeData(
          color: _paper,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
            side: const BorderSide(color: Color(0xFFE2DFD7)),
          ),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            backgroundColor: _pine,
            foregroundColor: Colors.white,
            minimumSize: const Size(44, 48),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(
            foregroundColor: _ink,
            minimumSize: const Size(44, 48),
            side: const BorderSide(color: Color(0xFFB6BBB2)),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
        ),
      ),
      home: const AuthGate(),
    );
  }
}

class AuthGate extends ConsumerWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final configurationError = ApiConfiguration.error;
    if (configurationError != null) {
      return _BuildConfigurationPage(message: configurationError);
    }
    final auth = ref.watch(authSessionProvider);
    if (auth.loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return auth.session == null
        ? const SignInPage()
        : const _PushNotificationGate(child: PrototypeShell());
  }
}

class _PushNotificationGate extends ConsumerStatefulWidget {
  const _PushNotificationGate({required this.child});
  final Widget child;

  @override
  ConsumerState<_PushNotificationGate> createState() =>
      _PushNotificationGateState();
}

class _PushNotificationGateState extends ConsumerState<_PushNotificationGate> {
  StreamSubscription<RemoteMessage>? _foregroundSubscription;
  StreamSubscription<RemoteMessage>? _openedSubscription;

  @override
  void initState() {
    super.initState();
    _attachPushHandlers();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        PushNotifications.syncIfEnabled(ref.read(operationsApiProvider));
      }
    });
  }

  Future<void> _attachPushHandlers() async {
    if (!PushNotifications.isConfigured ||
        !await PushNotifications.initialize() ||
        !mounted) {
      return;
    }
    _foregroundSubscription =
        FirebaseMessaging.onMessage.listen(_handlePushMessage);
    _openedSubscription =
        FirebaseMessaging.onMessageOpenedApp.listen(_handlePushMessage);
    final initial = await FirebaseMessaging.instance.getInitialMessage();
    if (initial != null && mounted) _handlePushMessage(initial);
  }

  void _handlePushMessage(RemoteMessage _) {
    ref.invalidate(userNotificationsProvider);
    final messenger = ScaffoldMessenger.maybeOf(context);
    messenger?.showSnackBar(SnackBar(
      content: const Text('A new operational update is available.'),
      action: SnackBarAction(
        label: 'View',
        onPressed: () => showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          builder: (_) => const _NotificationInbox(),
        ),
      ),
    ));
  }

  @override
  void dispose() {
    _foregroundSubscription?.cancel();
    _openedSubscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

class _BuildConfigurationPage extends StatelessWidget {
  const _BuildConfigurationPage({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Padding(
                padding: const EdgeInsets.all(28),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.cloud_off_outlined, size: 48),
                    const SizedBox(height: 16),
                    Text('App setup required',
                        style: Theme.of(context).textTheme.headlineSmall),
                    const SizedBox(height: 8),
                    Text(message, textAlign: TextAlign.center),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
}

class PrototypeShell extends ConsumerWidget {
  const PrototypeShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => const _LiveVenueShell();
}

final _selectedLiveEventProvider = StateProvider<String?>((_) => null);
final _liveTabProvider = StateProvider<int>((_) => 0);

class _LiveVenueShell extends ConsumerWidget {
  const _LiveVenueShell();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bootstrap = ref.watch(operationsBootstrapProvider);
    return bootstrap.when(
      loading: () =>
          const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (error, _) => Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.cloud_off_outlined, size: 42),
                const SizedBox(height: 12),
                const Text('Could not load your organization data'),
                const SizedBox(height: 8),
                Text(error.toString(), textAlign: TextAlign.center),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () => ref.invalidate(operationsBootstrapProvider),
                  child: const Text('Retry'),
                ),
                TextButton(
                  onPressed: () =>
                      ref.read(authSessionProvider.notifier).signOut(),
                  child: const Text('Sign out'),
                ),
              ],
            ),
          ),
        ),
      ),
      data: (data) => _LiveOperationsHome(data: data),
    );
  }
}

class _LiveOperationsHome extends ConsumerWidget {
  const _LiveOperationsHome({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final org = data['organization'] as Map<String, dynamic>? ?? const {};
    final identity = data['identity'] as Map<String, dynamic>? ?? const {};
    final caps = (identity['capabilities'] as List? ?? const [])
        .whereType<String>()
        .toSet();
    final events = (data['events'] as List? ?? const [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    final venues = (data['venues'] as List? ?? const [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    final locations = (data['locations'] as List? ?? const [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    final selectedId = ref.watch(_selectedLiveEventProvider);
    final matchingEvents = events.where((e) => e['id'] == selectedId);
    final event = matchingEvents.isNotEmpty
        ? matchingEvents.first
        : events.isNotEmpty
            ? events.first
            : null;
    if (event != null && selectedId != event['id']) {
      WidgetsBinding.instance.addPostFrameCallback((_) => ref
          .read(_selectedLiveEventProvider.notifier)
          .state = event['id'] as String);
    }
    final isAdmin = caps.contains('tenant:admin');
    final tabs = <String>[
      'Today',
      if (caps.contains('issue:read') || caps.contains('issue:report'))
        'Issues',
      if (caps.contains('operations:read')) 'Operations',
      if (isAdmin) 'Setup'
    ];
    final selectedTab =
        ref.watch(_liveTabProvider).clamp(0, tabs.length - 1).toInt();
    final title = (org['name'] as String?) ?? 'Venue operations';
    final eventName = event?['name'] as String?;
    final notificationState = caps.contains('notification:read')
        ? ref.watch(userNotificationsProvider)
        : null;
    final unreadNotifications = notificationState?.valueOrNull
            ?.where((row) => (row as Map)['readAt'] == null)
            .length ??
        0;
    final page = tabs[selectedTab] == 'Setup' && isAdmin
        ? _TenantSetupPage(
            venues: venues,
            people: (data['people'] as List? ?? const [])
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList(),
            api: ref.read(operationsApiProvider),
            onSaved: () => ref.invalidate(operationsBootstrapProvider))
        : event == null
            ? _NoEventsPage(
                isAdmin: isAdmin,
                onSetup: () => ref.read(_liveTabProvider.notifier).state =
                    tabs.indexOf('Setup'))
            : switch (tabs[selectedTab]) {
                'Issues' => _LiveIssuesPage(
                    event: event,
                    canRead: caps.contains('issue:read'),
                    capabilities: caps,
                    assignableUserIds:
                        (identity['assignableUserIds'] as List? ?? const [])
                            .whereType<String>()
                            .toList(),
                    people: (data['people'] as List? ?? const [])
                        .whereType<Map>()
                        .map((e) => Map<String, dynamic>.from(e))
                        .toList()),
                'Operations' => _LiveTasksPage(
                    event: event, canWrite: caps.contains('operations:write')),
                'Setup' => _TenantSetupPage(
                    venues: venues,
                    people: (data['people'] as List? ?? const [])
                        .whereType<Map>()
                        .map((e) => Map<String, dynamic>.from(e))
                        .toList(),
                    api: ref.read(operationsApiProvider),
                    onSaved: () => ref.invalidate(operationsBootstrapProvider)),
                _ => _LiveTodayPage(
                    event: event,
                    venueCount: venues.length,
                    locationCount: locations.length,
                    capabilities: caps),
              };
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title,
              style:
                  const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          Text(eventName ?? 'Select an event',
              style: const TextStyle(fontSize: 12, color: Color(0xFF59645D)))
        ]),
        actions: [
          if (caps.contains('notification:read'))
            IconButton(
                tooltip: 'Notifications',
                onPressed: () => showModalBottomSheet<void>(
                    context: context,
                    isScrollControlled: true,
                    builder: (_) => const _NotificationInbox()),
                icon: Badge(
                    isLabelVisible: unreadNotifications > 0,
                    label: Text('$unreadNotifications'),
                    child: const Icon(Icons.notifications_outlined))),
          if (events.isNotEmpty)
            PopupMenuButton<String>(
                tooltip: 'Select event',
                icon: const Icon(Icons.event_available_outlined),
                onSelected: (id) {
                  ref.read(_selectedLiveEventProvider.notifier).state = id;
                },
                itemBuilder: (_) => events
                    .map((e) => PopupMenuItem(
                        value: e['id'] as String,
                        child: Text(e['name'] as String? ?? 'Event')))
                    .toList()),
          IconButton(
              tooltip: 'Refresh',
              onPressed: () {
                ref.invalidate(operationsBootstrapProvider);
                if (event != null) {
                  ref.invalidate(eventIssuesProvider(event['id'] as String));
                  ref.invalidate(eventTasksProvider(event['id'] as String));
                }
              },
              icon: const Icon(Icons.refresh)),
          IconButton(
              tooltip: 'Sign out',
              onPressed: () => ref.read(authSessionProvider.notifier).signOut(),
              icon: const Icon(Icons.logout_outlined)),
        ],
      ),
      body: SafeArea(
          child: Column(children: [
        if (tabs.length > 1)
          Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: SegmentedButton<int>(
                  segments: [
                    for (var i = 0; i < tabs.length; i++)
                      ButtonSegment(value: i, label: Text(tabs[i]))
                  ],
                  selected: {
                    selectedTab
                  },
                  onSelectionChanged: (value) =>
                      ref.read(_liveTabProvider.notifier).state = value.first)),
        Expanded(
            child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                child: page)),
      ])),
      floatingActionButton: event != null &&
              tabs[selectedTab] == 'Issues' &&
              caps.contains('issue:report')
          ? FloatingActionButton.extended(
              onPressed: () => _newLiveIssue(context, ref, event, locations),
              backgroundColor: _coral,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.add_alert_outlined),
              label: const Text('Report issue'))
          : event != null &&
                  tabs[selectedTab] == 'Operations' &&
                  caps.contains('operations:write')
              ? FloatingActionButton.extended(
                  onPressed: () => _newLiveTask(
                      context,
                      ref,
                      event,
                      locations,
                      (identity['assignableUserIds'] as List? ?? const [])
                          .whereType<String>()
                          .toList(),
                      (data['people'] as List? ?? const [])
                          .whereType<Map>()
                          .map((e) => Map<String, dynamic>.from(e))
                          .toList()),
                  icon: const Icon(Icons.add_task),
                  label: const Text('Add task'))
              : null,
    );
  }
}

class _NoEventsPage extends StatelessWidget {
  const _NoEventsPage({required this.isAdmin, required this.onSetup});
  final bool isAdmin;
  final VoidCallback onSetup;
  @override
  Widget build(BuildContext context) => Center(
      child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 500),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.event_busy_outlined, size: 52, color: _pine),
            const SizedBox(height: 16),
            const Text('No events are assigned to your account',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            Text(
                isAdmin
                    ? 'Set up your venue and create an event to start using the live operations console.'
                    : 'Ask your organization administrator to assign your account to an event.',
                textAlign: TextAlign.center),
            if (isAdmin) ...[
              const SizedBox(height: 16),
              FilledButton(
                  onPressed: onSetup, child: const Text('Set up organization'))
            ]
          ])));
}

class _NotificationInbox extends ConsumerStatefulWidget {
  const _NotificationInbox();

  @override
  ConsumerState<_NotificationInbox> createState() => _NotificationInboxState();
}

class _NotificationInboxState extends ConsumerState<_NotificationInbox> {
  bool? _pushEnabled;
  bool _updatingPush = false;

  @override
  void initState() {
    super.initState();
    PushNotifications.isEnabled().then((enabled) {
      if (mounted) setState(() => _pushEnabled = enabled);
    });
  }

  Future<void> _togglePush() async {
    if (_updatingPush) return;
    setState(() => _updatingPush = true);
    try {
      if (_pushEnabled == true) {
        await PushNotifications.disable(ref.read(operationsApiProvider));
        if (mounted) setState(() => _pushEnabled = false);
      } else {
        final enabled =
            await PushNotifications.enable(ref.read(operationsApiProvider));
        if (mounted) {
          setState(() => _pushEnabled = enabled);
          if (!enabled) {
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                content: Text(
                    'Push permission or device registration was not completed.')));
          }
        }
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Could not update push alerts: $error')));
      }
    } finally {
      if (mounted) setState(() => _updatingPush = false);
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
      child: SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.72,
          child: Column(children: [
            Padding(
                padding: const EdgeInsets.all(20),
                child: Row(children: [
                  const Icon(Icons.notifications_active_outlined, color: _pine),
                  const SizedBox(width: 10),
                  Text('Notifications',
                      style: Theme.of(context)
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontWeight: FontWeight.w800))
                ])),
            Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
                child: !PushNotifications.isConfigured
                    ? const Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                            'Push alerts are not configured for this app build.',
                            style: TextStyle(color: Color(0xFF59645D))))
                    : Align(
                        alignment: Alignment.centerLeft,
                        child: OutlinedButton.icon(
                          onPressed: _updatingPush ? null : _togglePush,
                          icon: _updatingPush
                              ? const SizedBox.square(
                                  dimension: 16,
                                  child:
                                      CircularProgressIndicator(strokeWidth: 2))
                              : Icon(_pushEnabled == true
                                  ? Icons.notifications_off_outlined
                                  : Icons.notifications_active_outlined),
                          label: Text(_pushEnabled == true
                              ? 'Turn off device alerts'
                              : 'Enable device alerts'),
                        ))),
            Expanded(
                child: ref.watch(userNotificationsProvider).when(
                    loading: () =>
                        const Center(child: CircularProgressIndicator()),
                    error: (error, _) => Center(
                        child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Text('Notifications unavailable: $error'))),
                    data: (rows) => rows.isEmpty
                        ? const Center(child: Text('You are all caught up.'))
                        : ListView.builder(
                            itemCount: rows.length,
                            itemBuilder: (context, index) {
                              final notification =
                                  Map<String, dynamic>.from(rows[index] as Map);
                              final unread = notification['readAt'] == null;
                              return ListTile(
                                  leading: Icon(
                                      unread
                                          ? Icons.mark_email_unread_outlined
                                          : Icons.drafts_outlined,
                                      color: unread ? _pine : Colors.grey),
                                  title: Text(
                                      notification['title'] as String? ??
                                          'Notification',
                                      style: TextStyle(
                                          fontWeight: unread
                                              ? FontWeight.w800
                                              : FontWeight.w500)),
                                  subtitle: Text(
                                      '${notification['body'] ?? ''}\n${notification['createdAt'] ?? ''}'),
                                  isThreeLine: true,
                                  onTap: unread
                                      ? () async {
                                          try {
                                            await ref
                                                .read(operationsApiProvider)
                                                .markNotificationRead(
                                                    notification['id']
                                                        as String);
                                            ref.invalidate(
                                                userNotificationsProvider);
                                          } catch (error) {
                                            if (context.mounted) {
                                              ScaffoldMessenger.of(context)
                                                  .showSnackBar(SnackBar(
                                                      content: Text(
                                                          'Could not mark notification read: $error')));
                                            }
                                          }
                                        }
                                      : null);
                            })))
          ])));
}

class _LiveTodayPage extends ConsumerWidget {
  const _LiveTodayPage(
      {required this.event,
      required this.venueCount,
      required this.locationCount,
      required this.capabilities});
  final Map<String, dynamic> event;
  final int venueCount;
  final int locationCount;
  final Set<String> capabilities;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final eventId = event['id'] as String;
    final issues = capabilities.contains('issue:read')
        ? ref.watch(eventIssuesProvider(eventId))
        : const AsyncValue<List<dynamic>>.data([]);
    final tasks = capabilities.contains('operations:read')
        ? ref.watch(eventTasksProvider(eventId))
        : const AsyncValue<List<dynamic>>.data([]);
    return ListView(children: [
      Text('Event day',
          style: Theme.of(context)
              .textTheme
              .headlineMedium
              ?.copyWith(fontWeight: FontWeight.w800)),
      const SizedBox(height: 4),
      Text(event['name'] as String? ?? 'Event'),
      const SizedBox(height: 20),
      Wrap(spacing: 12, runSpacing: 12, children: [
        _LiveMetric(
            label: 'Venues in scope',
            value: '$venueCount',
            icon: Icons.stadium_outlined),
        _LiveMetric(
            label: 'Locations',
            value: '$locationCount',
            icon: Icons.place_outlined),
        _LiveMetric(
            label: 'Open issues',
            value: issues.valueOrNull?.length.toString() ?? '—',
            icon: Icons.report_problem_outlined),
        _LiveMetric(
            label: 'Operations tasks',
            value: tasks.valueOrNull?.length.toString() ?? '—',
            icon: Icons.checklist_outlined),
      ]),
      const SizedBox(height: 20),
      if (issues.hasError || tasks.hasError)
        const Text(
            'Some live data could not be loaded. Check your connection and refresh.'),
      const Text('Live event data',
          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
      const SizedBox(height: 8),
      if (issues.valueOrNull?.isEmpty ?? true)
        const _EmptyLine('No reported issues for this event.'),
      ...(issues.valueOrNull ?? const []).take(3).map((row) {
        final item = Map<String, dynamic>.from(row as Map);
        return ListTile(
            leading: Icon(Icons.circle,
                size: 12,
                color:
                    item['severity'] == 'CRITICAL' || item['severity'] == 'HIGH'
                        ? _coral
                        : _brass),
            title: Text(item['title'] as String? ?? 'Issue'),
            subtitle: Text(
                '${item['state'] ?? 'REPORTED'} · ${item['category'] ?? ''}'));
      }),
      if (tasks.valueOrNull?.isEmpty ?? true)
        const _EmptyLine('No operational tasks have been added yet.'),
      ...(tasks.valueOrNull ?? const []).take(3).map((row) {
        final item = Map<String, dynamic>.from(row as Map);
        return ListTile(
            leading: const Icon(Icons.task_alt_outlined),
            title: Text(item['title'] as String? ?? 'Task'),
            subtitle:
                Text('${item['kind'] ?? ''} · ${item['state'] ?? 'OPEN'}'));
      }),
    ]);
  }
}

class _LiveMetric extends StatelessWidget {
  const _LiveMetric(
      {required this.label, required this.value, required this.icon});
  final String label, value;
  final IconData icon;
  @override
  Widget build(BuildContext context) => SizedBox(
      width: 160,
      child: Card(
          child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(icon, color: _pine),
                    const SizedBox(height: 12),
                    Text(value,
                        style: Theme.of(context)
                            .textTheme
                            .headlineSmall
                            ?.copyWith(fontWeight: FontWeight.w800)),
                    Text(label, style: Theme.of(context).textTheme.bodySmall)
                  ]))));
}

class _EmptyLine extends StatelessWidget {
  const _EmptyLine(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Text(text, style: const TextStyle(color: Color(0xFF59645D))));
}

class _LiveIssuesPage extends ConsumerWidget {
  const _LiveIssuesPage(
      {required this.event,
      required this.canRead,
      required this.capabilities,
      required this.assignableUserIds,
      required this.people});
  final Map<String, dynamic> event;
  final bool canRead;
  final Set<String> capabilities;
  final List<String> assignableUserIds;
  final List<Map<String, dynamic>> people;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final eventId = event['id'] as String;
    final liveConnection =
        canRead ? ref.watch(issueEventStreamProvider(eventId)) : null;
    if (canRead) {
      ref.listen(issueEventStreamProvider(eventId), (previous, next) {
        if (next.valueOrNull?.containsKey('issueId') ?? false) {
          ref.invalidate(eventIssuesProvider(eventId));
        }
      });
    }
    return Column(children: [
      if (canRead)
        Align(
          alignment: Alignment.centerLeft,
          child: Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              liveConnection?.hasError ?? false
                  ? 'Live updates disconnected · reconnecting'
                  : liveConnection?.valueOrNull?['_connected'] == false
                      ? 'Live updates disconnected · reconnecting'
                      : liveConnection?.valueOrNull?['_connected'] == true
                          ? 'Live updates connected'
                          : 'Connecting to live updates…',
              style: const TextStyle(fontSize: 12, color: Color(0xFF59645D)),
            ),
          ),
        ),
      Expanded(
          child: !canRead
              ? const Center(
                  child: Text('Report an issue with the button below.'))
              : ref.watch(eventIssuesProvider(eventId)).when(
                    loading: () =>
                        const Center(child: CircularProgressIndicator()),
                    error: (error, _) =>
                        Center(child: Text('Issue list unavailable: $error')),
                    data: (rows) => rows.isEmpty
                        ? const Center(
                            child: Text('No issues reported for this event.'))
                        : ListView(
                            children: rows.map((row) {
                            final item = Map<String, dynamic>.from(row as Map);
                            final state =
                                item['state'] as String? ?? 'REPORTED';
                            final actions = _issueActions(state, capabilities,
                                canAssign: assignableUserIds.isNotEmpty);
                            return Card(
                                child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                  ListTile(
                                      leading: const Icon(
                                          Icons.report_problem_outlined,
                                          color: _coral),
                                      title: Text(
                                          item['title'] as String? ?? 'Issue'),
                                      subtitle: Text(
                                          '${item['state']} · ${item['severity']} · ${item['category']}\n${item['description'] ?? ''}'),
                                      isThreeLine: true),
                                  TextButton.icon(
                                      onPressed: () => _showIssueEvidence(
                                          context,
                                          ref,
                                          event['id'] as String,
                                          item),
                                      icon: const Icon(
                                          Icons.photo_library_outlined),
                                      label: const Text('View photo evidence')),
                                  if (actions.isNotEmpty)
                                    Align(
                                        alignment: Alignment.centerRight,
                                        child: PopupMenuButton<String>(
                                            tooltip: 'Update issue',
                                            onSelected: (action) =>
                                                _performLiveIssueAction(
                                                    context,
                                                    ref,
                                                    event['id'] as String,
                                                    item,
                                                    action,
                                                    assignableUserIds,
                                                    people),
                                            itemBuilder: (_) => actions
                                                .map((action) => PopupMenuItem(
                                                    value: action,
                                                    child: Text(
                                                        _issueActionLabel(
                                                            action))))
                                                .toList(),
                                            child: const Padding(
                                                padding: EdgeInsets.fromLTRB(
                                                    12, 0, 16, 12),
                                                child: Row(
                                                    mainAxisSize: MainAxisSize.min,
                                                    children: [
                                                      Text('Update'),
                                                      Icon(Icons.expand_more)
                                                    ]))))
                                ]));
                          }).toList()),
                  )),
      _PendingIssueQueue(eventId: eventId),
    ]);
  }
}

Future<void> _showIssueEvidence(BuildContext context, WidgetRef ref,
    String eventId, Map<String, dynamic> issue) async {
  try {
    final rows = await ref
        .read(operationsApiProvider)
        .evidence(eventId, issue['id'] as String);
    if (!context.mounted) return;
    await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
              title: const Text('Issue photo evidence'),
              content: SizedBox(
                width: 480,
                child: rows.isEmpty
                    ? const Text('No photos are attached to this issue.')
                    : SingleChildScrollView(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: rows.map((row) {
                            final evidence =
                                Map<String, dynamic>.from(row as Map);
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(evidence['fileName'] as String? ??
                                      'Photo'),
                                  const SizedBox(height: 6),
                                  Image.network(
                                    evidence['downloadUrl'] as String,
                                    errorBuilder: (_, __, ___) => const Text(
                                        'Photo could not be loaded.'),
                                  ),
                                ],
                              ),
                            );
                          }).toList(),
                        ),
                      ),
              ),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(dialogContext),
                    child: const Text('Done')),
              ],
            ));
  } catch (error) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not load evidence: $error')));
    }
  }
}

class _PendingIssueQueue extends ConsumerWidget {
  const _PendingIssueQueue({required this.eventId});
  final String eventId;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pending = ref
        .watch(issueSyncProvider)
        .where((report) => report.eventId == eventId)
        .toList();
    if (pending.isEmpty) return const SizedBox.shrink();
    return ExpansionTile(
        leading: const Icon(Icons.cloud_upload_outlined),
        title: Text(
            '${pending.length} saved report${pending.length == 1 ? '' : 's'} waiting to sync'),
        children: pending
            .map((report) => ListTile(
                title: Text(report.title),
                subtitle: Text(report.state == SyncState.failed
                    ? 'Sync failed · saved on this device${report.evidence.isEmpty ? '' : ' · ${report.evidence.length} photo(s)'}'
                    : 'Saved on this device · waiting for network${report.evidence.isEmpty ? '' : ' · ${report.evidence.length} photo(s)'}'),
                trailing: report.state == SyncState.failed
                    ? IconButton(
                        tooltip: 'Retry sync',
                        onPressed: () =>
                            ref.read(issueSyncProvider.notifier).synchronize(),
                        icon: const Icon(Icons.sync))
                    : const Icon(Icons.lock_outline)))
            .toList());
  }
}

List<String> _issueActions(String state, Set<String> caps,
        {required bool canAssign}) =>
    [
      if (state == 'REPORTED' && caps.contains('issue:triage')) 'triage',
      if (['REPORTED', 'TRIAGED', 'ESCALATED', 'ASSIGNED'].contains(state) &&
          caps.contains('issue:triage') &&
          canAssign)
        'assign',
      if (['REPORTED', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS'].contains(state) &&
          caps.contains('issue:escalate'))
        'escalate',
      if (['ASSIGNED', 'ESCALATED', 'IN_PROGRESS'].contains(state) &&
          caps.contains('issue:resolve'))
        'resolve',
      if (state == 'RESOLVED' && caps.contains('issue:verify')) 'verify',
      if (state == 'VERIFIED' && caps.contains('issue:close')) 'close',
    ];

String _issueActionLabel(String action) => switch (action) {
      'triage' => 'Mark triaged',
      'assign' => 'Assign to person',
      'escalate' => 'Escalate',
      'resolve' => 'Resolve',
      'verify' => 'Verify resolution',
      'close' => 'Close issue',
      _ => action,
    };

Future<void> _performLiveIssueAction(
    BuildContext context,
    WidgetRef ref,
    String eventId,
    Map<String, dynamic> issue,
    String action,
    List<String> assignableUserIds,
    List<Map<String, dynamic>> people) async {
  String? ownerId;
  if (action == 'assign') {
    final labels = <String, String>{
      for (final person in people)
        if (person['externalSubject'] is String)
          person['externalSubject'] as String:
              '${person['displayName'] ?? person['externalSubject']} · ${person['email'] ?? ''}'
    };
    ownerId = await showDialog<String>(
        context: context,
        builder: (context) => SimpleDialog(
            title: const Text('Assign issue to'),
            children: assignableUserIds
                .map((id) => SimpleDialogOption(
                    onPressed: () => Navigator.pop(context, id),
                    child: Text(labels[id] ?? id)))
                .toList()));
    if (ownerId == null || !context.mounted) return;
  }
  final reason = TextEditingController();
  final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
              title: Text(_issueActionLabel(action)),
              content: TextField(
                  controller: reason,
                  autofocus: true,
                  decoration: const InputDecoration(labelText: 'Reason'),
                  minLines: 1,
                  maxLines: 3),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: const Text('Cancel')),
                FilledButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: const Text('Save'))
              ]));
  if (confirmed != true || !context.mounted) return;
  try {
    await ref.read(operationsApiProvider).issueAction(
        eventId, issue['id'] as String, action,
        reason: reason.text.trim().isEmpty
            ? 'Reviewed in operations console.'
            : reason.text.trim(),
        ownerId: ownerId);
    ref.invalidate(eventIssuesProvider(eventId));
  } catch (error) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not update issue: $error')));
    }
  }
}

class _LiveTasksPage extends ConsumerWidget {
  const _LiveTasksPage({required this.event, required this.canWrite});
  final Map<String, dynamic> event;
  final bool canWrite;
  @override
  Widget build(BuildContext context, WidgetRef ref) =>
      ref.watch(eventTasksProvider(event['id'] as String)).when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) =>
              Center(child: Text('Operations queue unavailable: $e')),
          data: (rows) => rows.isEmpty
              ? const Center(child: Text('No tasks for this event yet.'))
              : ListView(
                  children: rows.map((row) {
                  final item = Map<String, dynamic>.from(row as Map);
                  final state = item['state'] as String? ?? 'OPEN';
                  return Card(
                      child: ListTile(
                          leading: Icon(
                              state == 'DONE'
                                  ? Icons.check_circle_outline
                                  : state == 'BLOCKED'
                                      ? Icons.warning_amber_outlined
                                      : Icons.radio_button_unchecked,
                              color: state == 'BLOCKED' ? _coral : _pine),
                          title: Text(item['title'] as String? ?? 'Task'),
                          subtitle: Text(
                              '${item['kind']} · $state${item['ownerId'] == null ? '' : ' · ${item['ownerId']}'}'),
                          trailing: canWrite && state != 'DONE'
                              ? PopupMenuButton<String>(
                                  onSelected: (next) async {
                                    try {
                                      await ref
                                          .read(operationsApiProvider)
                                          .updateTask(
                                              event['id'] as String,
                                              item['id'] as String,
                                              {'state': next});
                                      ref.invalidate(eventTasksProvider(
                                          event['id'] as String));
                                    } catch (_) {
                                      if (context.mounted) {
                                        ScaffoldMessenger.of(context)
                                            .showSnackBar(SnackBar(
                                          content: const Text(
                                              'Could not update task. Check your connection or refresh before retrying.'),
                                        ));
                                      }
                                    }
                                  },
                                  itemBuilder: (_) => const [
                                        PopupMenuItem(
                                            value: 'IN_PROGRESS',
                                            child: Text('Start')),
                                        PopupMenuItem(
                                            value: 'BLOCKED',
                                            child: Text('Mark blocked')),
                                        PopupMenuItem(
                                            value: 'DONE',
                                            child: Text('Complete'))
                                      ])
                              : Text(state)));
                }).toList()));
}

class _TenantSetupPage extends StatelessWidget {
  const _TenantSetupPage(
      {required this.venues,
      required this.people,
      required this.api,
      required this.onSaved});
  final List<Map<String, dynamic>> venues;
  final List<Map<String, dynamic>> people;
  final OperationsApi api;
  final VoidCallback onSaved;
  @override
  Widget build(BuildContext context) => ListView(children: [
        Text('Organization setup',
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        const Text('Create the real venue structure used by event operations.'),
        const SizedBox(height: 8),
        OutlinedButton.icon(
            onPressed: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                builder: (_) => FractionallySizedBox(
                    heightFactor: 0.82, child: _AuditTrail(api: api))),
            icon: const Icon(Icons.history),
            label: const Text('View audit history')),
        const SizedBox(height: 16),
        ...venues.map((v) => ListTile(
            leading: const Icon(Icons.stadium_outlined),
            title: Text(v['name'] as String? ?? 'Venue'))),
        const SizedBox(height: 12),
        Wrap(spacing: 8, runSpacing: 8, children: [
          FilledButton.icon(
              onPressed: () => _create(context, 'venue'),
              icon: const Icon(Icons.add),
              label: const Text('Add venue')),
          OutlinedButton.icon(
              onPressed:
                  venues.isEmpty ? null : () => _create(context, 'location'),
              icon: const Icon(Icons.place_outlined),
              label: const Text('Add location')),
          OutlinedButton.icon(
              onPressed:
                  venues.isEmpty ? null : () => _create(context, 'event'),
              icon: const Icon(Icons.event_outlined),
              label: const Text('Add event')),
          OutlinedButton.icon(
              onPressed: () => _create(context, 'person'),
              icon: const Icon(Icons.person_add_alt),
              label: const Text('Add person'))
        ]),
        const SizedBox(height: 24),
        Text('People directory (${people.length})',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w800)),
        ...people.map((person) => ListTile(
            leading: const Icon(Icons.person_outline),
            title: Text(person['displayName'] as String? ?? 'Person'),
            subtitle: Text(person['email'] as String? ?? '')))
      ]);
  Future<void> _create(BuildContext context, String type) async {
    final name = TextEditingController();
    final email = TextEditingController();
    final subject = TextEditingController();
    final ok = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
                title: Text('Add $type'),
                content: Column(mainAxisSize: MainAxisSize.min, children: [
                  TextField(
                      controller: name,
                      decoration: InputDecoration(
                          labelText:
                              type == 'person' ? 'Display name' : 'Name')),
                  if (type == 'person')
                    TextField(
                        controller: email,
                        decoration: const InputDecoration(labelText: 'Email')),
                  if (type == 'person')
                    TextField(
                        controller: subject,
                        decoration: const InputDecoration(
                            labelText: 'Canonical subject (issuer|sub)'))
                ]),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: const Text('Save'))
                ]));
    if (ok != true || !context.mounted) return;
    try {
      if (type == 'venue') await api.createVenue(name.text.trim());
      if (type == 'location') {
        if (!context.mounted) return;
        final venue = await _chooseVenue(context);
        if (venue != null) {
          await api.createLocation(venue['id'] as String, name.text.trim());
        }
      }
      if (type == 'event') {
        if (!context.mounted) return;
        final venue = await _chooseVenue(context);
        if (venue != null && context.mounted) {
          final date = await showDatePicker(
              context: context,
              firstDate: DateTime.now().subtract(const Duration(days: 365)),
              lastDate: DateTime.now().add(const Duration(days: 365 * 5)),
              initialDate: DateTime.now());
          final time = date != null && context.mounted
              ? await showTimePicker(
                  context: context,
                  initialTime: const TimeOfDay(hour: 19, minute: 0))
              : null;
          if (date == null || time == null) return;
          final startsAt =
              DateTime(date.year, date.month, date.day, time.hour, time.minute);
          await api.createEvent(
              venue['id'] as String, name.text.trim(), startsAt);
        }
      }
      if (type == 'person') {
        await api.savePerson(
            subject.text.trim(), email.text.trim(), name.text.trim());
      }
      onSaved();
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$type saved')));
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Could not save: $e')));
      }
    }
  }

  Future<Map<String, dynamic>?> _chooseVenue(BuildContext context) =>
      showDialog<Map<String, dynamic>>(
          context: context,
          builder: (context) => SimpleDialog(
              title: const Text('Choose venue'),
              children: venues
                  .map((v) => SimpleDialogOption(
                      onPressed: () => Navigator.pop(context, v),
                      child: Text(v['name'] as String? ?? 'Venue')))
                  .toList()));
}

class _AuditTrail extends StatefulWidget {
  const _AuditTrail({required this.api});
  final OperationsApi api;

  @override
  State<_AuditTrail> createState() => _AuditTrailState();
}

class _AuditTrailState extends State<_AuditTrail> {
  final _items = <Map<String, dynamic>>[];
  String? _cursor;
  Object? _error;
  bool _loading = false;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_loading || (_loaded && _cursor == null)) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await widget.api.audit(limit: 50, cursor: _cursor);
      final rows = (page['items'] as List? ?? const [])
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      if (!mounted) return;
      setState(() {
        _items.addAll(rows);
        _cursor = page['nextCursor'] as String?;
        _loaded = true;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
      child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
          child: Column(children: [
            Row(children: [
              const Expanded(
                  child: Text('Audit history',
                      style: TextStyle(
                          fontSize: 20, fontWeight: FontWeight.w800))),
              IconButton(
                  tooltip: 'Close',
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close)),
            ]),
            const Divider(),
            Expanded(
                child: _error != null && _items.isEmpty
                    ? Center(
                        child:
                            Column(mainAxisSize: MainAxisSize.min, children: [
                        const Text('Audit history could not be loaded.'),
                        TextButton(onPressed: _load, child: const Text('Retry'))
                      ]))
                    : _items.isEmpty && _loading
                        ? const Center(child: CircularProgressIndicator())
                        : _items.isEmpty
                            ? const Center(
                                child: Text('No recorded changes yet.'))
                            : ListView.builder(
                                itemCount: _items.length +
                                    (_cursor != null || _loading ? 1 : 0),
                                itemBuilder: (context, index) {
                                  if (index == _items.length) {
                                    return Center(
                                        child: _loading
                                            ? const Padding(
                                                padding: EdgeInsets.all(16),
                                                child:
                                                    CircularProgressIndicator())
                                            : TextButton(
                                                onPressed: _load,
                                                child: const Text(
                                                    'Load older changes')));
                                  }
                                  final row = _items[index];
                                  final kind = row['resourceType'] as String? ??
                                      'record';
                                  final fields =
                                      (row['changedFields'] as List? ??
                                              const [])
                                          .whereType<String>()
                                          .join(', ');
                                  final createdAt = DateTime.tryParse(
                                      row['createdAt'] as String? ?? '');
                                  final timestamp = createdAt == null
                                      ? 'Time unavailable'
                                      : '${createdAt.toLocal()}'
                                          .split('.')
                                          .first;
                                  return ListTile(
                                      leading: Icon(_auditIcon(kind)),
                                      title: Text(
                                          '${_auditAction(row['action'] as String?)} · ${kind[0].toUpperCase()}${kind.substring(1)}'),
                                      subtitle: Text([
                                        'By ${row['actorId'] ?? 'unknown user'} · $timestamp',
                                        if (fields.isNotEmpty)
                                          'Changed: $fields',
                                        'Record: ${row['resourceId'] ?? ''}',
                                      ].join('\n')),
                                      isThreeLine: true);
                                })),
            if (_error != null && _items.isNotEmpty)
              TextButton(onPressed: _load, child: const Text('Retry page')),
          ])));

  IconData _auditIcon(String kind) => switch (kind) {
        'issue' => Icons.report_problem_outlined,
        'task' => Icons.checklist_outlined,
        'person' => Icons.person_outline,
        _ => Icons.history,
      };

  String _auditAction(String? action) => (action ?? 'changed')
      .split(RegExp(r'[_\s]+'))
      .map((part) =>
          part.isEmpty ? part : '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}

Future<void> _newLiveIssue(BuildContext context, WidgetRef ref,
    Map<String, dynamic> event, List<Map<String, dynamic>> locations) async {
  final title = TextEditingController(), description = TextEditingController();
  final eventLocations = locations
      .where((location) => location['venueId'] == event['venueId'])
      .toList();
  String? locationId;
  final evidence = <LocalIssueEvidence>[];
  final result = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
          builder: (context, setState) => AlertDialog(
                  title: const Text('Report an issue'),
                  content: Column(mainAxisSize: MainAxisSize.min, children: [
                    TextField(
                        controller: title,
                        decoration: const InputDecoration(labelText: 'Issue')),
                    TextField(
                        controller: description,
                        minLines: 2,
                        maxLines: 4,
                        decoration:
                            const InputDecoration(labelText: 'What happened?')),
                    Row(children: [
                      OutlinedButton.icon(
                        onPressed: () async {
                          if (evidence.length >= 5) return;
                          try {
                            final photo = await ref
                                .read(secureEvidenceStoreProvider)
                                .capturePhoto();
                            if (photo != null) {
                              setState(() => evidence.add(photo));
                            }
                          } catch (error) {
                            if (context.mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                      content: Text(
                                          'Could not save photo: $error')));
                            }
                          }
                        },
                        icon: const Icon(Icons.camera_alt_outlined),
                        label: Text('Add photo (${evidence.length}/5)'),
                      ),
                      if (evidence.isNotEmpty) ...[
                        const SizedBox(width: 8),
                        Text('${evidence.length} attached'),
                      ],
                    ]),
                    if (evidence.isNotEmpty)
                      Wrap(
                        spacing: 6,
                        children: evidence
                            .map((photo) => InputChip(
                                  avatar: const Icon(Icons.image_outlined),
                                  label: Text(photo.fileName),
                                  onDeleted: () async {
                                    await ref
                                        .read(secureEvidenceStoreProvider)
                                        .delete(photo);
                                    setState(() => evidence.remove(photo));
                                  },
                                ))
                            .toList(),
                      ),
                    DropdownButtonFormField<String?>(
                        initialValue: locationId,
                        decoration:
                            const InputDecoration(labelText: 'Location'),
                        items: [
                          const DropdownMenuItem<String?>(
                              value: null, child: Text('No location')),
                          ...eventLocations.map((location) =>
                              DropdownMenuItem<String?>(
                                  value: location['id'] as String,
                                  child: Text(location['name'] as String? ??
                                      'Location')))
                        ],
                        onChanged: (value) =>
                            setState(() => locationId = value))
                  ]),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context, false),
                        child: const Text('Cancel')),
                    FilledButton(
                        onPressed: () => Navigator.pop(context, true),
                        child: const Text('Save report'))
                  ])));
  if (result != true || !context.mounted) {
    for (final photo in evidence) {
      await ref.read(secureEvidenceStoreProvider).delete(photo);
    }
    return;
  }
  if (title.text.trim().length < 3 || description.text.trim().isEmpty) {
    for (final photo in evidence) {
      await ref.read(secureEvidenceStoreProvider).delete(photo);
    }
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Enter an issue title and describe what happened.')));
    return;
  }
  final venueId = event['venueId'] as String;
  await ref.read(issueSyncProvider.notifier).submit(PendingIssueReport(
      idempotencyKey: const Uuid().v4(),
      eventId: event['id'] as String,
      venueId: venueId,
      locationId: locationId,
      title: title.text.trim(),
      description: description.text.trim(),
      category: 'Operations',
      severity: 'MODERATE',
      createdAt: DateTime.now(),
      evidence: List.unmodifiable(evidence)));
  if (!context.mounted) return;
  ref.invalidate(eventIssuesProvider(event['id'] as String));
  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
      content: Text('Issue saved securely and queued to sync.')));
}

Future<void> _newLiveTask(
    BuildContext context,
    WidgetRef ref,
    Map<String, dynamic> event,
    List<Map<String, dynamic>> locations,
    List<String> assignableUserIds,
    List<Map<String, dynamic>> people) async {
  final title = TextEditingController(), description = TextEditingController();
  final eventLocations = locations
      .where((location) => location['venueId'] == event['venueId'])
      .toList();
  String kind = 'PLAN';
  String? locationId;
  String? ownerId;
  final result = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
          builder: (context, setState) => AlertDialog(
                  title: const Text('Add operations task'),
                  content: Column(mainAxisSize: MainAxisSize.min, children: [
                    DropdownButtonFormField<String>(
                        initialValue: kind,
                        items: const [
                          DropdownMenuItem(value: 'PLAN', child: Text('Plan')),
                          DropdownMenuItem(
                              value: 'STAFFING', child: Text('Staffing')),
                          DropdownMenuItem(
                              value: 'SERVICE', child: Text('Service')),
                          DropdownMenuItem(value: 'STOCK', child: Text('Stock'))
                        ],
                        onChanged: (v) => setState(() => kind = v ?? kind)),
                    DropdownButtonFormField<String?>(
                        initialValue: locationId,
                        decoration:
                            const InputDecoration(labelText: 'Location'),
                        items: [
                          const DropdownMenuItem<String?>(
                              value: null, child: Text('No location')),
                          ...eventLocations.map((location) =>
                              DropdownMenuItem<String?>(
                                  value: location['id'] as String,
                                  child: Text(location['name'] as String? ??
                                      'Location')))
                        ],
                        onChanged: (value) =>
                            setState(() => locationId = value)),
                    DropdownButtonFormField<String?>(
                        initialValue: ownerId,
                        decoration: const InputDecoration(labelText: 'Owner'),
                        items: [
                          const DropdownMenuItem<String?>(
                              value: null, child: Text('Unassigned')),
                          ...assignableUserIds.map((id) {
                            final matches =
                                people.where((p) => p['externalSubject'] == id);
                            final person =
                                matches.isEmpty ? null : matches.first;
                            final label = person == null
                                ? id
                                : '${person['displayName'] ?? id} · ${person['email'] ?? ''}';
                            return DropdownMenuItem<String?>(
                                value: id, child: Text(label));
                          })
                        ],
                        onChanged: (value) => setState(() => ownerId = value)),
                    TextField(
                        controller: title,
                        decoration: const InputDecoration(labelText: 'Task')),
                    TextField(
                        controller: description,
                        decoration: const InputDecoration(labelText: 'Details'))
                  ]),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context, false),
                        child: const Text('Cancel')),
                    FilledButton(
                        onPressed: () => Navigator.pop(context, true),
                        child: const Text('Create'))
                  ])));
  if (result != true || !context.mounted) return;
  if (title.text.trim().length < 2) {
    ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a task name before creating it.')));
    return;
  }
  try {
    await ref.read(operationsApiProvider).createTask(event['id'] as String, {
      'kind': kind,
      'venueId': event['venueId'],
      if (locationId != null) 'locationId': locationId,
      if (ownerId != null) 'ownerId': ownerId,
      'title': title.text.trim(),
      'description': description.text.trim()
    });
    ref.invalidate(eventTasksProvider(event['id'] as String));
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Could not create task: $e')));
    }
  }
}
