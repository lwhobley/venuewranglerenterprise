import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';
import 'config/api_configuration.dart';
import 'auth/auth.dart';
import 'auth/sign_in_page.dart';
import 'features/hospitality/hospitality_page.dart';
import 'features/issues/issue_outbox.dart';
import 'features/issues/secure_evidence_store.dart';
import 'features/operations/operations_api.dart';
import 'features/notifications/push_notifications.dart';
import 'features/operations/event_closeout_page.dart';
import 'features/operations/vendor_staffing_page.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await ApiConfiguration.initialize();
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
      if (caps.contains('hospitality:order') || caps.contains('hospitality:fulfill') || caps.contains('operations:write') || isAdmin) 'Hospitality',
      if (caps.contains('operations:read')) 'Stock',
      if (caps.contains('operations:read')) 'Staffing',
      if (caps.contains('operations:read') || caps.contains('operations:write') || caps.contains('vendor:staffing') || isAdmin) 'Vendors',
      if (caps.contains('event:closeout')) 'Closeout',
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
            locations: locations,
            events: events,
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
                'Hospitality' => HospitalityPage(
                    event: event,
                    canOrder: caps.contains('hospitality:order') || caps.contains('operations:write') || isAdmin,
                    canFulfill: caps.contains('hospitality:fulfill') || isAdmin,
                    canApprove: caps.contains('operations:write') || isAdmin,
                    canManageMenu: caps.contains('operations:write') || isAdmin,
                    canManagePolicy: isAdmin,
                    subject: identity['subject'] as String? ?? '',
                    locations: locations),
                'Stock' => _LiveInventoryPage(
                    event: event,
                    canWrite: caps.contains('operations:write'),
                    isAdmin: isAdmin,
                    locations: locations),
                'Staffing' => _LiveStaffingPage(
                    event: event,
                    canWrite: caps.contains('operations:write'),
                    subject: identity['subject'] as String? ?? '',
                    locations: locations,
                    people: (data['people'] as List? ?? const [])
                        .whereType<Map>()
                        .map((e) => Map<String, dynamic>.from(e))
                        .toList()),
                'Vendors' => VendorStaffingPage(
                    event: event,
                    canManage: caps.contains('operations:write') || isAdmin,
                    isVendor: caps.contains('vendor:staffing') && !caps.contains('operations:write') && !isAdmin,
                    assignableUserIds: (identity['assignableUserIds'] as List? ?? const []).whereType<String>().toSet(),
                    people: (data['people'] as List? ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()),
                'Setup' => _TenantSetupPage(
                    venues: venues,
                    locations: locations,
                    events: events,
                    people: (data['people'] as List? ?? const [])
                        .whereType<Map>()
                        .map((e) => Map<String, dynamic>.from(e))
                        .toList(),
                    api: ref.read(operationsApiProvider),
                    onSaved: () => ref.invalidate(operationsBootstrapProvider)),
                'Closeout' => EventCloseoutPage(
                    event: event,
                    availableTabs: tabs.toSet(),
                    onOpenWorkflow: (tab) {
                      final target = tabs.indexOf(tab);
                      if (target >= 0) {
                        ref.read(_liveTabProvider.notifier).state = target;
                      }
                    },
                    people: (data['people'] as List? ?? const [])
                        .whereType<Map>()
                        .map((e) => Map<String, dynamic>.from(e))
                        .toList()),
                _ => _LiveTodayPage(
                    event: event,
                    venueCount: venues.length,
                    locationCount: locations.length,
                    capabilities: caps,
                    onNavigate: (tab) {
                      final target = tabs.indexOf(tab);
                      if (target >= 0) {
                        ref.read(_liveTabProvider.notifier).state = target;
                      }
                    }),
              };
    final isCompact = MediaQuery.sizeOf(context).width < 600;
    final isDesktop = MediaQuery.sizeOf(context).width >= 1024;
    final mobilePrimaryTabs = <String>['Today'];
    if (isAdmin) mobilePrimaryTabs.add('Setup');
    if (caps.contains('vendor:staffing') && !caps.contains('operations:write')) {
      mobilePrimaryTabs.add('Vendors');
    }
    if (caps.contains('hospitality:fulfill') && !caps.contains('operations:write')) {
      mobilePrimaryTabs.add('Hospitality');
    }
    if (caps.contains('operations:write')) mobilePrimaryTabs.add('Staffing');
    if (caps.contains('issue:read') || caps.contains('issue:report')) {
      mobilePrimaryTabs.add('Issues');
    }
    if (caps.contains('operations:read')) mobilePrimaryTabs.add('Operations');
    if (tabs.contains('Hospitality')) mobilePrimaryTabs.add('Hospitality');
    if (tabs.contains('Stock')) mobilePrimaryTabs.add('Stock');
    if (tabs.contains('Staffing')) mobilePrimaryTabs.add('Staffing');
    if (tabs.contains('Vendors')) mobilePrimaryTabs.add('Vendors');
    if (tabs.contains('Closeout')) mobilePrimaryTabs.add('Closeout');
    final mobileTabs = mobilePrimaryTabs
        .where((tab) => tabs.contains(tab))
        .toSet()
        .take(4)
        .toList();
    void selectTab(String tab) {
      final target = tabs.indexOf(tab);
      if (target >= 0) ref.read(_liveTabProvider.notifier).state = target;
    }
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
                  ref.invalidate(eventShiftsProvider(event['id'] as String));
                  ref.invalidate(eventInventoryCountsProvider(event['id'] as String));
                  ref.invalidate(eventHospitalityOrdersProvider(event['id'] as String));
                  ref.invalidate(vendorStaffingRequestsProvider(event['id'] as String));
                  ref.invalidate(staffingCoverageProvider(event['id'] as String));
                  ref.invalidate(eventCloseoutProvider(event['id'] as String));
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
        child: isCompact
            ? Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                child: page)
            : Row(children: [
                ResponsiveWorkspaceNavigation(
                    tabs: tabs,
                    selectedTab: selectedTab,
                    desktop: isDesktop,
                    onSelect: selectTab),
                const VerticalDivider(width: 1, thickness: 1),
                Expanded(
                    child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                        child: page)),
              ]),
      ),
      bottomNavigationBar: isCompact && tabs.length > 1
          ? ResponsiveMobileNavigation(
              primaryTabs: mobileTabs,
              selectedTab: tabs[selectedTab],
              hasMore: tabs.any((tab) => !mobileTabs.contains(tab)),
              onSelect: selectTab,
              onMore: () {
                final overflowTabs =
                    tabs.where((tab) => !mobileTabs.contains(tab)).toList();
                showModalBottomSheet<void>(
                    context: context,
                    builder: (sheetContext) => SafeArea(
                          child: ListView(
                            shrinkWrap: true,
                            children: [
                              for (final tab in overflowTabs)
                                ListTile(
                                    leading: Icon(_workspaceTabIcon(tab)),
                                    title: Text(tab),
                                    selected: tabs[selectedTab] == tab,
                                    onTap: () {
                                      Navigator.pop(sheetContext);
                                      selectTab(tab);
                                    }),
                            ],
                          ),
                        ));
              },
            )
          : null,
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
                  tabs[selectedTab] == 'Staffing' &&
                  caps.contains('operations:write')
              ? FloatingActionButton.extended(
                  onPressed: () => _newLiveShift(
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
                  icon: const Icon(Icons.person_add_alt_1),
                  label: const Text('Add shift'))
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

IconData _workspaceTabIcon(String tab) => switch (tab) {
      'Today' => Icons.today_outlined,
      'Issues' => Icons.report_problem_outlined,
      'Operations' => Icons.checklist_outlined,
      'Hospitality' => Icons.room_service_outlined,
      'Stock' => Icons.inventory_2_outlined,
      'Staffing' => Icons.badge_outlined,
      'Vendors' => Icons.groups_outlined,
      'Closeout' => Icons.fact_check_outlined,
      'Setup' => Icons.settings_outlined,
      _ => Icons.dashboard_outlined,
    };

class ResponsiveMobileNavigation extends StatelessWidget {
  const ResponsiveMobileNavigation({
    super.key,
    required this.primaryTabs,
    required this.selectedTab,
    required this.hasMore,
    required this.onSelect,
    required this.onMore,
  });

  final List<String> primaryTabs;
  final String selectedTab;
  final bool hasMore;
  final ValueChanged<String> onSelect;
  final VoidCallback onMore;

  @override
  Widget build(BuildContext context) => NavigationBar(
        selectedIndex: primaryTabs.contains(selectedTab)
            ? primaryTabs.indexOf(selectedTab)
            : primaryTabs.length,
        destinations: [
          for (final tab in primaryTabs)
            NavigationDestination(
                icon: Icon(_workspaceTabIcon(tab)), label: tab),
          if (hasMore)
            const NavigationDestination(
                icon: Icon(Icons.more_horiz), label: 'More'),
        ],
        onDestinationSelected: (index) {
          if (index < primaryTabs.length) {
            onSelect(primaryTabs[index]);
          } else {
            onMore();
          }
        },
      );
}

class ResponsiveWorkspaceNavigation extends StatelessWidget {
  const ResponsiveWorkspaceNavigation({
    super.key,
    required this.tabs,
    required this.selectedTab,
    required this.desktop,
    required this.onSelect,
  });

  final List<String> tabs;
  final int selectedTab;
  final bool desktop;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) => SizedBox(
        width: desktop ? 232 : 88,
        child: ListView.builder(
          padding: EdgeInsets.symmetric(vertical: 12, horizontal: desktop ? 12 : 6),
          itemCount: tabs.length,
          itemBuilder: (context, index) {
            final tab = tabs[index];
            final selected = index == selectedTab;
            final colors = Theme.of(context).colorScheme;
            if (desktop) {
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: ListTile(
                  selected: selected,
                  selectedTileColor: colors.secondaryContainer,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14)),
                  leading: Icon(_workspaceTabIcon(tab)),
                  title: Text(tab),
                  onTap: () => onSelect(tab),
                ),
              );
            }
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Tooltip(
                message: tab,
                child: Semantics(
                  button: true,
                  selected: selected,
                  label: tab,
                  child: InkWell(
                    borderRadius: BorderRadius.circular(16),
                    onTap: () => onSelect(tab),
                    child: Container(
                      constraints: const BoxConstraints(minHeight: 68),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 3, vertical: 9),
                      decoration: BoxDecoration(
                        color: selected ? colors.secondaryContainer : null,
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(_workspaceTabIcon(tab),
                              color: selected ? colors.onSecondaryContainer : null),
                          const SizedBox(height: 4),
                          Text(tab,
                              textAlign: TextAlign.center,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.labelSmall),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            );
          },
        ),
      );
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
                                            final closeoutNotice = notification['kind'] == 'event_closeout_followup';
                                            final vendorNotice = notification['kind'] == 'vendor_staffing_request' || notification['kind'] == 'vendor_staffing_response';
                                            if ((notification['shiftId'] is String || notification['hospitalityOrderId'] is String || closeoutNotice || vendorNotice) && notification['eventId'] is String) {
                                              final identity = ref.read(operationsBootstrapProvider).valueOrNull?['identity'] as Map<String, dynamic>? ?? const {};
                                              final capabilities = (identity['capabilities'] as List? ?? const []).whereType<String>().toSet();
                                              final tabs = <String>[
                                                'Today',
                                                if (capabilities.contains('issue:read') || capabilities.contains('issue:report')) 'Issues',
                                                if (capabilities.contains('operations:read')) 'Operations',
                                                if (capabilities.contains('hospitality:order') || capabilities.contains('hospitality:fulfill') || capabilities.contains('operations:write') || capabilities.contains('tenant:admin')) 'Hospitality',
                                                if (capabilities.contains('operations:read')) 'Stock',
                                                if (capabilities.contains('operations:read')) 'Staffing',
                                                if (capabilities.contains('operations:read') || capabilities.contains('operations:write') || capabilities.contains('vendor:staffing') || capabilities.contains('tenant:admin')) 'Vendors',
                                                if (capabilities.contains('event:closeout')) 'Closeout',
                                                if (capabilities.contains('tenant:admin')) 'Setup',
                                              ];
                                              ref.read(_selectedLiveEventProvider.notifier).state = notification['eventId'] as String;
                                              final targetTab = closeoutNotice ? 'Closeout' : vendorNotice ? 'Vendors' : notification['hospitalityOrderId'] is String ? 'Hospitality' : 'Staffing';
                                              final targetIndex = tabs.indexOf(targetTab);
                                              if (targetIndex >= 0) ref.read(_liveTabProvider.notifier).state = targetIndex;
                                              if (context.mounted) Navigator.pop(context);
                                            }
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
      required this.capabilities,
      required this.onNavigate});
  final Map<String, dynamic> event;
  final int venueCount;
  final int locationCount;
  final Set<String> capabilities;
  final ValueChanged<String> onNavigate;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final eventId = event['id'] as String;
    final issues = capabilities.contains('issue:read')
        ? ref.watch(eventIssuesProvider(eventId))
        : null;
    final tasks = capabilities.contains('operations:read')
        ? ref.watch(eventTasksProvider(eventId))
        : null;
    final shifts = capabilities.contains('operations:read')
        ? ref.watch(eventShiftsProvider(eventId))
        : null;
    final stockCounts = capabilities.contains('operations:read')
        ? ref.watch(eventInventoryCountsProvider(eventId))
        : null;
    final canViewHospitality = capabilities.contains('hospitality:order') ||
        capabilities.contains('hospitality:fulfill') ||
        capabilities.contains('operations:write') ||
        capabilities.contains('tenant:admin');
    final hospitalityOrders = canViewHospitality
        ? ref.watch(eventHospitalityOrdersProvider(eventId))
        : null;
    final canViewVendors = capabilities.contains('operations:read') ||
        capabilities.contains('operations:write') ||
        capabilities.contains('vendor:staffing') ||
        capabilities.contains('tenant:admin');
    final vendorRequests = canViewVendors
        ? ref.watch(vendorStaffingRequestsProvider(eventId))
        : null;
    final canViewCoverage = capabilities.contains('operations:write') ||
        capabilities.contains('tenant:admin');
    final coverage = canViewCoverage
        ? ref.watch(staffingCoverageProvider(eventId))
        : null;
    String count(AsyncValue<List<dynamic>>? source, bool Function(Map) include) {
      if (source == null) return '—';
      if (source.hasError) return '—';
      final rows = source.valueOrNull;
      if (rows == null) return '…';
      return rows.where((row) => include(row as Map)).length.toString();
    }
    final openIssues = (issues?.valueOrNull ?? const []).where((row) =>
        (row as Map)['state'] != 'CLOSED').toList();
    final openTasks = (tasks?.valueOrNull ?? const []).where((row) =>
        (row as Map)['state'] != 'DONE').toList();
    final scheduledShifts = (shifts?.valueOrNull ?? const []).where((row) =>
        (row as Map)['state'] != 'CANCELLED').length;
    final submittedStockCounts = (stockCounts?.valueOrNull ?? const [])
        .where((row) => row['state'] == 'SUBMITTED').length;
    final activeHospitalityOrders = (hospitalityOrders?.valueOrNull ?? const [])
        .where((row) => !['PICKED_UP', 'REJECTED', 'CANCELLED']
            .contains(row['state']))
        .length;
    final activeVendorRequests = (vendorRequests?.valueOrNull ?? const [])
        .where((row) => !['DECLINED', 'CANCELLED', 'FULFILLED']
            .contains(row['state']))
        .length;
    final unfilledPositions = (coverage?.valueOrNull ?? const []).fold<int>(
        0,
        (total, row) =>
            total + ((row as Map)['unfilledHeadcount'] as num? ?? 0).toInt());
    final attention = <Map<String, dynamic>>[];
    for (final row in openIssues) {
      final item = Map<String, dynamic>.from(row as Map);
      final severity = item['severity'] as String? ?? 'MODERATE';
      if (severity == 'CRITICAL' || severity == 'HIGH') {
        attention.add({...item, '_area': 'Issues', '_rank': severity == 'CRITICAL' ? 0 : 1, '_label': '$severity · ${item['state'] ?? 'REPORTED'}'});
      }
    }
    final now = DateTime.now();
    for (final row in openTasks) {
      final item = Map<String, dynamic>.from(row as Map);
      final dueAt = DateTime.tryParse(item['dueAt'] as String? ?? '')?.toLocal();
      final overdue = dueAt != null && dueAt.isBefore(now);
      final blocked = item['state'] == 'BLOCKED';
      if (overdue || blocked) {
        attention.add({...item, '_area': 'Operations', '_rank': blocked ? 1 : 2, '_label': blocked ? 'BLOCKED' : 'OVERDUE · ${_clockLabel(dueAt)}'});
      }
    }
    if (submittedStockCounts > 0) {
      attention.add({
        'title': '$submittedStockCounts stock count${submittedStockCounts == 1 ? '' : 's'} awaiting approval',
        '_area': 'Stock',
        '_rank': 2,
        '_label': 'REVIEW REQUIRED',
      });
    }
    if (activeHospitalityOrders > 0) {
      attention.add({
        'title': '$activeHospitalityOrders active hospitality order${activeHospitalityOrders == 1 ? '' : 's'}',
        '_area': 'Hospitality',
        '_rank': 2,
        '_label': 'SERVICE IN PROGRESS',
      });
    }
    if (activeVendorRequests > 0) {
      attention.add({
        'title': '$activeVendorRequests vendor staffing request${activeVendorRequests == 1 ? '' : 's'} in progress',
        '_area': 'Vendors',
        '_rank': 2,
        '_label': 'AWAITING FULFILLMENT',
      });
    }
    if (unfilledPositions > 0) {
      attention.add({
        'title': '$unfilledPositions staffing position${unfilledPositions == 1 ? '' : 's'} unfilled',
        '_area': 'Staffing',
        '_rank': 1,
        '_label': 'COVERAGE GAP',
      });
    }
    attention.sort((a, b) {
      final rank = (a['_rank'] as int).compareTo(b['_rank'] as int);
      if (rank != 0) return rank;
      final aUpdated = DateTime.tryParse(a['updatedAt'] as String? ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0);
      final bUpdated = DateTime.tryParse(b['updatedAt'] as String? ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0);
      return bUpdated.compareTo(aUpdated);
    });
    final recentChanges = <Map<String, dynamic>>[
      for (final row in openIssues) {...Map<String, dynamic>.from(row as Map), '_area': 'Issues'},
      for (final row in openTasks) {...Map<String, dynamic>.from(row as Map), '_area': 'Operations'},
    ]..sort((a, b) => (DateTime.tryParse(b['updatedAt'] as String? ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0)).compareTo(DateTime.tryParse(a['updatedAt'] as String? ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0)));
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
        if (issues != null)
          _LiveMetric(
              label: 'Open issues',
              value: count(issues, (row) => row['state'] != 'CLOSED'),
              icon: Icons.report_problem_outlined),
        if (tasks != null)
          _LiveMetric(
              label: 'Open operations tasks',
              value: count(tasks, (row) => row['state'] != 'DONE'),
              icon: Icons.checklist_outlined),
        if (shifts != null)
          _LiveMetric(
              label: 'Scheduled shifts',
              value: shifts.hasError ? '—' : shifts.valueOrNull == null ? '…' : '$scheduledShifts',
              icon: Icons.badge_outlined),
        if (hospitalityOrders != null)
          _LiveMetric(
              label: 'Active hospitality orders',
              value: hospitalityOrders.hasError ? '—' : hospitalityOrders.valueOrNull == null ? '…' : '$activeHospitalityOrders',
              icon: Icons.room_service_outlined),
        if (stockCounts != null)
          _LiveMetric(
              label: 'Stock counts for approval',
              value: stockCounts.hasError ? '—' : stockCounts.valueOrNull == null ? '…' : '$submittedStockCounts',
              icon: Icons.inventory_2_outlined),
        if (vendorRequests != null)
          _LiveMetric(
              label: 'Active vendor requests',
              value: vendorRequests.hasError ? '—' : vendorRequests.valueOrNull == null ? '…' : '$activeVendorRequests',
              icon: Icons.groups_outlined),
        if (coverage != null)
          _LiveMetric(
              label: 'Unfilled positions',
              value: coverage.hasError ? '—' : coverage.valueOrNull == null ? '…' : '$unfilledPositions',
              icon: Icons.person_search_outlined),
      ]),
      const SizedBox(height: 20),
      if ((issues?.hasError ?? false) || (tasks?.hasError ?? false) || (shifts?.hasError ?? false) || (stockCounts?.hasError ?? false) || (hospitalityOrders?.hasError ?? false) || (vendorRequests?.hasError ?? false) || (coverage?.hasError ?? false))
        const Text(
            'Some live data could not be loaded. Check your connection and refresh.'),
      if (issues != null || tasks != null || shifts != null || stockCounts != null || hospitalityOrders != null || vendorRequests != null || coverage != null) ...[
        const Text('Needs attention',
            style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
        const SizedBox(height: 8),
      ],
      if (attention.isEmpty &&
          (issues == null || issues.hasValue) &&
          (tasks == null || tasks.hasValue) &&
          (shifts == null || shifts.hasValue) &&
          (stockCounts == null || stockCounts.hasValue) &&
          (hospitalityOrders == null || hospitalityOrders.hasValue) &&
          (vendorRequests == null || vendorRequests.hasValue) &&
          (coverage == null || coverage.hasValue) &&
          !(issues?.hasError ?? false) &&
          !(tasks?.hasError ?? false) &&
          !(shifts?.hasError ?? false) &&
          !(stockCounts?.hasError ?? false) &&
          !(hospitalityOrders?.hasError ?? false) &&
          !(vendorRequests?.hasError ?? false) &&
          !(coverage?.hasError ?? false))
        const _EmptyLine('Nothing urgent is waiting on this team.'),
      ...attention.take(5).map((item) {
        return ListTile(
            onTap: () => onNavigate(item['_area'] as String),
            leading: Icon(
                item['_area'] == 'Issues' ? Icons.report_problem_outlined : Icons.task_alt_outlined,
                color: (item['_rank'] as int) <= 1 ? _coral : _brass),
            title: Text(item['title'] as String? ?? 'Task'),
            subtitle: Text('${item['_label']} · ${item['_area']} · ${item['ownerId'] ?? 'Unassigned'}'),
            trailing: const Icon(Icons.chevron_right));
      }),
      if (recentChanges.isNotEmpty) ...[
        const SizedBox(height: 18),
        const Text('Recently updated', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
        const SizedBox(height: 8),
        ...recentChanges.take(3).map((item) => ListTile(
          onTap: () => onNavigate(item['_area'] as String),
          leading: const Icon(Icons.history),
          title: Text(item['title'] as String? ?? 'Event update'),
          subtitle: Text('${item['_area']} · ${item['state'] ?? 'Updated'} · ${_clockLabel(DateTime.tryParse(item['updatedAt'] as String? ?? '')?.toLocal())}'),
        )),
      ],
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

class ResponsiveIssueWorkspace extends StatefulWidget {
  const ResponsiveIssueWorkspace({
    required this.issues,
    required this.capabilities,
    required this.canAssign,
    required this.onAction,
    required this.onEvidence,
    super.key,
  });

  final List<Map<String, dynamic>> issues;
  final Set<String> capabilities;
  final bool canAssign;
  final void Function(Map<String, dynamic> issue, String action) onAction;
  final ValueChanged<Map<String, dynamic>> onEvidence;

  @override
  State<ResponsiveIssueWorkspace> createState() =>
      _ResponsiveIssueWorkspaceState();
}

class _ResponsiveIssueWorkspaceState extends State<ResponsiveIssueWorkspace> {
  String _query = '';
  String _stateFilter = 'ALL';
  String? _selectedIssueId;

  @override
  Widget build(BuildContext context) {
    final desktop = MediaQuery.sizeOf(context).width >= 1120;
    final query = _query.trim().toLowerCase();
    final filtered = widget.issues.where((issue) {
      final state = issue['state'] as String? ?? 'REPORTED';
      final matchesState = switch (_stateFilter) {
        'OPEN' => state != 'CLOSED',
        'CLOSED' => state == 'CLOSED',
        _ => true,
      };
      final searchable = [
        issue['title'],
        issue['description'],
        issue['category'],
        issue['severity'],
        state,
        issue['ownerId'],
      ].whereType<Object>().join(' ').toLowerCase();
      return matchesState && (query.isEmpty || searchable.contains(query));
    }).toList();
    Map<String, dynamic>? selected;
    for (final issue in filtered) {
      if (issue['id'] == _selectedIssueId) {
        selected = issue;
        break;
      }
    }
    selected ??= filtered.isEmpty ? null : filtered.first;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                key: const ValueKey('issue-search'),
                onChanged: (value) => setState(() => _query = value),
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Search issues',
                  isDense: true,
                ),
              ),
            ),
            const SizedBox(width: 12),
            SizedBox(
              width: desktop ? 154 : 132,
              child: DropdownButtonFormField<String>(
                key: const ValueKey('issue-state-filter'),
                initialValue: _stateFilter,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'State',
                  isDense: true,
                ),
                items: const [
                  DropdownMenuItem(value: 'ALL', child: Text('All')),
                  DropdownMenuItem(value: 'OPEN', child: Text('Open')),
                  DropdownMenuItem(value: 'CLOSED', child: Text('Closed')),
                ],
                onChanged: (value) {
                  if (value != null) setState(() => _stateFilter = value);
                },
              ),
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Text(
            '${filtered.length} ${filtered.length == 1 ? 'issue' : 'issues'} · ${widget.issues.where((issue) => issue['state'] != 'CLOSED').length} open',
            style: const TextStyle(fontSize: 12, color: Color(0xFF59645D)),
          ),
        ),
        Expanded(
          child: filtered.isEmpty
              ? Center(
                  child: Text(query.isEmpty && widget.issues.isEmpty
                      ? 'No issues reported for this event.'
                      : 'No issues match these filters.'),
                )
              : desktop
                  ? Row(
                      key: const ValueKey('issue-desktop-split-view'),
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        SizedBox(
                          width: 380,
                          child: _buildDesktopList(filtered, selected),
                        ),
                        const VerticalDivider(width: 24, thickness: 1),
                        Expanded(
                          child: _buildIssueDetail(selected),
                        ),
                      ],
                    )
                  : ListView.separated(
                      key: const ValueKey('issue-mobile-list'),
                      itemCount: filtered.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, index) =>
                          _buildMobileCard(filtered[index]),
                    ),
        ),
      ],
    );
  }

  Widget _buildDesktopList(
          List<Map<String, dynamic>> issues, Map<String, dynamic>? selected) =>
      ListView.separated(
        key: const ValueKey('issue-list'),
        itemCount: issues.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final issue = issues[index];
          final isSelected = issue['id'] == selected?['id'];
          final severity = issue['severity'] as String? ?? 'MODERATE';
          return Material(
            color: isSelected ? const Color(0xFFE8EFEA) : Colors.transparent,
            child: ListTile(
              key: ValueKey('issue-row-${issue['id']}'),
              selected: isSelected,
              onTap: () =>
                  setState(() => _selectedIssueId = issue['id'] as String?),
              leading: Icon(Icons.report_problem_outlined,
                  color: severity == 'CRITICAL' || severity == 'HIGH'
                      ? _coral
                      : _brass),
              title: Text(issue['title'] as String? ?? 'Issue',
                  maxLines: 1, overflow: TextOverflow.ellipsis),
              subtitle: Text(
                '${issue['state'] ?? 'REPORTED'} · $severity · ${issue['category'] ?? 'Other'}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              trailing: const Icon(Icons.chevron_right),
            ),
          );
        },
      );

  Widget _buildMobileCard(Map<String, dynamic> issue) {
    final state = issue['state'] as String? ?? 'REPORTED';
    final actions =
        _issueActions(state, widget.capabilities, canAssign: widget.canAssign);
    return Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ListTile(
            leading: const Icon(Icons.report_problem_outlined, color: _coral),
            title: Text(issue['title'] as String? ?? 'Issue'),
            subtitle: Text(
                '$state · ${issue['severity'] ?? 'MODERATE'} · ${issue['category'] ?? 'Other'}\n${issue['description'] ?? ''}'),
            isThreeLine: true,
          ),
          if (issue['latitude'] != null && issue['longitude'] != null)
            _locationEvidence(issue),
          TextButton.icon(
            onPressed: () => widget.onEvidence(issue),
            icon: const Icon(Icons.photo_library_outlined),
            label: const Text('View photo evidence'),
          ),
          if (actions.isNotEmpty)
            Align(
              alignment: Alignment.centerRight,
              child: _issueActionMenu(issue, actions, widget.onAction),
            ),
        ],
      ),
    );
  }

  Widget _buildIssueDetail(Map<String, dynamic>? issue) {
    if (issue == null) {
      return const Center(child: Text('Select an issue to review details.'));
    }
    final state = issue['state'] as String? ?? 'REPORTED';
    final actions =
        _issueActions(state, widget.capabilities, canAssign: widget.canAssign);
    final createdAt =
        DateTime.tryParse('${issue['createdAt'] ?? ''}')?.toLocal();
    return ListView(
      key: ValueKey('issue-detail-${issue['id']}'),
      padding: const EdgeInsets.fromLTRB(18, 8, 12, 24),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                issue['title'] as String? ?? 'Issue',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
            ),
            if (actions.isNotEmpty)
              _issueActionMenu(issue, actions, widget.onAction),
          ],
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            Chip(label: Text(state.replaceAll('_', ' '))),
            Chip(label: Text(issue['severity'] as String? ?? 'MODERATE')),
            Chip(label: Text(issue['category'] as String? ?? 'Other')),
          ],
        ),
        const SizedBox(height: 16),
        Text('Description', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        SelectableText(issue['description'] as String? ?? 'No description'),
        const SizedBox(height: 18),
        const Divider(),
        _issueField('Location', issue['locationId']),
        _issueField('Assigned to', issue['ownerId']),
        if (createdAt != null) _issueField('Reported', createdAt.toString()),
        if (issue['latitude'] != null && issue['longitude'] != null)
          _locationEvidence(issue),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            onPressed: () => widget.onEvidence(issue),
            icon: const Icon(Icons.photo_library_outlined),
            label: const Text('View photo evidence'),
          ),
        ),
      ],
    );
  }

  Widget _issueField(String label, Object? value) {
    if (value == null || value.toString().isEmpty) {
      return const SizedBox.shrink();
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 104,
            child:
                Text(label, style: const TextStyle(color: Color(0xFF59645D))),
          ),
          Expanded(child: SelectableText(value.toString())),
        ],
      ),
    );
  }

  Widget _locationEvidence(Map<String, dynamic> issue) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Text(
          'Device location evidence · ${issue['latitude']}, ${issue['longitude']} · ±${issue['locationAccuracyMeters']} m · ${issue['locationCapturedAt']}',
          style: const TextStyle(fontSize: 12, color: Color(0xFF59645D)),
        ),
      );
}

Widget _issueActionMenu(Map<String, dynamic> issue, List<String> actions,
        void Function(Map<String, dynamic>, String) onAction) =>
    PopupMenuButton<String>(
      tooltip: 'Update issue',
      onSelected: (action) => onAction(issue, action),
      itemBuilder: (_) => actions
          .map((action) => PopupMenuItem(
              value: action, child: Text(_issueActionLabel(action))))
          .toList(),
      child: const Padding(
        padding: EdgeInsets.fromLTRB(12, 8, 16, 12),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [Text('Update'), Icon(Icons.expand_more)],
        ),
      ),
    );

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
                    data: (rows) => ResponsiveIssueWorkspace(
                      issues: rows
                          .whereType<Map>()
                          .map((row) => Map<String, dynamic>.from(row))
                          .toList(),
                      capabilities: capabilities,
                      canAssign: assignableUserIds.isNotEmpty,
                      onAction: (issue, action) => _performLiveIssueAction(
                        context,
                        ref,
                        eventId,
                        issue,
                        action,
                        assignableUserIds,
                        people,
                      ),
                      onEvidence: (issue) =>
                          _showIssueEvidence(context, ref, eventId, issue),
                    ),
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

class _LiveInventoryPage extends ConsumerWidget {
  const _LiveInventoryPage({required this.event, required this.canWrite, required this.isAdmin, required this.locations});
  final Map<String, dynamic> event;
  final bool canWrite;
  final bool isAdmin;
  final List<Map<String, dynamic>> locations;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final eventId = event['id'] as String;
    final venueId = event['venueId'] as String;
    return ref.watch(eventInventoryCountsProvider(eventId)).when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('Inventory counts unavailable: $error')),
      data: (counts) => Column(children: [
        Padding(padding: const EdgeInsets.all(12), child: Wrap(spacing: 8, children: [
          if (canWrite) FilledButton.icon(onPressed: () => _startStockCount(context, ref, eventId, venueId), icon: const Icon(Icons.playlist_add_check), label: const Text('Start venue count')),
          for (final location in locations.where((row) => row['venueId'] == venueId)) if (canWrite) OutlinedButton.icon(onPressed: () => _startStockCount(context, ref, eventId, venueId, locationId: location['id'] as String), icon: const Icon(Icons.location_on_outlined), label: Text('Count ${location['name']}')),
          if (isAdmin) OutlinedButton.icon(onPressed: () => _addStockItem(context, ref, venueId, eventId), icon: const Icon(Icons.add_box_outlined), label: const Text('Add stock item')),
          if (canWrite) OutlinedButton.icon(onPressed: () => _requestStockTransfer(context, ref, eventId, venueId), icon: const Icon(Icons.swap_horiz), label: const Text('Request transfer')),
        ])),
        ref.watch(eventStockTransfersProvider(eventId)).when(
          loading: () => const LinearProgressIndicator(),
          error: (error, _) => ListTile(title: const Text('Transfers unavailable'), subtitle: Text('$error')),
          data: (transfers) => transfers.isEmpty ? const SizedBox.shrink() : SizedBox(height: 190, child: ListView.builder(itemCount: transfers.length, itemBuilder: (context, index) {
            final transfer = transfers[index];
            final source = locations.where((row) => row['id'] == transfer['sourceLocationId']);
            final destination = locations.where((row) => row['id'] == transfer['destinationLocationId']);
            final sourceName = source.isEmpty ? 'Venue stock' : source.first['name'] as String? ?? 'Source';
            final destinationName = destination.isEmpty ? 'Venue stock' : destination.first['name'] as String? ?? 'Destination';
            final state = transfer['state'] as String? ?? 'REQUESTED';
            return Card(child: ListTile(
              leading: const Icon(Icons.swap_horiz),
              title: Text('$sourceName → $destinationName · $state'),
              subtitle: Text(((transfer['lines'] as List? ?? const []).whereType<Map>().map((line) => '${line['name']}: ${line['receivedQuantity'] ?? line['requestedQuantity']} ${line['unit']}')).join(' · ')),
              trailing: canWrite ? Wrap(children: [
                if (state == 'REQUESTED') IconButton(tooltip: 'Dispatch', icon: const Icon(Icons.local_shipping_outlined), onPressed: () => _stockTransferAction(context, ref, eventId, transfer['id'] as String, 'dispatch')),
                if (state == 'REQUESTED') IconButton(tooltip: 'Cancel', icon: const Icon(Icons.cancel_outlined), onPressed: () => _cancelStockTransfer(context, ref, eventId, transfer['id'] as String)),
                if (state == 'IN_TRANSIT') IconButton(tooltip: 'Confirm receipt', icon: const Icon(Icons.inventory_2_outlined), onPressed: () => _receiveStockTransfer(context, ref, eventId, transfer)),
              ]) : null,
            ));
          })),
        ),
        if (counts.isEmpty) const Expanded(child: Center(child: Text('No stock counts for this event. Start a count or add items to the catalog.')))
        else Expanded(child: ListView.builder(itemCount: counts.length, itemBuilder: (context, index) {
          final count = counts[index];
          final lines = (count['lines'] as List? ?? const []).whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList();
          final countId = count['id'] as String;
          final state = count['state'] as String? ?? 'IN_PROGRESS';
          return Card(child: ExpansionTile(
            title: Text('Stock count · $state'),
            subtitle: Text('Started ${DateTime.tryParse(count['createdAt'] as String? ?? '')?.toLocal().toString() ?? ''} · ${lines.length} items'),
            children: [
              for (final line in lines) ListTile(
                title: Text('${line['name']} (${line['sku']})'),
                subtitle: Text('${line['unit']} · counted ${line['countedQuantity'] ?? 'not entered'}${line['expectedQuantity'] == null ? '' : ' · expected ${line['expectedQuantity']}'}'),
                trailing: canWrite && state == 'IN_PROGRESS' ? IconButton(icon: const Icon(Icons.edit_outlined), tooltip: 'Enter count', onPressed: () => _recordStockLine(context, ref, eventId, countId, line)) : null,
              ),
              if (canWrite && state == 'IN_PROGRESS') Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () async {
                try { await ref.read(operationsApiProvider).inventoryCountCommand(eventId, countId, 'submit'); ref.invalidate(eventInventoryCountsProvider(eventId)); }
                catch (error) { if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not submit count: $error'))); }
              }, child: const Text('Submit for independent review'))),
              if (canWrite && state == 'SUBMITTED') Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => _approveStockCount(context, ref, eventId, countId), child: const Text('Review and approve'))),
            ],
          ));
        })),
      ]),
    );
  }

  Future<void> _startStockCount(BuildContext context, WidgetRef ref, String eventId, String venueId, {String? locationId}) async {
    try { await ref.read(operationsApiProvider).startInventoryCount(eventId, venueId, locationId: locationId); ref.invalidate(eventInventoryCountsProvider(eventId)); }
    catch (error) { if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not start count: $error'))); }
  }

  Future<void> _recordStockLine(BuildContext context, WidgetRef ref, String eventId, String countId, Map<String, dynamic> line) async {
    final quantity = TextEditingController(text: line['countedQuantity']?.toString() ?? '');
    final note = TextEditingController(text: line['note']?.toString() ?? '');
    final save = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
      title: Text('Count ${line['name']}'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [TextField(controller: quantity, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: 'Quantity (${line['unit']})')), TextField(controller: note, decoration: const InputDecoration(labelText: 'Note (optional)'))]),
      actions: [TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Save count'))],
    ));
    if (save != true) return;
    final parsed = double.tryParse(quantity.text.trim());
    if (parsed == null || parsed < 0) { if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter a valid non-negative quantity.'))); return; }
    try { await ref.read(operationsApiProvider).recordInventoryCount(eventId, countId, line['id'] as String, parsed, note: note.text.trim().isEmpty ? null : note.text.trim()); ref.invalidate(eventInventoryCountsProvider(eventId)); }
    catch (error) { if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not save count: $error'))); }
  }

  Future<void> _approveStockCount(BuildContext context, WidgetRef ref, String eventId, String countId) async {
    final reason = TextEditingController();
    final approve = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
      title: const Text('Review stock variance'),
      content: TextField(controller: reason, minLines: 2, maxLines: 4, decoration: const InputDecoration(labelText: 'Reason for approval')),
      actions: [TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Approve adjustments'))],
    ));
    if (approve != true) return;
    try { await ref.read(operationsApiProvider).inventoryCountCommand(eventId, countId, 'approve', reason: reason.text.trim()); ref.invalidate(eventInventoryCountsProvider(eventId)); }
    catch (error) { if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not approve count: $error'))); }
  }

  Future<void> _addStockItem(BuildContext context, WidgetRef ref, String venueId, String eventId) async {
    final sku = TextEditingController(), name = TextEditingController(), unit = TextEditingController();
    final save = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
      title: const Text('Add stock catalog item'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [TextField(controller: sku, decoration: const InputDecoration(labelText: 'SKU')), TextField(controller: name, decoration: const InputDecoration(labelText: 'Item name')), TextField(controller: unit, decoration: const InputDecoration(labelText: 'Count unit (e.g. case, each)'))]),
      actions: [TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Add item'))],
    ));
    if (save != true) return;
    try { await ref.read(operationsApiProvider).createInventoryItem(venueId, sku.text.trim(), name.text.trim(), unit.text.trim()); ref.invalidate(eventInventoryCountsProvider(eventId)); if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Catalog item added.'))); }
    catch (error) { if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not add catalog item: $error'))); }
  }

  Future<void> _requestStockTransfer(BuildContext context, WidgetRef ref, String eventId, String venueId) async {
    final venueLocations = locations.where((row) => row['venueId'] == venueId).toList();
    if (venueLocations.length < 2) { ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Create at least two locations before requesting a transfer.'))); return; }
    String sourceId = venueLocations.first['id'] as String;
    String destinationId = (venueLocations.length > 1 ? venueLocations[1] : venueLocations.first)['id'] as String;
    final quantity = TextEditingController(text: '1');
    Map<String, dynamic>? selectedItem;
    final chosen = await showDialog<Map<String, Object?>?>(context: context, builder: (dialogContext) => StatefulBuilder(builder: (context, setState) => AlertDialog(
      title: const Text('Request stock transfer'),
      content: SizedBox(width: 420, child: Column(mainAxisSize: MainAxisSize.min, children: [
        DropdownButtonFormField<String>(initialValue: sourceId, decoration: const InputDecoration(labelText: 'From'), items: venueLocations.map((row) => DropdownMenuItem(value: row['id'] as String, child: Text(row['name'] as String? ?? 'Location'))).toList(), onChanged: (value) { if (value != null) setState(() { sourceId = value; if (destinationId == value) destinationId = venueLocations.firstWhere((row) => row['id'] != value)['id'] as String; selectedItem = null; }); }),
        DropdownButtonFormField<String>(initialValue: destinationId, decoration: const InputDecoration(labelText: 'To'), items: venueLocations.where((row) => row['id'] != sourceId).map((row) => DropdownMenuItem(value: row['id'] as String, child: Text(row['name'] as String? ?? 'Location'))).toList(), onChanged: (value) { if (value != null) setState(() => destinationId = value); }),
        const SizedBox(height: 8),
        FutureBuilder<List<Map<String, dynamic>>>(future: ref.read(operationsApiProvider).inventoryItems(venueId, locationId: sourceId), builder: (context, snapshot) {
          final items = snapshot.data ?? const <Map<String, dynamic>>[];
          if (snapshot.connectionState == ConnectionState.waiting) return const LinearProgressIndicator();
          if (snapshot.hasError) return Text('Catalog unavailable: ${snapshot.error}');
          return DropdownButtonFormField<String>(initialValue: selectedItem?['id'] as String?, decoration: const InputDecoration(labelText: 'Item'), items: items.map((item) => DropdownMenuItem(value: item['id'] as String, child: Text('${item['name']} · ${item['onHand']} ${item['unit']}'))).toList(), onChanged: (id) => setState(() => selectedItem = items.where((item) => item['id'] == id).firstOrNull));
        }),
        TextField(controller: quantity, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Quantity')),
      ])),
      actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')), FilledButton(onPressed: selectedItem == null ? null : () => Navigator.pop(dialogContext, {'itemId': selectedItem!['id'] as String, 'quantity': double.tryParse(quantity.text) ?? 0}), child: const Text('Create request'))],
    )));
    if (chosen == null) return;
    try { await ref.read(operationsApiProvider).createStockTransfer(eventId, venueId, sourceId, destinationId, [chosen]); ref.invalidate(eventStockTransfersProvider(eventId)); }
    catch (error) { if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not request transfer: $error'))); }
  }

  Future<void> _stockTransferAction(BuildContext context, WidgetRef ref, String eventId, String transferId, String action) async {
    try { await ref.read(operationsApiProvider).stockTransferAction(eventId, transferId, action); ref.invalidate(eventStockTransfersProvider(eventId)); ref.invalidate(eventInventoryCountsProvider(eventId)); }
    catch (error) { if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not $action transfer: $error'))); }
  }

  Future<void> _cancelStockTransfer(BuildContext context, WidgetRef ref, String eventId, String transferId) async {
    final reason = TextEditingController();
    final confirmed = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(title: const Text('Cancel transfer'), content: TextField(controller: reason, decoration: const InputDecoration(labelText: 'Reason (required)')), actions: [TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Keep request')), FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Cancel transfer'))]));
    if (confirmed != true || reason.text.trim().length < 3) return;
    try { await ref.read(operationsApiProvider).stockTransferAction(eventId, transferId, 'cancel', data: {'reason': reason.text.trim()}); ref.invalidate(eventStockTransfersProvider(eventId)); }
    catch (error) { if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not cancel transfer: $error'))); }
  }

  Future<void> _receiveStockTransfer(BuildContext context, WidgetRef ref, String eventId, Map<String, dynamic> transfer) async {
    final lines = (transfer['lines'] as List? ?? const []).whereType<Map>().map((line) => Map<String, dynamic>.from(line)).toList();
    final controllers = lines.map((line) => TextEditingController(text: line['requestedQuantity'].toString())).toList();
    final reason = TextEditingController();
    final confirmed = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(title: const Text('Confirm received quantities'), content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [for (var i = 0; i < lines.length; i++) TextField(controller: controllers[i], keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: '${lines[i]['name']} · dispatched ${lines[i]['requestedQuantity']}')), TextField(controller: reason, decoration: const InputDecoration(labelText: 'Variance reason (if short)'))])), actions: [TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Back')), FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Confirm receipt'))]));
    if (confirmed != true) return;
    try { await ref.read(operationsApiProvider).stockTransferAction(eventId, transfer['id'] as String, 'receive', data: {'lines': [for (var i = 0; i < lines.length; i++) {'lineId': lines[i]['id'], 'quantity': double.tryParse(controllers[i].text) ?? -1}], if (reason.text.trim().isNotEmpty) 'reason': reason.text.trim()}); ref.invalidate(eventStockTransfersProvider(eventId)); ref.invalidate(eventInventoryCountsProvider(eventId)); }
    catch (error) { if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not confirm receipt: $error'))); }
  }
}

class _LiveStaffingPage extends ConsumerWidget {
  const _LiveStaffingPage({
    required this.event,
    required this.canWrite,
    required this.subject,
    required this.locations,
    required this.people,
  });
  final Map<String, dynamic> event;
  final bool canWrite;
  final String subject;
  final List<Map<String, dynamic>> locations;
  final List<Map<String, dynamic>> people;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final eventId = event['id'] as String;
    final queuedAttendance = ref.watch(staffAttendanceOutboxProvider);
    ref.listen(staffAttendanceOutboxProvider, (previous, next) {
      if (previous?.length != next.length) ref.invalidate(eventShiftsProvider(eventId));
    });
    return ref.watch(eventShiftsProvider(eventId)).when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(
          child: Text('Staffing schedule unavailable: $error',
              textAlign: TextAlign.center)),
      data: (rows) => Column(children: [
            const _MyUnavailabilityPanel(),
            if (queuedAttendance.any((item) => item['eventId'] == eventId))
              Card(child: ListTile(
                leading: const Icon(Icons.sync_problem_outlined, color: _brass),
                title: const Text('Attendance waiting to sync'),
                subtitle: const Text('Device times stay unverified until a supervisor reviews them.'),
                trailing: TextButton(onPressed: () => _syncStaffAttendance(context, ref, eventId), child: const Text('Sync now')),
              )),
            if (canWrite) _TeamAvailabilityPanel(
              eventId: eventId,
              initialDate: DateTime.tryParse(event['startsAt'] as String? ?? '')?.toLocal() ?? DateTime.now(),
            ),
            if (canWrite) _CoveragePlanningPanel(
              eventId: eventId,
              venueId: event['venueId'] as String? ?? '',
              initialDate: DateTime.tryParse(event['startsAt'] as String? ?? '')?.toLocal() ?? DateTime.now(),
              locations: locations,
            ),
            Expanded(child: rows.isEmpty
          ? const Center(child: Text('No shifts are scheduled for this event.'))
          : ListView.separated(
              itemCount: rows.length,
              separatorBuilder: (_, __) => const SizedBox(height: 4),
              itemBuilder: (context, index) {
                final shift = Map<String, dynamic>.from(rows[index] as Map);
                final assignedToMe = shift['assignedSubject'] == subject;
                final state = shift['state'] as String? ?? 'DRAFT';
                final response = shift['response'] as String? ?? 'PENDING';
                final attendance = shift['attendance'] as String? ?? 'NOT_STARTED';
                final queuedForShift = queuedAttendance.where((item) => item['eventId'] == eventId && item['shiftId'] == shift['id']).toList();
                final pendingClaims = (shift['attendanceClaims'] as List? ?? const []).whereType<Map>().map((item) => Map<String, dynamic>.from(item)).toList();
                final hasPendingCheckIn = queuedForShift.any((item) => item['action'] == 'CHECK_IN') || pendingClaims.any((item) => item['action'] == 'CHECK_IN');
                final hasPendingCheckOut = queuedForShift.any((item) => item['action'] == 'CHECK_OUT') || pendingClaims.any((item) => item['action'] == 'CHECK_OUT');
                final breaks = (shift['breaks'] as List? ?? const []).whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList();
                Map<String, dynamic>? activeBreak;
                for (final record in breaks) {
                  if (record['endedAt'] == null) { activeBreak = record; break; }
                }
                final startsAt = DateTime.tryParse(shift['startsAt'] as String? ?? '')?.toLocal();
                final endsAt = DateTime.tryParse(shift['endsAt'] as String? ?? '')?.toLocal();
                final locationId = shift['locationId'] as String?;
                final location = locations.where((row) => row['id'] == locationId);
                final locationName = location.isEmpty ? 'All areas' : location.first['name'] as String? ?? 'Area';
                final assigned = people.where((row) => row['externalSubject'] == shift['assignedSubject']);
                final assignedName = assignedToMe ? 'You' : assigned.isEmpty ? 'Open shift' : assigned.first['displayName'] as String? ?? 'Assigned worker';
                final requiredQualifications = (shift['requiredQualificationCodes'] as List? ?? const []).cast<String>();
                final currentResponse = shift['responseRevision'] == shift['revision'];
                final breakSummary = breaks.map((record) {
                  final kind = record['kind'] == 'MEAL' ? 'Meal' : 'Rest';
                  final started = DateTime.tryParse(record['startedAt'] as String? ?? '')?.toLocal();
                  final ended = DateTime.tryParse(record['endedAt'] as String? ?? '')?.toLocal();
                  return '$kind break ${_clockLabel(started)}–${ended == null ? 'active' : _clockLabel(ended)}';
                }).join(' · ');
                return Card(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      ListTile(
                        leading: const CircleAvatar(child: Icon(Icons.badge_outlined)),
                        title: Text(shift['role'] as String? ?? 'Shift', style: const TextStyle(fontWeight: FontWeight.w800)),
                        subtitle: Text('$assignedName · $locationName\n${_shiftTimeLabel(startsAt, endsAt)}\n$state · $response · $attendance${attendance == 'NOT_STARTED' ? '' : '\n${_attendanceTimeLabel(shift)}'}${breakSummary.isEmpty ? '' : '\n$breakSummary'}${requiredQualifications.isEmpty ? '' : '\nRequires: ${requiredQualifications.join(', ')}'}'),
                        isThreeLine: true,
                      ),
                      if (shift['instructions'] is String && (shift['instructions'] as String).isNotEmpty)
                        Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: Text(shift['instructions'] as String)),
                      for (final queued in queuedForShift)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                          child: Text('Pending sync · ${queued['action'] == 'CHECK_IN' ? 'check-in' : 'check-out'} at ${_clockLabel(DateTime.tryParse(queued['recordedAt'] as String? ?? '')?.toLocal())}. Device time is unverified until supervisor review.', style: const TextStyle(color: _brass, fontWeight: FontWeight.w700)),
                        ),
                      for (final claim in pendingClaims) ...[
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
                          child: Text('Offline ${claim['action'] == 'CHECK_IN' ? 'check-in' : 'check-out'} · ${_clockLabel(DateTime.tryParse(claim['recordedAt'] as String? ?? '')?.toLocal())} · UNVERIFIED', style: const TextStyle(color: _brass, fontWeight: FontWeight.w800)),
                        ),
                        if (canWrite)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                            child: Wrap(spacing: 8, children: [
                              FilledButton.tonal(onPressed: () => _reviewAttendanceClaim(context, ref, eventId, claim['id'] as String, 'ACCEPTED'), child: const Text('Accept time')),
                              TextButton(onPressed: () => _reviewAttendanceClaim(context, ref, eventId, claim['id'] as String, 'REJECTED'), child: const Text('Reject')),
                            ]),
                          ),
                      ],
                      Padding(
                        padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                        child: Wrap(spacing: 8, runSpacing: 4, children: [
                          if (canWrite && state == 'DRAFT')
                            OutlinedButton(onPressed: () => _runShiftCommand(context, ref, eventId, shift['id'] as String, 'publish'), child: const Text('Publish')),
                          if (canWrite && state == 'DRAFT' && attendance == 'NOT_STARTED')
                            OutlinedButton.icon(onPressed: () => _suggestShiftAssignee(context, ref, eventId, shift), icon: const Icon(Icons.auto_awesome_outlined), label: const Text('Suggest staff')),
                          if (canWrite && state == 'PUBLISHED' && attendance == 'NOT_STARTED')
                            TextButton(onPressed: () => _runShiftCommand(context, ref, eventId, shift['id'] as String, 'cancel'), child: const Text('Cancel shift')),
                          if (canWrite && attendance != 'NOT_STARTED')
                            OutlinedButton(onPressed: () => _correctAttendance(context, ref, eventId, shift), child: const Text('Correct attendance')),
                          if (shift['assignedSubject'] == null && state == 'PUBLISHED')
                            FilledButton(onPressed: () => _runShiftCommand(context, ref, eventId, shift['id'] as String, 'claim'), child: const Text('Claim shift')),
                          if (assignedToMe && state == 'PUBLISHED' && response == 'PENDING') ...[
                            FilledButton(onPressed: () => _respondToShift(context, ref, eventId, shift['id'] as String, 'ACKNOWLEDGED'), child: const Text('Acknowledge')),
                            TextButton(onPressed: () => _respondToShift(context, ref, eventId, shift['id'] as String, 'DECLINED'), child: const Text('Decline')),
                          ],
                          if (assignedToMe && state == 'PUBLISHED' && response == 'ACKNOWLEDGED' && !currentResponse)
                            FilledButton(onPressed: () => _respondToShift(context, ref, eventId, shift['id'] as String, 'ACKNOWLEDGED'), child: const Text('Review changes')),
                          if (assignedToMe && state == 'PUBLISHED' && response == 'ACKNOWLEDGED' && currentResponse && attendance == 'NOT_STARTED')
                            if (hasPendingCheckIn && hasPendingCheckOut)
                              const Text('Check-out time is waiting for sync and supervisor review.')
                            else if (hasPendingCheckIn)
                              OutlinedButton(onPressed: () => _recordShiftAttendance(context, ref, eventId, shift['id'] as String, 'CHECK_OUT', queueForReview: true), child: const Text('Queue check-out time'))
                            else
                              FilledButton(onPressed: () => _recordShiftAttendance(context, ref, eventId, shift['id'] as String, 'CHECK_IN'), child: const Text('Check in')),
                          if (assignedToMe && attendance == 'CHECKED_IN')
                            if (hasPendingCheckOut)
                              const Text('Check-out time is awaiting supervisor review.')
                            else if (activeBreak != null)
                              FilledButton.tonal(onPressed: () => _runShiftCommand(context, ref, eventId, shift['id'] as String, 'break/end'), child: const Text('End break'))
                            else ...[
                              OutlinedButton(onPressed: () => _runShiftCommand(context, ref, eventId, shift['id'] as String, 'break/start', data: {'kind': 'REST'}), child: const Text('Start rest break')),
                              OutlinedButton(onPressed: () => _runShiftCommand(context, ref, eventId, shift['id'] as String, 'break/start', data: {'kind': 'MEAL'}), child: const Text('Start meal break')),
                              FilledButton(onPressed: () => _recordShiftAttendance(context, ref, eventId, shift['id'] as String, 'CHECK_OUT'), child: const Text('Check out')),
                            ],
                        ]),
                      ),
                    ]),
                  ),
                );
              },
            )),
          ]),
    );
  }
}

class _TeamAvailabilityPanel extends ConsumerStatefulWidget {
  const _TeamAvailabilityPanel({required this.eventId, required this.initialDate});
  final String eventId;
  final DateTime initialDate;

  @override
  ConsumerState<_TeamAvailabilityPanel> createState() => _TeamAvailabilityPanelState();
}

class _TeamAvailabilityPanelState extends ConsumerState<_TeamAvailabilityPanel> {
  late DateTime _weekStart = _monday(widget.initialDate);
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final weekEnd = _weekStart.add(const Duration(days: 7));
    final request = (eventId: widget.eventId, from: _weekStart, to: weekEnd);
    final availability = _expanded ? ref.watch(teamAvailabilityProvider(request)) : null;
    return Card(
      child: ExpansionTile(
        leading: const Icon(Icons.calendar_view_week_outlined),
        title: const Text('Team availability'),
        subtitle: Text('${_weekLabel(_weekStart, weekEnd)} · assigned roster only'),
        onExpansionChanged: (value) => setState(() => _expanded = value),
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              IconButton(tooltip: 'Previous week', onPressed: () => setState(() => _weekStart = _weekStart.subtract(const Duration(days: 7))), icon: const Icon(Icons.chevron_left)),
              Text(_weekLabel(_weekStart, weekEnd), style: Theme.of(context).textTheme.titleSmall),
              IconButton(tooltip: 'Next week', onPressed: () => setState(() => _weekStart = _weekStart.add(const Duration(days: 7))), icon: const Icon(Icons.chevron_right)),
            ]),
          ),
          if (availability != null)
            availability.when(
              loading: () => const Padding(padding: EdgeInsets.all(20), child: LinearProgressIndicator()),
              error: (error, _) => ListTile(title: const Text('Team availability unavailable'), subtitle: Text('$error')),
              data: (items) => items.isEmpty
                  ? const Padding(padding: EdgeInsets.fromLTRB(16, 4, 16, 16), child: Text('No one on this roster has recorded unavailable time this week.'))
                  : SizedBox(
                      height: 190,
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.fromLTRB(8, 0, 8, 12),
                        children: List.generate(7, (index) {
                          final day = _weekStart.add(Duration(days: index));
                          final nextDay = day.add(const Duration(days: 1));
                          final matches = items.where((raw) {
                            final item = Map<String, dynamic>.from(raw as Map);
                            final start = DateTime.tryParse(item['startsAt'] as String? ?? '')?.toLocal();
                            final end = DateTime.tryParse(item['endsAt'] as String? ?? '')?.toLocal();
                            return start != null && end != null && start.isBefore(nextDay) && end.isAfter(day);
                          }).toList();
                          return SizedBox(
                            width: 124,
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text('${_weekdayName(day.weekday)} ${day.month}/${day.day}', style: Theme.of(context).textTheme.labelLarge),
                              const Divider(height: 12),
                              Expanded(child: matches.isEmpty
                                  ? const Text('No block recorded', style: TextStyle(color: Colors.grey))
                                  : ListView.builder(
                                      itemCount: matches.length,
                                      itemBuilder: (context, rowIndex) {
                                        final item = Map<String, dynamic>.from(matches[rowIndex] as Map);
                                        final start = DateTime.parse(item['startsAt'] as String).toLocal();
                                        final end = DateTime.parse(item['endsAt'] as String).toLocal();
                                        return Container(
                                          margin: const EdgeInsets.only(bottom: 6),
                                          padding: const EdgeInsets.all(7),
                                          decoration: BoxDecoration(color: Theme.of(context).colorScheme.errorContainer, borderRadius: BorderRadius.circular(10)),
                                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                            Text(item['displayName'] as String? ?? 'Roster member', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
                                            Text(_shiftTimeLabel(start, end), style: Theme.of(context).textTheme.bodySmall),
                                          ]),
                                        );
                                      },
                                    )),
                            ]),
                          );
                        }),
                      ),
                    ),
            ),
        ],
      ),
    );
  }
}

DateTime _monday(DateTime value) {
  final day = DateTime(value.year, value.month, value.day);
  return day.subtract(Duration(days: day.weekday - DateTime.monday));
}

String _weekdayName(int weekday) => const ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][weekday - 1];

String _weekLabel(DateTime start, DateTime end) {
  final last = end.subtract(const Duration(days: 1));
  return '${start.month}/${start.day}–${last.month}/${last.day}';
}

class _MyUnavailabilityPanel extends ConsumerWidget {
  const _MyUnavailabilityPanel();

  @override
  Widget build(BuildContext context, WidgetRef ref) => Card(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(
            title: const Text('My unavailable time'),
            subtitle: const Text('Tell schedulers which days you cannot work.'),
            trailing: TextButton(onPressed: () async {
              final now = DateTime.now();
              final day = await showDatePicker(context: context, initialDate: now.add(const Duration(days: 1)), firstDate: now, lastDate: now.add(const Duration(days: 730)));
              if (day == null || !context.mounted) return;
              try {
                await ref.read(operationsApiProvider).createUnavailability(DateTime(day.year, day.month, day.day), DateTime(day.year, day.month, day.day).add(const Duration(days: 1)));
                ref.invalidate(myUnavailabilityProvider);
              } catch (error) {
                if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not save unavailable time: $error')));
              }
            }, child: const Text('Block a day')),
          ),
          ref.watch(myUnavailabilityProvider).when(
            loading: () => const LinearProgressIndicator(),
            error: (error, _) => ListTile(title: const Text('Availability could not be loaded'), subtitle: Text('$error')),
            data: (rows) => Column(children: rows.map((item) {
              final row = Map<String, dynamic>.from(item as Map);
              final start = DateTime.tryParse(row['startsAt'] as String? ?? '')?.toLocal();
              return ListTile(
                dense: true,
                leading: const Icon(Icons.event_busy_outlined),
                title: Text(start == null ? 'Unavailable time' : '${start.month}/${start.day}'),
                trailing: IconButton(tooltip: 'Remove unavailable time', icon: const Icon(Icons.delete_outline), onPressed: () async {
                  try {
                    await ref.read(operationsApiProvider).deleteUnavailability(row['id'] as String);
                    ref.invalidate(myUnavailabilityProvider);
                  } catch (error) {
                    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not remove unavailable time: $error')));
                  }
                }),
              );
            }).toList()),
          ),
        ]),
      );
}

String _shiftTimeLabel(DateTime? start, DateTime? end) {
  if (start == null || end == null) return 'Time unavailable';
  String time(DateTime value) {
    final hour = value.hour % 12 == 0 ? 12 : value.hour % 12;
    return '$hour:${value.minute.toString().padLeft(2, '0')} ${value.hour < 12 ? 'AM' : 'PM'}';
  }
  return '${start.month}/${start.day} · ${time(start)}–${time(end)}';
}

String _clockLabel(DateTime? value) {
  if (value == null) return 'time unavailable';
  final hour = value.hour % 12 == 0 ? 12 : value.hour % 12;
  return '$hour:${value.minute.toString().padLeft(2, '0')} ${value.hour < 12 ? 'AM' : 'PM'}';
}

String _attendanceTimeLabel(Map<String, dynamic> shift) {
  final checkedIn = DateTime.tryParse(shift['checkedInAt'] as String? ?? '')?.toLocal();
  final checkedOut = DateTime.tryParse(shift['checkedOutAt'] as String? ?? '')?.toLocal();
  return 'In ${_clockLabel(checkedIn)}${checkedOut == null ? '' : ' · Out ${_clockLabel(checkedOut)}'}';
}

class _CoveragePlanningPanel extends ConsumerWidget {
  const _CoveragePlanningPanel({required this.eventId, required this.venueId, required this.initialDate, required this.locations});
  final String eventId;
  final String venueId;
  final DateTime initialDate;
  final List<Map<String, dynamic>> locations;

  @override
  Widget build(BuildContext context, WidgetRef ref) => Card(
    child: Column(children: [
      ListTile(
        leading: const Icon(Icons.groups_2_outlined),
        title: const Text('Coverage plan'),
        subtitle: const Text('Set role demand, see scheduled capacity, and create draft open shifts for gaps.'),
        trailing: Row(mainAxisSize: MainAxisSize.min, children: [
          IconButton(tooltip: 'Suggest from past event plans', onPressed: () => _forecast(context, ref), icon: const Icon(Icons.auto_graph_outlined)),
          IconButton(tooltip: 'Add coverage requirement', onPressed: () => _add(context, ref), icon: const Icon(Icons.add_circle_outline)),
        ]),
      ),
      ref.watch(staffingCoverageProvider(eventId)).when(
        loading: () => const LinearProgressIndicator(),
        error: (error, _) => ListTile(title: Text('Coverage unavailable: $error')),
        data: (rows) => rows.isEmpty
          ? const Padding(padding: EdgeInsets.fromLTRB(16, 0, 16, 12), child: Align(alignment: Alignment.centerLeft, child: Text('No coverage requirements yet. Add a role and target to see gaps.')))
          : ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 210),
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: rows.length,
                itemBuilder: (context, index) {
                  final row = Map<String, dynamic>.from(rows[index] as Map);
                  final remaining = row['unfilledHeadcount'] as int? ?? 0;
                  final published = row['publishedHeadcount'] as int? ?? 0;
                  final scheduled = row['scheduledHeadcount'] as int? ?? 0;
                  final confirmed = row['confirmedHeadcount'] as int? ?? 0;
                  final unconfirmed = row['unconfirmedHeadcount'] as int? ?? 0;
                  final vendorRequested = row['vendorRequestedHeadcount'] as int? ?? 0;
                  final vendorCommitted = row['vendorCommittedHeadcount'] as int? ?? 0;
                  final locationId = row['locationId'] as String?;
                  final matches = locations.where((location) => location['id'] == locationId);
                  final area = matches.isEmpty ? 'All areas' : matches.first['name'] as String? ?? 'Area';
                  final start = DateTime.tryParse(row['startsAt'] as String? ?? '')?.toLocal();
                  final end = DateTime.tryParse(row['endsAt'] as String? ?? '')?.toLocal();
                  return ListTile(
                    dense: true,
                    title: Text('${row['role']} · $area'),
                    subtitle: Text('${_shiftTimeLabel(start, end)} · $confirmed/${row['requiredHeadcount']} acknowledged · $scheduled/${row['requiredHeadcount']} scheduled ($published published)${remaining > 0 ? ' · $remaining unreserved slots' : ''}${unconfirmed > 0 ? ' · $unconfirmed need assignment or worker confirmation' : ''}${vendorCommitted > 0 ? ' · $vendorCommitted vendor committed (not named on roster)' : ''}${vendorRequested > vendorCommitted ? ' · ${vendorRequested - vendorCommitted} vendor requested, awaiting commitment' : ''}'),
                    trailing: Column(mainAxisSize: MainAxisSize.min, children: [
                      IconButton(tooltip: 'Adjust demand target', onPressed: () => _adjustTarget(context, ref, row), icon: const Icon(Icons.edit_outlined)),
                      if (remaining > 0)
                        TextButton(onPressed: () => _generate(context, ref, row['id'] as String), child: Text('Fill $remaining'))
                      else
                        Icon(unconfirmed > 0 ? Icons.pending_actions_outlined : Icons.check_circle_outline, color: unconfirmed > 0 ? _brass : _pine),
                    ]),
                  );
                },
              ),
            ),
      ),
    ]),
  );

  Future<void> _forecast(BuildContext context, WidgetRef ref) async {
    try {
      final rows = await ref.read(operationsApiProvider).coverageForecast(eventId);
      if (!context.mounted) return;
      if (rows.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No earlier event plans are available to forecast this venue yet.')));
        return;
      }
      final selected = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Planning history'),
          content: SizedBox(width: 480, height: 360, child: Column(children: [
            const Text('These suggestions summarize prior staffing plans. They are not forecasts from attendance, ticket sales, or live venue data.'),
            const SizedBox(height: 8),
            Expanded(child: ListView(children: rows.map((raw) {
              final row = Map<String, dynamic>.from(raw as Map);
              final start = initialDate.add(Duration(minutes: row['startsOffsetMinutes'] as int));
              final end = initialDate.add(Duration(minutes: row['endsOffsetMinutes'] as int));
              final area = locations.where((item) => item['id'] == row['locationId']).firstOrNull;
              final areaName = area?['name'] as String? ?? 'All areas';
              return ListTile(
                leading: const Icon(Icons.history),
                title: Text('${row['role']} · $areaName · ${row['requiredHeadcount']} staff'),
                subtitle: Text('${_shiftTimeLabel(start, end)} · ${row['sampleCount']} plans across ${row['sampleEventCount']} earlier events · ${row['confidence'] == 'LIMITED_HISTORY' ? 'limited history' : 'historical baseline'}'),
                onTap: () => Navigator.pop(dialogContext, row),
              );
            }).toList())),
          ])),
          actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel'))],
        ),
      );
      if (selected != null && context.mounted) await _add(context, ref, forecast: selected);
    } catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not load planning history: $error')));
    }
  }

  Future<void> _add(BuildContext context, WidgetRef ref, {Map<String, dynamic>? forecast}) async {
    final role = TextEditingController(text: forecast?['role'] as String? ?? '');
    final headcount = TextEditingController(text: '${forecast?['requiredHeadcount'] ?? 1}');
    DateTime startsAt = initialDate.add(Duration(minutes: forecast?['startsOffsetMinutes'] as int? ?? 0));
    DateTime endsAt = forecast == null
        ? initialDate.add(const Duration(hours: 4))
        : initialDate.add(Duration(minutes: forecast['endsOffsetMinutes'] as int));
    String? locationId = forecast?['locationId'] as String?;
    final demand = await showDialog<Map<String, Object?>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(builder: (context, setState) => AlertDialog(
        title: const Text('Set staffing demand'),
        content: SizedBox(width: 440, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: role, maxLength: 120, decoration: const InputDecoration(labelText: 'Role', hintText: 'e.g. Concourse usher')),
          TextField(controller: headcount, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'People required')),
          if (forecast != null) ...[
            const SizedBox(height: 8),
            Text('Suggested from ${forecast['sampleEventCount']} earlier event plans. Review and adjust before saving.'),
            if ((forecast['requiredQualificationCodes'] as List? ?? const []).isNotEmpty)
              Text('Common qualifications: ${(forecast['requiredQualificationCodes'] as List).join(', ')}'),
          ],
          const SizedBox(height: 8),
          DropdownButtonFormField<String?>(
            initialValue: locationId,
            decoration: const InputDecoration(labelText: 'Area'),
            items: [const DropdownMenuItem<String?>(value: null, child: Text('All areas')), ...locations.map((row) => DropdownMenuItem<String?>(value: row['id'] as String, child: Text(row['name'] as String? ?? 'Area')))],
            onChanged: (value) => setState(() => locationId = value),
          ),
          ListTile(contentPadding: EdgeInsets.zero, title: const Text('Coverage starts'), subtitle: Text(_shiftTimeLabel(startsAt, startsAt)), trailing: const Icon(Icons.edit_calendar), onTap: () async {
            final value = await _pickAttendanceDateTime(context, startsAt);
            if (value != null) setState(() { startsAt = value; if (!endsAt.isAfter(startsAt)) endsAt = startsAt.add(const Duration(hours: 4)); });
          }),
          ListTile(contentPadding: EdgeInsets.zero, title: const Text('Coverage ends'), subtitle: Text(_shiftTimeLabel(endsAt, endsAt)), trailing: const Icon(Icons.edit_calendar), onTap: () async {
            final value = await _pickAttendanceDateTime(context, endsAt);
            if (value != null) setState(() => endsAt = value);
          }),
        ]))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
          FilledButton(onPressed: () {
            final count = int.tryParse(headcount.text.trim());
            if (role.text.trim().length < 2 || count == null || count < 1 || count > 500 || !endsAt.isAfter(startsAt)) return;
            Navigator.pop(dialogContext, {
              'venueId': venueId,
              if (locationId != null) 'locationId': locationId,
              'role': role.text.trim(), 'startsAt': startsAt.toUtc().toIso8601String(),
              'endsAt': endsAt.toUtc().toIso8601String(), 'requiredHeadcount': count,
              if (forecast != null && (forecast['requiredQualificationCodes'] as List? ?? const []).isNotEmpty)
                'requiredQualificationCodes': List<String>.from(forecast['requiredQualificationCodes'] as List),
            });
          }, child: const Text('Save target')),
        ],
      )),
    );
    role.dispose();
    headcount.dispose();
    if (demand == null) return;
    try {
      await ref.read(operationsApiProvider).createCoverageRequirement(eventId, demand);
      ref.invalidate(staffingCoverageProvider(eventId));
    } catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not save coverage: $error')));
    }
  }

  Future<void> _generate(BuildContext context, WidgetRef ref, String demandId) async {
    try {
      final result = await ref.read(operationsApiProvider).generateCoverageShifts(eventId, demandId);
      ref.invalidate(staffingCoverageProvider(eventId));
      ref.invalidate(eventShiftsProvider(eventId));
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Created ${(result['createdShifts'] as List? ?? const []).length} draft open shifts. Assign and publish them from the schedule.')));
    } catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not generate draft shifts: $error')));
    }
  }

  Future<void> _adjustTarget(BuildContext context, WidgetRef ref, Map<String, dynamic> row) async {
    final target = TextEditingController(text: '${row['requiredHeadcount']}');
    final reason = TextEditingController();
    final values = await showDialog<Map<String, Object?>>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Adjust coverage target'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: target, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'People required (1–500)')),
          TextField(controller: reason, maxLength: 500, minLines: 2, maxLines: 3, decoration: const InputDecoration(labelText: 'Reason', border: OutlineInputBorder())),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
          FilledButton(onPressed: () {
            final count = int.tryParse(target.text.trim());
            if (count == null || count < 1 || count > 500 || reason.text.trim().length < 3) return;
            Navigator.pop(dialogContext, {'requiredHeadcount': count, 'reason': reason.text.trim()});
          }, child: const Text('Save target')),
        ],
      ),
    );
    target.dispose();
    reason.dispose();
    if (values == null) return;
    try {
      await ref.read(operationsApiProvider).updateCoverageRequirement(eventId, row['id'] as String, values);
      ref.invalidate(staffingCoverageProvider(eventId));
    } catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not update demand target: $error')));
    }
  }
}

Future<DateTime?> _pickAttendanceDateTime(BuildContext context, DateTime initial) async {
  final date = await showDatePicker(context: context, initialDate: initial, firstDate: DateTime(initial.year - 2), lastDate: DateTime.now().add(const Duration(days: 2)));
  if (date == null || !context.mounted) return null;
  final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(initial));
  if (time == null) return null;
  return DateTime(date.year, date.month, date.day, time.hour, time.minute);
}

Future<void> _correctAttendance(BuildContext context, WidgetRef ref, String eventId, Map<String, dynamic> shift) async {
  DateTime? checkedInAt = DateTime.tryParse(shift['checkedInAt'] as String? ?? '')?.toLocal();
  DateTime? checkedOutAt = DateTime.tryParse(shift['checkedOutAt'] as String? ?? '')?.toLocal();
  final reason = TextEditingController();
  final correction = await showDialog<Map<String, Object?>>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(builder: (context, setState) => AlertDialog(
      title: const Text('Correct attendance'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('The original times remain in the audit history. Add the reason for this correction.'),
        ListTile(contentPadding: EdgeInsets.zero, title: const Text('Check-in'), subtitle: Text(_shiftTimeLabel(checkedInAt, checkedInAt)), trailing: const Icon(Icons.edit_calendar), onTap: () async {
          final value = await _pickAttendanceDateTime(context, checkedInAt ?? DateTime.now());
          if (value != null) setState(() => checkedInAt = value);
        }),
        if (checkedOutAt != null) ListTile(contentPadding: EdgeInsets.zero, title: const Text('Check-out'), subtitle: Text(_shiftTimeLabel(checkedOutAt, checkedOutAt)), trailing: const Icon(Icons.edit_calendar), onTap: () async {
          final value = await _pickAttendanceDateTime(context, checkedOutAt ?? DateTime.now());
          if (value != null) setState(() => checkedOutAt = value);
        }),
        TextField(controller: reason, maxLength: 500, minLines: 2, maxLines: 4, decoration: const InputDecoration(labelText: 'Reason', border: OutlineInputBorder())),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
        FilledButton(onPressed: () {
          if (reason.text.trim().length < 3 || checkedInAt == null) return;
          Navigator.pop(dialogContext, {
            'checkedInAt': checkedInAt!.toUtc().toIso8601String(),
            if (checkedOutAt != null) 'checkedOutAt': checkedOutAt!.toUtc().toIso8601String(),
            'reason': reason.text.trim(),
          });
        }, child: const Text('Save correction')),
      ],
    )),
  );
  reason.dispose();
  if (correction == null) return;
  try {
    await ref.read(operationsApiProvider).correctAttendance(eventId, shift['id'] as String, correction);
    ref.invalidate(eventShiftsProvider(eventId));
  } catch (error) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not correct attendance: $error')));
  }
}

Future<void> _runShiftCommand(BuildContext context, WidgetRef ref, String eventId, String shiftId, String action, {Map<String, Object?>? data}) async {
  try {
    await ref.read(operationsApiProvider).shiftCommand(eventId, shiftId, action, data: data);
    ref.invalidate(eventShiftsProvider(eventId));
  } catch (error) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not $action shift: $error')));
  }
}

Future<void> _recordShiftAttendance(BuildContext context, WidgetRef ref, String eventId, String shiftId, String action, {bool queueForReview = false}) async {
  try {
    final queued = await ref.read(staffAttendanceOutboxProvider.notifier).record(eventId, shiftId, action, queueForReview: queueForReview);
    if (!queued) ref.invalidate(eventShiftsProvider(eventId));
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(queued
        ? 'Saved on this device. It will sync as unverified attendance for supervisor review.'
        : '${action == 'CHECK_IN' ? 'Checked in' : 'Checked out'} with server time.')));
    }
  } catch (error) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not record attendance: $error')));
  }
}

Future<void> _syncStaffAttendance(BuildContext context, WidgetRef ref, String eventId) async {
  await ref.read(staffAttendanceOutboxProvider.notifier).synchronize();
  ref.invalidate(eventShiftsProvider(eventId));
  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Attendance sync attempted. Any device-recorded times still need supervisor review.')));
}

Future<void> _reviewAttendanceClaim(BuildContext context, WidgetRef ref, String eventId, String claimId, String decision) async {
  final reasonController = TextEditingController();
  final result = await showDialog<Map<String, String>>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(decision == 'ACCEPTED' ? 'Accept offline time?' : 'Reject offline time?'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('This timestamp came from the worker device. Record why you are reviewing it this way.'),
        const SizedBox(height: 12),
        TextField(controller: reasonController, autofocus: true, maxLength: 500, minLines: 2, maxLines: 4, decoration: const InputDecoration(labelText: 'Review reason', border: OutlineInputBorder())),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
        FilledButton(onPressed: () {
          final reason = reasonController.text.trim();
          if (reason.length < 3) return;
          Navigator.pop(dialogContext, {'decision': decision, 'reason': reason});
        }, child: Text(decision == 'ACCEPTED' ? 'Accept time' : 'Reject')),
      ],
    ),
  );
  reasonController.dispose();
  if (result == null) return;
  try {
    await ref.read(operationsApiProvider).decideOfflineAttendance(eventId, claimId, result['decision']!, result['reason']!);
    ref.invalidate(eventShiftsProvider(eventId));
  } catch (error) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not review attendance: $error')));
  }
}

Future<void> _respondToShift(BuildContext context, WidgetRef ref, String eventId, String shiftId, String response) async {
  try {
    await ref.read(operationsApiProvider).respondToShift(eventId, shiftId, response);
    ref.invalidate(eventShiftsProvider(eventId));
  } catch (error) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not update shift response: $error')));
  }
}

Future<void> _suggestShiftAssignee(BuildContext context, WidgetRef ref, String eventId, Map<String, dynamic> shift) async {
  try {
    final result = await ref.read(operationsApiProvider).shiftAssignmentSuggestions(eventId, shift['id'] as String);
    final recommendations = (result['recommendations'] as List? ?? const [])
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
    if (!context.mounted) return;
    if (recommendations.isEmpty) {
      final message = result['message'] as String? ?? 'No eligible workers were found.';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
      return;
    }
    final selected = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Eligible staff suggestions'),
        content: SizedBox(
          width: 460,
          height: MediaQuery.sizeOf(context).height * 0.55,
          child: Column(children: [
            const Text('Ranked by lowest scheduled minutes in this event. “No recorded conflict” does not mean the worker explicitly confirmed availability.'),
            const SizedBox(height: 8),
            Expanded(child: ListView.builder(
              itemCount: recommendations.length,
              itemBuilder: (context, index) {
                final candidate = recommendations[index];
                final minutes = candidate['eventAssignedMinutes'] as int? ?? 0;
                final shifts = candidate['eventAssignedShifts'] as int? ?? 0;
                return ListTile(
                  leading: const CircleAvatar(child: Icon(Icons.person_outline)),
                  title: Text(candidate['displayName'] as String? ?? 'Roster member'),
                  subtitle: Text('${(minutes / 60).toStringAsFixed(1)} scheduled hours · $shifts event shifts · no recorded schedule conflict'),
                  onTap: () => Navigator.pop(dialogContext, candidate),
                );
              },
            )),
          ]),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel'))],
      ),
    );
    if (selected == null || !context.mounted) return;
    await ref.read(operationsApiProvider).updateShift(eventId, shift['id'] as String, {'assignedSubject': selected['subject'] as String});
    ref.invalidate(eventShiftsProvider(eventId));
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${selected['displayName']} assigned to the draft. Publish it when ready.')));
  } catch (error) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not suggest or assign staff: $error')));
  }
}

Future<void> _newLiveShift(
  BuildContext context,
  WidgetRef ref,
  Map<String, dynamic> event,
  List<Map<String, dynamic>> allLocations,
  List<String> assignableUserIds,
  List<Map<String, dynamic>> allPeople,
) async {
  final role = TextEditingController();
  final instructions = TextEditingController();
  final qualificationCodes = TextEditingController();
  final eventStart = DateTime.tryParse(event['startsAt'] as String? ?? '')?.toLocal() ?? DateTime.now();
  var startsAt = eventStart;
  var endsAt = eventStart.add(const Duration(hours: 4));
  var locationId = <Map<String, dynamic>>[];
  var assignedSubject = <Map<String, dynamic>>[];
  final venueId = event['venueId'] as String;
  final locations = allLocations.where((item) => item['venueId'] == venueId).toList();
  final assignablePeople = allPeople.where((item) => assignableUserIds.contains(item['externalSubject'])).toList();
  Future<DateTime?> pickDateTime(DateTime current) async {
    final date = await showDatePicker(context: context, initialDate: current, firstDate: DateTime(2000), lastDate: DateTime(2100));
    if (date == null || !context.mounted) return null;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(current));
    if (time == null) return null;
    return DateTime(date.year, date.month, date.day, time.hour, time.minute);
  }
  final input = await showDialog<Map<String, Object?>>(
    context: context,
    builder: (context) => StatefulBuilder(builder: (context, setState) => AlertDialog(
      title: const Text('Schedule a shift'),
      content: SizedBox(width: 480, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: role, autofocus: true, decoration: const InputDecoration(labelText: 'Role', hintText: 'Guest services')),
        const SizedBox(height: 8),
        DropdownButtonFormField<String?>(initialValue: locationId.isEmpty ? null : locationId.first['id'] as String, decoration: const InputDecoration(labelText: 'Area'), items: [
          const DropdownMenuItem<String?>(value: null, child: Text('All areas')),
          ...locations.map((item) => DropdownMenuItem<String?>(value: item['id'] as String, child: Text(item['name'] as String? ?? 'Area'))),
        ], onChanged: (value) => setState(() => locationId = value == null ? [] : [locations.firstWhere((item) => item['id'] == value)])),
        const SizedBox(height: 8),
        DropdownButtonFormField<String?>(initialValue: assignedSubject.isEmpty ? null : assignedSubject.first['externalSubject'] as String, decoration: const InputDecoration(labelText: 'Assigned worker'), items: [
          const DropdownMenuItem<String?>(value: null, child: Text('Leave as open shift')),
          ...assignablePeople.map((item) => DropdownMenuItem<String?>(value: item['externalSubject'] as String, child: Text(item['displayName'] as String? ?? 'Worker'))),
        ], onChanged: (value) => setState(() => assignedSubject = value == null ? [] : [assignablePeople.firstWhere((item) => item['externalSubject'] == value)])),
        const SizedBox(height: 8),
        ListTile(contentPadding: EdgeInsets.zero, title: const Text('Starts'), subtitle: Text(_shiftTimeLabel(startsAt, startsAt)), trailing: const Icon(Icons.edit_calendar), onTap: () async { final value = await pickDateTime(startsAt); if (value != null) setState(() => startsAt = value); }),
        ListTile(contentPadding: EdgeInsets.zero, title: const Text('Ends'), subtitle: Text(_shiftTimeLabel(endsAt, endsAt)), trailing: const Icon(Icons.edit_calendar), onTap: () async { final value = await pickDateTime(endsAt); if (value != null) setState(() => endsAt = value); }),
        TextField(controller: qualificationCodes, decoration: const InputDecoration(labelText: 'Required qualification codes (optional)', hintText: 'FOOD_HANDLER, ALCOHOL_SERVICE', helperText: 'Codes must match active credentials in the tenant roster.')),
        TextField(controller: instructions, decoration: const InputDecoration(labelText: 'Instructions (optional)'), minLines: 1, maxLines: 3),
      ]))),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), FilledButton(onPressed: () {
        if (role.text.trim().length < 2 || endsAt.isBefore(startsAt) || endsAt.isAtSameMomentAs(startsAt)) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Add a role and make sure the end is after the start.')));
          return;
        }
        Navigator.pop(context, {
          'venueId': venueId,
          if (locationId.isNotEmpty) 'locationId': locationId.first['id'] as String,
          if (assignedSubject.isNotEmpty) 'assignedSubject': assignedSubject.first['externalSubject'] as String,
          'role': role.text.trim(),
          'instructions': instructions.text.trim(),
          if (qualificationCodes.text.trim().isNotEmpty) 'requiredQualificationCodes': qualificationCodes.text.split(',').map((code) => code.trim().toUpperCase()).where((code) => code.isNotEmpty).toSet().toList(),
          'startsAt': startsAt.toUtc().toIso8601String(),
          'endsAt': endsAt.toUtc().toIso8601String(),
        });
      }, child: const Text('Save draft'))],
    )),
  );
  role.dispose();
  instructions.dispose();
  qualificationCodes.dispose();
  if (input == null) return;
  try {
    await ref.read(operationsApiProvider).createShift(event['id'] as String, input);
    ref.invalidate(eventShiftsProvider(event['id'] as String));
  } catch (error) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not save shift: $error')));
  }
}

class _TenantSetupPage extends StatelessWidget {
  const _TenantSetupPage(
      {required this.venues,
      required this.locations,
      required this.events,
      required this.people,
      required this.api,
      required this.onSaved});
  final List<Map<String, dynamic>> venues;
  final List<Map<String, dynamic>> locations;
  final List<Map<String, dynamic>> events;
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
        ...venues.map((v) => Card(child: ListTile(
            leading: const Icon(Icons.stadium_outlined),
            title: Text(v['name'] as String? ?? 'Venue'),
            trailing: IconButton(tooltip: 'Edit venue', icon: const Icon(Icons.edit_outlined), onPressed: () => _editVenue(context, v))))),
        if (locations.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text('Locations', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
          ...locations.map((location) {
            final venue = venues.where((item) => item['id'] == location['venueId']).firstOrNull;
            return Card(child: ListTile(
              leading: const Icon(Icons.place_outlined),
              title: Text(location['name'] as String? ?? 'Location'),
              subtitle: venue == null ? null : Text(venue['name'] as String? ?? ''),
              trailing: IconButton(tooltip: 'Edit location', icon: const Icon(Icons.edit_outlined), onPressed: () => _editLocation(context, location)),
            ));
          }),
        ],
        if (events.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text('Events', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
          ...events.map((event) {
            final venue = venues.where((item) => item['id'] == event['venueId']).firstOrNull;
            final startsAt = DateTime.tryParse(event['startsAt'] as String? ?? '')?.toLocal();
            final closed = (event['closeout'] as Map?)?['state'] == 'CLOSED';
            return Card(child: ListTile(
              leading: const Icon(Icons.event_outlined),
              title: Text(event['name'] as String? ?? 'Event'),
              subtitle: Text('${venue?['name'] ?? 'Venue'}${startsAt == null ? '' : ' · ${MaterialLocalizations.of(context).formatMediumDate(startsAt)} ${MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(startsAt))}'}${closed ? ' · Closed' : ''}'),
              trailing: IconButton(tooltip: closed ? 'Finalized events cannot be edited' : 'Edit event', icon: const Icon(Icons.edit_outlined), onPressed: closed ? null : () => _editEvent(context, event)),
            ));
          }),
        ],
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
              label: const Text('Add person')),
          OutlinedButton.icon(
              onPressed: () => _configureRestPolicy(context),
              icon: const Icon(Icons.schedule_outlined),
              label: const Text('Staffing rest policy'))
        ]),
        const SizedBox(height: 24),
        Text('People directory (${people.length})',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w800)),
        ...people.map((person) {
          final qualifications = (person['qualifications'] as List? ?? const [])
              .map((item) => Map<String, dynamic>.from(item as Map))
              .toList();
          return Card(child: Column(children: [
            ListTile(
              leading: const Icon(Icons.person_outline),
              title: Text(person['displayName'] as String? ?? 'Person'),
              subtitle: Text('${person['email'] as String? ?? ''}${person['active'] == false ? ' · Deactivated' : ''}'),
              trailing: PopupMenuButton<String>(
                tooltip: 'Manage person',
                onSelected: (action) {
                  if (action == 'qualification') _grantQualification(context, person);
                  if (action == 'activate' || action == 'deactivate') _setPersonActive(context, person, action == 'activate');
                },
                itemBuilder: (_) => [
                  const PopupMenuItem(value: 'qualification', child: ListTile(leading: Icon(Icons.workspace_premium_outlined), title: Text('Grant qualification'))),
                  if (person['provisioningSource'] == 'scim')
                    const PopupMenuItem(enabled: false, child: ListTile(leading: Icon(Icons.sync_lock_outlined), title: Text('Status managed by SCIM')))
                  else if (person['provisioningSource'] == 'unknown')
                    const PopupMenuItem(enabled: false, child: ListTile(leading: Icon(Icons.help_outline), title: Text('Roster source needs review')))
                  else
                    PopupMenuItem(value: person['active'] == false ? 'activate' : 'deactivate', child: ListTile(leading: Icon(person['active'] == false ? Icons.person_add_alt : Icons.person_off_outlined), title: Text(person['active'] == false ? 'Reactivate account' : 'Deactivate account'))),
                ],
              ),
            ),
            ...qualifications.map((qualification) {
              final expiry = DateTime.tryParse(qualification['expiresAt'] as String? ?? '');
              final expired = expiry != null && expiry.isBefore(DateTime.now());
              final evidenceStatus = qualification['evidenceStatus'] as String? ?? 'NONE';
              return Column(children: [
                ListTile(
                  dense: true,
                  leading: Icon(expired || evidenceStatus == 'REJECTED' ? Icons.warning_amber : evidenceStatus == 'VERIFIED' ? Icons.verified : evidenceStatus == 'PENDING_REVIEW' ? Icons.pending_outlined : Icons.workspace_premium_outlined),
                  title: Text('${qualification['name']} · ${qualification['code']}'),
                  subtitle: Text('${expiry == null ? 'No expiry recorded' : '${expired ? 'Expired' : 'Valid through'} ${expiry.month}/${expiry.day}/${expiry.year}'} · Evidence: ${evidenceStatus.replaceAll('_', ' ').toLowerCase()}${qualification['evidenceFileName'] == null ? '' : '\n${qualification['evidenceFileName']}'}${qualification['evidenceReviewReason'] == null ? '' : '\nReview: ${qualification['evidenceReviewReason']}'}'),
                  trailing: IconButton(tooltip: 'Revoke qualification', icon: const Icon(Icons.remove_circle_outline), onPressed: () async {
                    try {
                      await api.revokeQualification(qualification['id'] as String);
                      onSaved();
                    } catch (error) {
                      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not revoke credential: $error')));
                    }
                  }),
                ),
                Align(alignment: Alignment.centerLeft, child: Wrap(spacing: 4, children: [
                  if (evidenceStatus == 'NONE' || evidenceStatus == 'UPLOADING' || evidenceStatus == 'REJECTED') TextButton.icon(onPressed: () => _uploadQualificationEvidence(context, qualification), icon: const Icon(Icons.upload_file_outlined), label: Text(evidenceStatus == 'UPLOADING' ? 'Retry upload' : 'Upload photo')),
                  if (evidenceStatus == 'PENDING_REVIEW' || evidenceStatus == 'VERIFIED' || evidenceStatus == 'REJECTED') TextButton.icon(onPressed: () => _openQualificationEvidence(context, qualification), icon: const Icon(Icons.open_in_new), label: const Text('Open evidence')),
                  if (evidenceStatus == 'PENDING_REVIEW') FilledButton.tonalIcon(onPressed: () => _reviewQualificationEvidence(context, qualification), icon: const Icon(Icons.fact_check_outlined), label: const Text('Review')),
                ])),
              ]);
            }),
          ]));
        })
      ]);
  Future<void> _setPersonActive(BuildContext context, Map<String, dynamic> person, bool active) async {
    final name = person['displayName'] as String? ?? 'this person';
    if (!active) {
      final confirmed = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
        title: const Text('Deactivate account?'),
        content: Text('$name will lose access on their next API request. This does not disable their identity-provider account.'),
        actions: [TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Deactivate'))],
      ));
      if (confirmed != true) return;
    }
    try {
      await api.setPersonActive(person['id'] as String, active);
      onSaved();
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(active ? 'Account reactivated' : 'Account deactivated')));
    } catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not update account status: $error')));
    }
  }
  Future<void> _editVenue(BuildContext context, Map<String, dynamic> venue) => _editName(context, title: 'Edit venue', initialName: venue['name'] as String? ?? '', save: (name) => api.updateVenue(venue['id'] as String, name));
  Future<void> _editLocation(BuildContext context, Map<String, dynamic> location) => _editName(context, title: 'Edit location', initialName: location['name'] as String? ?? '', save: (name) => api.updateLocation(location['id'] as String, name));
  Future<void> _editName(BuildContext context, {required String title, required String initialName, required Future<void> Function(String) save}) async {
    final name = TextEditingController(text: initialName);
    try {
      final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: TextField(controller: name, autofocus: true, maxLength: 160, decoration: const InputDecoration(labelText: 'Name')),
        actions: [TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Save'))],
      ));
      if (accepted == true) {
        await save(name.text.trim());
        onSaved();
        if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Changes saved')));
      }
    } catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not save changes: $error')));
    } finally {
      name.dispose();
    }
  }
  Future<void> _editEvent(BuildContext context, Map<String, dynamic> event) async {
    final name = TextEditingController(text: event['name'] as String? ?? '');
    var startsAt = DateTime.tryParse(event['startsAt'] as String? ?? '')?.toLocal() ?? DateTime.now();
    try {
      final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => StatefulBuilder(builder: (context, setDialogState) => AlertDialog(
        title: const Text('Edit event'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: name, autofocus: true, maxLength: 160, decoration: const InputDecoration(labelText: 'Event name')),
          ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.schedule_outlined), title: const Text('Event start'), subtitle: Text('${MaterialLocalizations.of(context).formatMediumDate(startsAt)} · ${MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(startsAt))}'), onTap: () async {
            final date = await showDatePicker(context: context, initialDate: startsAt, firstDate: DateTime(2000), lastDate: DateTime(2100));
            if (date == null || !context.mounted) return;
            final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(startsAt));
            if (time != null) setDialogState(() => startsAt = DateTime(date.year, date.month, date.day, time.hour, time.minute));
          }),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Save'))],
      )));
      if (accepted == true) {
        await api.updateEvent(event['id'] as String, name: name.text.trim(), startsAt: startsAt);
        onSaved();
        if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Event updated')));
      }
    } catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not update event: $error')));
    } finally {
      name.dispose();
    }
  }
  Future<void> _configureRestPolicy(BuildContext context) async {
    final controller = TextEditingController();
    try {
      final policy = await api.staffingPolicy();
      final existing = policy['minimumRestMinutes'] as int?;
      controller.text = existing?.toString() ?? '';
      if (!context.mounted) return;
      final saved = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
        title: const Text('Minimum rest between shifts'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(existing == null ? 'Not configured. Scheduling an assigned worker is blocked until a rule is set.' : existing == 0 ? 'Configured with no additional rest gap; overlapping shifts remain blocked.' : 'Current rule: $existing minutes between a worker’s shifts.'),
          TextField(controller: controller, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Minutes (0–1440)', hintText: 'e.g. 600')),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')), FilledButton(onPressed: () {
          final value = int.tryParse(controller.text.trim());
          if (value == null || value < 0 || value > 1440) {
            ScaffoldMessenger.of(dialogContext).showSnackBar(const SnackBar(content: Text('Enter a whole number from 0 to 1440.')));
            return;
          }
          Navigator.pop(dialogContext, true);
        }, child: const Text('Save policy'))],
      ));
      if (saved == true) {
        final minutes = int.parse(controller.text.trim());
        await api.updateMinimumRestMinutes(minutes);
        onSaved();
      }
    } catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not load or save staffing policy: $error')));
    } finally {
      controller.dispose();
    }
  }
  Future<void> _grantQualification(BuildContext context, Map<String, dynamic> person) async {
    final code = TextEditingController();
    final name = TextEditingController();
    DateTime? expiresAt;
    final saved = await showDialog<bool>(context: context, builder: (dialogContext) => StatefulBuilder(builder: (context, setState) => AlertDialog(
      title: Text('Grant qualification to ${person['displayName']}'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: code, decoration: const InputDecoration(labelText: 'Code', hintText: 'FOOD_HANDLER')),
        TextField(controller: name, decoration: const InputDecoration(labelText: 'Credential name')),
        ListTile(contentPadding: EdgeInsets.zero, title: const Text('Valid through'), subtitle: Text(expiresAt == null ? 'No expiry' : '${expiresAt!.month}/${expiresAt!.day}/${expiresAt!.year}'), trailing: const Icon(Icons.event), onTap: () async {
          final today = DateTime.now();
          final date = await showDatePicker(context: context, initialDate: expiresAt ?? today.add(const Duration(days: 365)), firstDate: DateTime(today.year - 30), lastDate: DateTime(today.year + 30));
          if (date != null) setState(() => expiresAt = date);
        }),
        TextButton(onPressed: () => setState(() => expiresAt = null), child: const Text('Clear expiry')),
      ]),
      actions: [TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Grant'))],
    )));
    if (saved == true && context.mounted) {
      try {
        await api.grantQualification(person['id'] as String, code.text, name.text, expiresAt: expiresAt == null ? null : '${expiresAt!.year.toString().padLeft(4, '0')}-${expiresAt!.month.toString().padLeft(2, '0')}-${expiresAt!.day.toString().padLeft(2, '0')}');
        onSaved();
      } catch (error) {
        if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not grant credential: $error')));
      }
    }
    code.dispose();
    name.dispose();
  }
  Future<void> _uploadQualificationEvidence(BuildContext context, Map<String, dynamic> qualification) async {
    final source = await showModalBottomSheet<ImageSource>(context: context, builder: (context) => SafeArea(child: Wrap(children: [
      ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Choose certification photo'), onTap: () => Navigator.pop(context, ImageSource.gallery)),
      if (ApiConfiguration.allowCameraEvidence)
        ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Take certification photo'), onTap: () => Navigator.pop(context, ImageSource.camera)),
    ])));
    if (source == null || !context.mounted) return;
    try {
      final file = await ImagePicker().pickImage(source: source, imageQuality: 90);
      if (file == null) return;
      final bytes = await file.readAsBytes();
      final ext = file.name.split('.').last.toLowerCase();
      final contentType = switch (ext) { 'png' => 'image/png', 'webp' => 'image/webp', 'heic' || 'heif' => 'image/heic', 'jpg' || 'jpeg' => 'image/jpeg', _ => throw StateError('Choose a JPEG, PNG, WebP, or HEIC certification image.') };
      await api.uploadQualificationEvidence(qualification['id'] as String, file.name, contentType, bytes);
      onSaved();
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Certification uploaded. It must be reviewed before staffing can rely on it.')));
    } catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not upload certification: $error')));
    }
  }
  Future<void> _openQualificationEvidence(BuildContext context, Map<String, dynamic> qualification) async {
    try {
      final url = await api.qualificationEvidenceDownload(qualification['id'] as String);
      final uri = Uri.parse(url);
      if (uri.scheme != 'https' || uri.host.isEmpty) throw StateError('The evidence API returned an invalid private link.');
      if (kIsWeb) {
        await Clipboard.setData(ClipboardData(text: url));
        if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Private download link copied. It expires in five minutes; paste it into a browser to review the document.')));
      } else {
        await const MethodChannel('app.venuewranglerenterprise/external_url').invokeMethod<void>('openUrl', url);
      }
    } catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not open certification evidence: $error')));
    }
  }
  Future<void> _reviewQualificationEvidence(BuildContext context, Map<String, dynamic> qualification) async {
    final reason = TextEditingController();
    final decision = await showDialog<String>(context: context, builder: (dialogContext) => AlertDialog(
      title: Text('Review ${qualification['name']} evidence'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        const Text('Open the evidence first. Record the basis for accepting or rejecting this document.'),
        TextField(controller: reason, minLines: 2, maxLines: 4, decoration: const InputDecoration(labelText: 'Review rationale (required)', hintText: 'Issuer and expiry checked…')),
      ]),
      actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')), TextButton(onPressed: () { if (reason.text.trim().length < 3) { ScaffoldMessenger.of(dialogContext).showSnackBar(const SnackBar(content: Text('Enter a review rationale of at least 3 characters.'))); return; } Navigator.pop(dialogContext, 'REJECTED'); }, child: const Text('Reject')), FilledButton(onPressed: () { if (reason.text.trim().length < 3) { ScaffoldMessenger.of(dialogContext).showSnackBar(const SnackBar(content: Text('Enter a review rationale of at least 3 characters.'))); return; } Navigator.pop(dialogContext, 'VERIFIED'); }, child: const Text('Verify'))],
    ));
    if (decision != null) {
      try {
        await api.reviewQualificationEvidence(qualification['id'] as String, decision, reason.text);
        onSaved();
      } catch (error) {
        if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not save credential review: $error')));
      }
    }
    reason.dispose();
  }
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
  Position? locationEvidence;
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
                      if (ApiConfiguration.allowCameraEvidence)
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
                    if (ApiConfiguration.allowLocationEvidence)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: OutlinedButton.icon(
                        onPressed: () async {
                          try {
                            final position = await _captureIssueLocation();
                            if (position != null) setState(() => locationEvidence = position);
                          } catch (error) {
                            if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not capture location: $error')));
                          }
                        },
                        icon: Icon(locationEvidence == null ? Icons.add_location_alt_outlined : Icons.location_on),
                        label: Text(locationEvidence == null ? 'Add device location (optional)' : 'Location attached · ±${locationEvidence!.accuracy.toStringAsFixed(0)} m'),
                      ),
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
      latitude: locationEvidence?.latitude,
      longitude: locationEvidence?.longitude,
      locationAccuracyMeters: locationEvidence?.accuracy,
      locationCapturedAt: locationEvidence?.timestamp,
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

Future<Position?> _captureIssueLocation() async {
  if (!ApiConfiguration.allowLocationEvidence) {
    throw StateError('Location evidence is disabled by your organization.');
  }
  if (!await Geolocator.isLocationServiceEnabled()) {
    throw StateError('Turn on device location services, then try again.');
  }
  var permission = await Geolocator.checkPermission();
  if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
  if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
    throw StateError('Allow location access while using the app to attach location evidence.');
  }
  return Geolocator.getCurrentPosition(
    locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium, timeLimit: Duration(seconds: 15)),
  );
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
