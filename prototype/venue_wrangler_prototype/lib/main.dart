import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import 'auth/auth.dart';
import 'auth/sign_in_page.dart';
import 'features/issues/issue_outbox.dart';

void main() {
  runApp(const ProviderScope(child: VenueWranglerPrototype()));
}

const _ink = Color(0xFF16261F);
const _canvas = Color(0xFFF6F4EF);
const _paper = Color(0xFFFFFDF9);
const _pine = Color(0xFF1D5A43);
const _mint = Color(0xFFB9E7CC);
const _brass = Color(0xFFC88A2B);
const _coral = Color(0xFFC74B37);
const _blue = Color(0xFF245F9D);

final _roleProvider = StateProvider<Role>((_) => Role.eventManager);
final _pageProvider = StateProvider<AppPage>((_) => AppPage.today);
final _shiftAcknowledgedProvider = StateProvider<bool>((_) => false);
final _readyProvider = StateProvider<bool>((_) => false);
final _packedProvider = StateProvider<bool>((_) => false);
final _countSavedProvider = StateProvider<bool>((_) => false);

enum Role {
  frontline('Frontline worker', Icons.badge_outlined),
  supervisor('Supervisor', Icons.groups_2_outlined),
  eventManager('Event operations manager', Icons.radar_outlined),
  scheduler('Workforce scheduler', Icons.calendar_month_outlined),
  kitchen('Kitchen operator', Icons.room_service_outlined),
  inventory('Inventory manager', Icons.inventory_2_outlined),
  executive('Regional operator', Icons.insights_outlined);

  const Role(this.label, this.icon);
  final String label;
  final IconData icon;
}

enum AppPage {
  today('Today', Icons.today_outlined),
  command('Command', Icons.radar_outlined),
  plan('Plan', Icons.route_outlined),
  staffing('Staffing', Icons.groups_outlined),
  service('Service', Icons.room_service_outlined),
  stock('Stock', Icons.inventory_2_outlined),
  insights('Insights', Icons.insights_outlined);

  const AppPage(this.label, this.icon);
  final String label;
  final IconData icon;
}

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
    final auth = ref.watch(authSessionProvider);
    if (auth.loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return auth.session == null ? const SignInPage() : const PrototypeShell();
  }
}

class PrototypeShell extends ConsumerWidget {
  const PrototypeShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final role = ref.watch(_roleProvider);
    final page = ref.watch(_pageProvider);
    return LayoutBuilder(
      builder: (context, constraints) {
        final desktop = constraints.maxWidth >= 1024;
        final tablet = constraints.maxWidth >= 600;
        final pages = _pagesFor(role);
        final selectedPage = pages.contains(page) ? page : pages.first;
        if (page != selectedPage) {
          WidgetsBinding.instance.addPostFrameCallback(
            (_) => ref.read(_pageProvider.notifier).state = selectedPage,
          );
        }
        return Scaffold(
          body: SafeArea(
            child: Row(
              children: [
                if (desktop)
                  _NavigationRail(
                    pages: pages,
                    selected: selectedPage,
                    onSelected: (value) =>
                        ref.read(_pageProvider.notifier).state = value,
                  ),
                Expanded(
                  child: Column(
                    children: [
                      _ContextHeader(role: role, compact: !desktop),
                      Expanded(
                        child: Padding(
                          padding: EdgeInsets.fromLTRB(
                              tablet ? 24 : 16, 8, tablet ? 24 : 16, 16),
                          child: _PageView(
                              page: selectedPage,
                              tablet: tablet,
                              desktop: desktop),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          bottomNavigationBar: desktop
              ? null
              : NavigationBar(
                  selectedIndex: pages.indexOf(selectedPage),
                  onDestinationSelected: (index) =>
                      ref.read(_pageProvider.notifier).state = pages[index],
                  destinations: pages
                      .map((item) => NavigationDestination(
                          icon: Icon(item.icon), label: item.label))
                      .toList(),
                ),
          floatingActionButton: !desktop && selectedPage != AppPage.stock
              ? FloatingActionButton.extended(
                  onPressed: () => _reportIssue(context, ref),
                  backgroundColor: _coral,
                  foregroundColor: Colors.white,
                  icon: const Icon(Icons.add_alert_outlined),
                  label: const Text('Report issue'),
                )
              : null,
        );
      },
    );
  }
}

List<AppPage> _pagesFor(Role role) => switch (role) {
      Role.frontline => [AppPage.today, AppPage.staffing, AppPage.command],
      Role.supervisor => [
          AppPage.today,
          AppPage.command,
          AppPage.staffing,
          AppPage.service
        ],
      Role.eventManager => [
          AppPage.today,
          AppPage.command,
          AppPage.plan,
          AppPage.staffing,
          AppPage.insights
        ],
      Role.scheduler => [
          AppPage.today,
          AppPage.staffing,
          AppPage.command,
          AppPage.insights
        ],
      Role.kitchen => [
          AppPage.today,
          AppPage.service,
          AppPage.stock,
          AppPage.command
        ],
      Role.inventory => [
          AppPage.today,
          AppPage.stock,
          AppPage.command,
          AppPage.insights
        ],
      Role.executive => [AppPage.today, AppPage.insights, AppPage.command],
    };

class _NavigationRail extends StatelessWidget {
  const _NavigationRail(
      {required this.pages, required this.selected, required this.onSelected});
  final List<AppPage> pages;
  final AppPage selected;
  final ValueChanged<AppPage> onSelected;

  @override
  Widget build(BuildContext context) => Container(
        width: 238,
        padding: const EdgeInsets.all(16),
        color: _ink,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(12, 12, 12, 30),
              child: Row(children: [
                Icon(Icons.stadium_outlined, color: _mint),
                SizedBox(width: 10),
                Text('VENUE\nWRANGLER',
                    style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.4,
                        height: 1.05)),
              ]),
            ),
            ...pages.map((page) => Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: ListTile(
                    selected: page == selected,
                    selectedTileColor: const Color(0xFF315F4B),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                    leading: Icon(page.icon,
                        color:
                            page == selected ? _mint : const Color(0xFFCAD5CD)),
                    title: Text(page.label,
                        style: TextStyle(
                            color: page == selected
                                ? Colors.white
                                : const Color(0xFFCAD5CD),
                            fontWeight: page == selected
                                ? FontWeight.w700
                                : FontWeight.w500)),
                    onTap: () => onSelected(page),
                  ),
                )),
            const Spacer(),
            const ListTile(
              leading: CircleAvatar(
                  radius: 16, backgroundColor: _brass, child: Text('MO')),
              title: Text('Morgan Ortiz',
                  style: TextStyle(
                      color: Colors.white, fontWeight: FontWeight.w700)),
              subtitle: Text('Operations',
                  style: TextStyle(color: Color(0xFFCAD5CD))),
            ),
          ],
        ),
      );
}

class _ContextHeader extends ConsumerWidget {
  const _ContextHeader({required this.role, required this.compact});
  final Role role;
  final bool compact;

  @override
  Widget build(BuildContext context, WidgetRef ref) => Padding(
        padding:
            EdgeInsets.fromLTRB(compact ? 16 : 24, 16, compact ? 16 : 24, 0),
        child: Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          runSpacing: 12,
          children: [
            const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('HARBOR CITY ARENA',
                      style: TextStyle(
                          fontSize: 12,
                          letterSpacing: 1.4,
                          fontWeight: FontWeight.w800,
                          color: _pine)),
                  SizedBox(height: 3),
                  Text('Storm vs. Comets',
                      style:
                          TextStyle(fontSize: 23, fontWeight: FontWeight.w800)),
                  Text('Doors in 42 min · Friday, Sep 25',
                      style: TextStyle(color: Color(0xFF59645D))),
                ]),
            Wrap(
                spacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  _SyncChip(),
                  IconButton(
                    tooltip: 'Sign out',
                    onPressed: () =>
                        ref.read(authSessionProvider.notifier).signOut(),
                    icon: const Icon(Icons.logout_outlined),
                  ),
                  PopupMenuButton<Role>(
                    tooltip: 'Change prototype role',
                    onSelected: (value) =>
                        ref.read(_roleProvider.notifier).state = value,
                    itemBuilder: (context) => Role.values
                        .map((item) => PopupMenuItem(
                            value: item,
                            child: Row(children: [
                              Icon(item.icon),
                              const SizedBox(width: 10),
                              Text(item.label)
                            ])))
                        .toList(),
                    child: Chip(
                      avatar: Icon(role.icon, size: 18),
                      label: Text(role.label),
                      backgroundColor: const Color(0xFFE4EEE6),
                    ),
                  ),
                ]),
          ],
        ),
      );
}

class _SyncChip extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reports = ref.watch(issueSyncProvider);
    final failed = reports.any((report) => report.state == SyncState.failed);
    final label = reports.isEmpty
        ? 'Current'
        : failed
            ? 'Sync blocked · ${reports.length}'
            : 'Pending sync · ${reports.length}';
    final color = failed ? _coral : _pine;
    return Semantics(
      container: true,
      liveRegion: true,
      label: 'Sync status: $label',
      child: ExcludeSemantics(
        child: Chip(
          avatar: Icon(
            failed
                ? Icons.cloud_off_outlined
                : reports.isEmpty
                    ? Icons.cloud_done_outlined
                    : Icons.cloud_upload_outlined,
            color: color,
            size: 18,
          ),
          label: Text(label),
          backgroundColor:
              failed ? const Color(0xFFF6E1DD) : const Color(0xFFE4EEE6),
        ),
      ),
    );
  }
}

class _PageView extends StatelessWidget {
  const _PageView(
      {required this.page, required this.tablet, required this.desktop});
  final AppPage page;
  final bool tablet;
  final bool desktop;

  @override
  Widget build(BuildContext context) => switch (page) {
        AppPage.today => _TodayPage(tablet: tablet, desktop: desktop),
        AppPage.command => _CommandPage(tablet: tablet, desktop: desktop),
        AppPage.plan => _PlanPage(desktop: desktop),
        AppPage.staffing => _StaffingPage(tablet: tablet, desktop: desktop),
        AppPage.service => _ServicePage(tablet: tablet, desktop: desktop),
        AppPage.stock => _StockPage(tablet: tablet, desktop: desktop),
        AppPage.insights => _InsightsPage(tablet: tablet, desktop: desktop),
      };
}

class _TodayPage extends ConsumerWidget {
  const _TodayPage({required this.tablet, required this.desktop});
  final bool tablet;
  final bool desktop;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final role = ref.watch(_roleProvider);
    final acknowledged = ref.watch(_shiftAcknowledgedProvider);
    final pendingIssues = ref.watch(issueSyncProvider);
    final title = role == Role.frontline
        ? 'Your event-day work'
        : 'What needs your attention';
    return ListView(children: [
      _PageTitle(
          title: title,
          subtitle: role == Role.frontline
              ? 'Suite 14 service · 5:45–10:30 PM'
              : 'Live priorities across your current scope'),
      const SizedBox(height: 18),
      _HeroAction(
        eyebrow: acknowledged ? 'NEXT ACTION' : 'SHIFT ACTION REQUIRED',
        title: acknowledged
            ? 'Check in opens in 5 minutes'
            : 'Acknowledge Suite 14 service shift',
        description: acknowledged
            ? 'East service corridor · report to Eli'
            : 'Location changed 18 minutes ago. Review the current instruction.',
        actionLabel: acknowledged ? 'View check-in' : 'Review shift',
        icon: acknowledged
            ? Icons.login_outlined
            : Icons.assignment_turned_in_outlined,
        onPressed: () =>
            acknowledged ? _showCheckIn(context) : _showShift(context, ref),
      ),
      const SizedBox(height: 24),
      Text('Priority queue',
          style: Theme.of(context)
              .textTheme
              .titleLarge
              ?.copyWith(fontWeight: FontWeight.w800)),
      const SizedBox(height: 10),
      if (tablet)
        Wrap(spacing: 14, runSpacing: 14, children: _todayCards(context))
      else
        ..._todayCards(context).map((card) =>
            Padding(padding: const EdgeInsets.only(bottom: 12), child: card)),
      if (pendingIssues.isNotEmpty) ...[
        const SizedBox(height: 18),
        Text('Your issue reports',
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 10),
        ...pendingIssues.map((issue) => _WorkCard(
              state: issue.state == SyncState.failed
                  ? 'SYNC FAILED'
                  : 'PENDING SYNC',
              stateColor: issue.state == SyncState.failed ? _coral : _blue,
              title: issue.title,
              meta: 'Reported ${issue.createdAt.toLocal()} · ${issue.category}',
              detail: issue.description,
              action: issue.state == SyncState.failed
                  ? 'Retry sync'
                  : 'Saved on this device',
              liveStatus: true,
              onPressed: issue.state == SyncState.failed
                  ? () => ref.read(issueSyncProvider.notifier).synchronize()
                  : null,
            )),
      ],
    ]);
  }
}

List<Widget> _todayCards(BuildContext context) => [
      const SizedBox(
          width: 350,
          child: _WorkCard(
              state: 'BLOCKED',
              stateColor: _coral,
              title: 'Suite 14 refrigeration',
              meta: 'No owner · due in 12 min',
              detail: 'Vendor repair ETA needed',
              action: 'Assign owner')),
      const SizedBox(
          width: 350,
          child: _WorkCard(
              state: 'ATTENTION',
              stateColor: _brass,
              title: '2 shifts need acknowledgement',
              meta: 'West Gate · staffing',
              detail: 'One lead position remains open',
              action: 'Review coverage')),
      const SizedBox(
          width: 350,
          child: _WorkCard(
              state: 'READY',
              stateColor: _pine,
              title: 'Concourse readiness checks',
              meta: '7 of 9 complete',
              detail: 'Last check due at 6:20 PM',
              action: 'Open command')),
    ];

class _CommandPage extends StatelessWidget {
  const _CommandPage({required this.tablet, required this.desktop});
  final bool tablet;
  final bool desktop;

  @override
  Widget build(BuildContext context) {
    final queue = const _CommandQueue();
    final detail = const _IssueDetail();
    if (!tablet) {
      return ListView(children: [
        _PageTitle(
            title: 'Event Command', subtitle: 'Doors in 42 min · 2 blockers'),
        const SizedBox(height: 16),
        queue,
        const SizedBox(height: 16),
        detail
      ]);
    }
    return Column(children: [
      _PageTitle(
          title: 'Event Command',
          subtitle: 'Doors in 42 min · Readiness at risk',
          trailing: const _StatusPill(label: '2 blockers', color: _coral)),
      const SizedBox(height: 16),
      Expanded(
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Expanded(flex: 5, child: queue),
        const SizedBox(width: 16),
        Expanded(flex: 4, child: detail)
      ])),
    ]);
  }
}

class _CommandQueue extends StatelessWidget {
  const _CommandQueue();
  @override
  Widget build(BuildContext context) => _Panel(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text('Operational queue',
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.w800)),
            const Spacer(),
            const Icon(Icons.tune_outlined)
          ]),
          const SizedBox(height: 16),
          const _SectionLabel('BLOCKED'),
          const _CompactWork(
              title: 'Suite 14 refrigeration',
              meta: 'Unassigned · due 6:15 PM',
              color: _coral),
          const SizedBox(height: 14),
          const _SectionLabel('ATTENTION'),
          const _CompactWork(
              title: 'West Gate lead coverage',
              meta: 'Open slot · due 5:30 PM',
              color: _brass),
          const _CompactWork(
              title: 'Two shifts unacknowledged',
              meta: 'Staffing · response due now',
              color: _brass),
          const SizedBox(height: 14),
          const _SectionLabel('READY'),
          const _CompactWork(
              title: 'Concourse POS verification',
              meta: 'Complete · owned by Priya',
              color: _pine),
        ]),
      );
}

class _IssueDetail extends StatelessWidget {
  const _IssueDetail();
  @override
  Widget build(BuildContext context) => _Panel(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const _StatusPill(label: 'SERVICE IMPACT', color: _coral),
          const SizedBox(height: 14),
          Text('Suite 14 refrigeration',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 5),
          const Text('Pantry · reported 6:02 PM by Maya'),
          const Divider(height: 30),
          const Text('Owner', style: TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          Row(children: [
            const CircleAvatar(child: Icon(Icons.person_outline)),
            const SizedBox(width: 10),
            const Expanded(
                child: Text('Unassigned\nNo accountable response yet')),
            OutlinedButton(onPressed: () {}, child: const Text('Assign'))
          ]),
          const SizedBox(height: 18),
          const Text('Activity', style: TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          const Text('6:05 PM · Priya requested vendor repair ETA'),
          const SizedBox(height: 8),
          const Text('6:02 PM · Maya reported temperature warning'),
          const SizedBox(height: 18),
          Row(children: [
            Expanded(
                child: OutlinedButton(
                    onPressed: () {}, child: const Text('Escalate'))),
            const SizedBox(width: 10),
            Expanded(
                child: FilledButton(
                    onPressed: () {}, child: const Text('Add update')))
          ]),
        ]),
      );
}

class _PlanPage extends ConsumerWidget {
  const _PlanPage({required this.desktop});
  final bool desktop;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ready = ref.watch(_readyProvider);
    return ListView(children: [
      _PageTitle(
          title: 'Event plan',
          subtitle: ready
              ? 'Plan ready for event day'
              : '2 required checks need attention',
          trailing: _StatusPill(
              label: ready ? 'READY' : 'AT RISK',
              color: ready ? _pine : _coral)),
      const SizedBox(height: 16),
      if (desktop)
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: _MilestonePanel()),
          const SizedBox(width: 16),
          Expanded(
              flex: 2,
              child: _ReadinessPanel(
                  onReady: () =>
                      ref.read(_readyProvider.notifier).state = true))
        ])
      else ...[
        _MilestonePanel(),
        const SizedBox(height: 16),
        _ReadinessPanel(
            onReady: () => ref.read(_readyProvider.notifier).state = true)
      ],
    ]);
  }
}

class _MilestonePanel extends StatelessWidget {
  @override
  Widget build(BuildContext context) => _Panel(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Run of show',
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 16),
        ...const [
          _Milestone(time: '2:00 PM', label: 'Plan lock', state: 'complete'),
          _Milestone(time: '5:30 PM', label: 'Staff arrival', state: 'current'),
          _Milestone(time: '6:30 PM', label: 'Doors', state: 'next'),
          _Milestone(time: '7:30 PM', label: 'Event start', state: 'next'),
          _Milestone(time: '10:00 PM', label: 'Closeout', state: 'next'),
        ]
      ]));
}

class _ReadinessPanel extends StatelessWidget {
  const _ReadinessPanel({required this.onReady});
  final VoidCallback onReady;
  @override
  Widget build(BuildContext context) => _Panel(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text('Readiness work',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w800)),
          const Spacer(),
          TextButton(onPressed: onReady, child: const Text('Mark ready'))
        ]),
        const SizedBox(height: 12),
        const _CompactWork(
            title: 'Suite 14 refrigeration',
            meta: 'Blocked · no owner',
            color: _coral),
        const _CompactWork(
            title: 'West Gate equipment check',
            meta: 'Due in 12 min · Eli',
            color: _brass),
        const _CompactWork(
            title: 'Concourse POS verification',
            meta: 'Complete · Priya',
            color: _pine),
      ]));
}

class _StaffingPage extends StatelessWidget {
  const _StaffingPage({required this.tablet, required this.desktop});
  final bool tablet;
  final bool desktop;
  @override
  Widget build(BuildContext context) => ListView(children: [
        _PageTitle(
            title: 'Staffing coverage',
            subtitle: '94% filled · 3 exceptions',
            trailing: FilledButton.icon(
                onPressed: () => _published(context),
                icon: const Icon(Icons.send_outlined),
                label: const Text('Publish 12 changes'))),
        const SizedBox(height: 16),
        if (tablet)
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(flex: 3, child: _ScheduleGrid()),
            const SizedBox(width: 16),
            Expanded(flex: 2, child: _CoveragePanel())
          ])
        else ...[_CoveragePanel(), const SizedBox(height: 16), _ScheduleGrid()],
      ]);
}

class _ScheduleGrid extends StatelessWidget {
  @override
  Widget build(BuildContext context) => _Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Event shift plan',
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 14),
            Table(
              columnWidths: const {
                0: FixedColumnWidth(78),
                1: FlexColumnWidth(),
                2: FlexColumnWidth()
              },
              children: const [
                TableRow(children: [
                  _TableLabel('TIME'),
                  _TableLabel('SUITE 14'),
                  _TableLabel('WEST GATE')
                ]),
                TableRow(children: [
                  _TableCell('5:30'),
                  _TableCell('Maya ✓'),
                  _TableCell('Open ×')
                ]),
                TableRow(children: [
                  _TableCell('6:00'),
                  _TableCell('Priya ✓'),
                  _TableCell('Vendor slot')
                ]),
                TableRow(children: [
                  _TableCell('6:30'),
                  _TableCell('Jordan ✓'),
                  _TableCell('Eli ✓')
                ]),
              ],
            ),
          ],
        ),
      );
}

class _CoveragePanel extends StatelessWidget {
  @override
  Widget build(BuildContext context) => _Panel(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const _StatusPill(label: 'UNFILLED', color: _coral),
        const SizedBox(height: 12),
        Text('West Gate lead',
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        const Text('5:30–10:00 PM · Required for doors'),
        const SizedBox(height: 18),
        FilledButton(
            onPressed: () {}, child: const Text('Find eligible people')),
        const SizedBox(height: 8),
        OutlinedButton(
            onPressed: () {}, child: const Text('Request vendor staffing')),
        const Divider(height: 32),
        const Text('2 workers need acknowledgement',
            style: TextStyle(fontWeight: FontWeight.w800)),
        TextButton(onPressed: () {}, child: const Text('Send reminder')),
      ]));
}

class _ServicePage extends ConsumerWidget {
  const _ServicePage({required this.tablet, required this.desktop});
  final bool tablet;
  final bool desktop;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final packed = ref.watch(_packedProvider);
    final queue = _Panel(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('Suite service queue',
          style: Theme.of(context)
              .textTheme
              .titleLarge
              ?.copyWith(fontWeight: FontWeight.w800)),
      const SizedBox(height: 14),
      const _CompactWork(
          title: 'HC-1842 · Suite 14',
          meta: 'Ready · runner needed · due 6:45 PM',
          color: _pine),
      const _CompactWork(
          title: 'HC-1847 · Sponsor Lounge',
          meta: 'Preparing · due in 22 min',
          color: _brass),
      const _CompactWork(
          title: 'HC-1839 · East Club',
          meta: 'Shorted: ice · attention needed',
          color: _coral)
    ]));
    final detail = _Panel(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const _StatusPill(label: 'READY FOR PACK', color: _brass),
      const SizedBox(height: 12),
      Text('Order HC-1842',
          style: Theme.of(context)
              .textTheme
              .headlineSmall
              ?.copyWith(fontWeight: FontWeight.w800)),
      const Text('Suite 14 · 12 guests · due 6:45 PM'),
      const Divider(height: 28),
      const Text('12 beverage packs',
          style: TextStyle(fontWeight: FontWeight.w700)),
      const Text('1 gluten-free tray · dietary note verified'),
      const Spacer(),
      FilledButton(
          onPressed: () => ref.read(_packedProvider.notifier).state = true,
          child: Text(packed ? 'Packed · ready for pickup' : 'Confirm pack'))
    ]));
    return tablet
        ? Column(children: [
            _PageTitle(
                title: 'Service fulfillment', subtitle: 'One order at risk'),
            const SizedBox(height: 16),
            Expanded(
                child: Row(children: [
              Expanded(child: queue),
              const SizedBox(width: 16),
              Expanded(child: detail)
            ]))
          ])
        : ListView(children: [
            _PageTitle(
                title: 'Service fulfillment', subtitle: 'One order at risk'),
            const SizedBox(height: 16),
            queue,
            const SizedBox(height: 16),
            SizedBox(height: 330, child: detail)
          ]);
  }
}

class _StockPage extends ConsumerWidget {
  const _StockPage({required this.tablet, required this.desktop});
  final bool tablet;
  final bool desktop;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final saved = ref.watch(_countSavedProvider);
    return ListView(children: [
      _PageTitle(
          title: 'Stock',
          subtitle: saved
              ? 'Count saved · reconciliation ready'
              : 'East Bar count · 7 of 18 items'),
      const SizedBox(height: 16),
      _Panel(
          child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 650),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const _StatusPill(label: 'COUNT IN PROGRESS', color: _blue),
                    const SizedBox(height: 16),
                    Text('Sparkling water · 24-pack',
                        style: Theme.of(context)
                            .textTheme
                            .headlineSmall
                            ?.copyWith(fontWeight: FontWeight.w800)),
                    const SizedBox(height: 8),
                    const Text('Expected quantity: 18 · East Bar storage'),
                    const SizedBox(height: 28),
                    Row(children: [
                      OutlinedButton(
                          onPressed: () {}, child: const Icon(Icons.remove)),
                      const SizedBox(width: 14),
                      const Text('12',
                          style: TextStyle(
                              fontSize: 44, fontWeight: FontWeight.w800)),
                      const SizedBox(width: 14),
                      OutlinedButton(
                          onPressed: () {}, child: const Icon(Icons.add))
                    ]),
                    const SizedBox(height: 20),
                    const Text(
                        'This count is an observation. A -6 variance will require reconciliation.'),
                    const SizedBox(height: 18),
                    FilledButton(
                        onPressed: () =>
                            ref.read(_countSavedProvider.notifier).state = true,
                        child: Text(
                            saved ? 'Saved · view variance' : 'Save count')),
                  ]))),
    ]);
  }
}

class _InsightsPage extends StatelessWidget {
  const _InsightsPage({required this.tablet, required this.desktop});
  final bool tablet;
  final bool desktop;
  @override
  Widget build(BuildContext context) => ListView(children: [
        _PageTitle(
            title: 'Operational insights',
            subtitle: 'Focus follow-up where event delivery is at risk'),
        const SizedBox(height: 16),
        Wrap(spacing: 14, runSpacing: 14, children: const [
          _Metric(
              label: 'Events ready at doors',
              value: '86%',
              detail: '+8 pts this month',
              color: _pine),
          _Metric(
              label: 'Average issue response',
              value: '9 min',
              detail: 'Target: under 12 min',
              color: _blue),
          _Metric(
              label: 'Open closeout follow-ups',
              value: '7',
              detail: '3 due tomorrow',
              color: _brass),
        ]),
        const SizedBox(height: 16),
        _Panel(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Needs leadership attention',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          const _CompactWork(
              title: 'Harbor City Arena · Storm vs. Comets',
              meta: '2 blockers before doors · owner: Morgan',
              color: _coral),
          const _CompactWork(
              title: 'Riverfront Theater · Gala',
              meta: 'Closeout follow-up overdue · owner: Dana',
              color: _brass)
        ])),
      ]);
}

class _PageTitle extends StatelessWidget {
  const _PageTitle(
      {required this.title, required this.subtitle, this.trailing});
  final String title;
  final String subtitle;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) =>
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title,
              style: Theme.of(context)
                  .textTheme
                  .headlineMedium
                  ?.copyWith(fontWeight: FontWeight.w900)),
          const SizedBox(height: 4),
          Text(subtitle, style: const TextStyle(color: Color(0xFF59645D)))
        ])),
        if (trailing != null) trailing!
      ]);
}

class _HeroAction extends StatelessWidget {
  const _HeroAction(
      {required this.eyebrow,
      required this.title,
      required this.description,
      required this.actionLabel,
      required this.icon,
      required this.onPressed});
  final String eyebrow, title, description, actionLabel;
  final IconData icon;
  final VoidCallback onPressed;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(22),
        decoration:
            BoxDecoration(color: _ink, borderRadius: BorderRadius.circular(24)),
        child: Row(children: [
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(eyebrow,
                    style: const TextStyle(
                        color: _mint,
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.1)),
                const SizedBox(height: 8),
                Text(title,
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        color: Colors.white, fontWeight: FontWeight.w900)),
                const SizedBox(height: 7),
                Text(description,
                    style: const TextStyle(color: Color(0xFFD5DED7))),
                const SizedBox(height: 18),
                FilledButton.icon(
                    onPressed: onPressed,
                    icon: Icon(icon),
                    label: Text(actionLabel),
                    style: FilledButton.styleFrom(
                        backgroundColor: _mint, foregroundColor: _ink))
              ])),
          const SizedBox(width: 14),
          Icon(icon, color: _mint, size: 42)
        ]),
      );
}

class _WorkCard extends StatelessWidget {
  const _WorkCard(
      {required this.state,
      required this.stateColor,
      required this.title,
      required this.meta,
      required this.detail,
      required this.action,
      this.liveStatus = false,
      this.onPressed});
  final String state, title, meta, detail, action;
  final Color stateColor;
  final bool liveStatus;
  final VoidCallback? onPressed;
  @override
  Widget build(BuildContext context) => _Panel(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        _StatusPill(label: state, color: stateColor, liveRegion: liveStatus),
        const SizedBox(height: 12),
        Text(title,
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 5),
        Text(meta),
        const SizedBox(height: 10),
        Text(detail, style: const TextStyle(color: Color(0xFF59645D))),
        const SizedBox(height: 16),
        OutlinedButton(onPressed: onPressed, child: Text(action))
      ]));
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => Card(
      margin: EdgeInsets.zero,
      child: Padding(padding: const EdgeInsets.all(20), child: child));
}

class _StatusPill extends StatelessWidget {
  const _StatusPill(
      {required this.label, required this.color, this.liveRegion = false});
  final String label;
  final Color color;
  final bool liveRegion;
  @override
  Widget build(BuildContext context) => Semantics(
        container: true,
        liveRegion: liveRegion,
        label: label,
        child: ExcludeSemantics(
          child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
              decoration: BoxDecoration(
                  color: color.withValues(alpha: .13),
                  borderRadius: BorderRadius.circular(30)),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(Icons.circle, size: 8, color: color),
                const SizedBox(width: 6),
                Text(label,
                    style: TextStyle(
                        color: color,
                        fontSize: 11,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .6))
              ])),
        ),
      );
}

class _CompactWork extends StatelessWidget {
  const _CompactWork(
      {required this.title, required this.meta, required this.color});
  final String title, meta;
  final Color color;
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
              color: const Color(0xFFF8F7F2),
              borderRadius: BorderRadius.circular(14)),
          child: Row(children: [
            Container(
                width: 4,
                height: 40,
                decoration: BoxDecoration(
                    color: color, borderRadius: BorderRadius.circular(4))),
            const SizedBox(width: 10),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text(title,
                      style: const TextStyle(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 3),
                  Text(meta,
                      style: const TextStyle(
                          fontSize: 12, color: Color(0xFF59645D)))
                ])),
            const Icon(Icons.chevron_right)
          ])));
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.value);
  final String value;
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(value,
          style: const TextStyle(
              fontSize: 11,
              letterSpacing: 1,
              fontWeight: FontWeight.w900,
              color: Color(0xFF59645D))));
}

class _Milestone extends StatelessWidget {
  const _Milestone(
      {required this.time, required this.label, required this.state});
  final String time, label, state;
  @override
  Widget build(BuildContext context) {
    final color = state == 'complete'
        ? _pine
        : state == 'current'
            ? _brass
            : const Color(0xFF9AA39C);
    return Padding(
        padding: const EdgeInsets.only(bottom: 18),
        child: Row(children: [
          Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(shape: BoxShape.circle, color: color)),
          const SizedBox(width: 12),
          SizedBox(
              width: 68,
              child: Text(time,
                  style: const TextStyle(fontWeight: FontWeight.w700))),
          Text(label)
        ]));
  }
}

class _TableLabel extends StatelessWidget {
  const _TableLabel(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.all(8),
      child: Text(text,
          style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w900,
              color: Color(0xFF59645D))));
}

class _TableCell extends StatelessWidget {
  const _TableCell(this.text);
  final String text;
  @override
  Widget build(BuildContext context) =>
      Padding(padding: const EdgeInsets.all(8), child: Text(text));
}

class _Metric extends StatelessWidget {
  const _Metric(
      {required this.label,
      required this.value,
      required this.detail,
      required this.color});
  final String label, value, detail;
  final Color color;
  @override
  Widget build(BuildContext context) => SizedBox(
      width: 250,
      child: _Panel(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(color: Color(0xFF59645D))),
        const SizedBox(height: 8),
        Text(value,
            style: TextStyle(
                fontSize: 36, fontWeight: FontWeight.w900, color: color)),
        Text(detail)
      ])));
}

void _showShift(BuildContext context, WidgetRef ref) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => Padding(
        padding: const EdgeInsets.fromLTRB(24, 24, 24, 36),
        child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Suite 14 service',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900)),
              const SizedBox(height: 8),
              const Text(
                  '5:45–10:30 PM · East service corridor\nReport to Eli · location changed 18 min ago'),
              const SizedBox(height: 18),
              const Text(
                  'Before you arrive\n• Black uniform and service kit\n• Review suite dietary notes'),
              const SizedBox(height: 24),
              FilledButton(
                  onPressed: () {
                    ref.read(_shiftAcknowledgedProvider.notifier).state = true;
                    Navigator.pop(context);
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                        content: Text(
                            'Shift acknowledged · you are ready for check-in')));
                  },
                  child: const Text('Acknowledge this shift')),
              const SizedBox(height: 8),
              OutlinedButton(
                  onPressed: () {}, child: const Text('I have a conflict')),
            ]),
      ),
    );

void _showCheckIn(BuildContext context) => showModalBottomSheet<void>(
      context: context,
      builder: (context) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Check in',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900)),
              const SizedBox(height: 8),
              const Text('Available at 5:35 PM · East service corridor'),
              const SizedBox(height: 22),
              FilledButton(
                  onPressed: () {
                    Navigator.pop(context);
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                        content: Text('Check-in recorded at 5:42 PM')));
                  },
                  child: const Text('Check in now')),
            ]),
      ),
    );
void _reportIssue(BuildContext context, WidgetRef ref) =>
    showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (context) => _ReportIssueSheet(ref: ref));

void _published(BuildContext context) => showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
            title: const Text('Publish schedule changes?'),
            content: const Text(
                '12 people will receive a shift or material-change notice. Two open slots remain visible to supervisors.'),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Review again')),
              FilledButton(
                  onPressed: () {
                    Navigator.pop(context);
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                        content: Text('12 schedule changes published')));
                  },
                  child: const Text('Publish 12 changes'))
            ]));

class _ReportIssueSheet extends StatefulWidget {
  const _ReportIssueSheet({required this.ref});
  final WidgetRef ref;
  @override
  State<_ReportIssueSheet> createState() => _ReportIssueSheetState();
}

class _ReportIssueSheetState extends State<_ReportIssueSheet> {
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _locationFocus = FocusNode(debugLabel: 'issue-location');
  String _selectedLocationId = '30000000-0000-4000-8000-000000000001';

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    _locationFocus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(
            24, 24, 24, MediaQuery.viewInsetsOf(context).bottom + 24),
        child: SingleChildScrollView(
            child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
              Text('Report an issue',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900)),
              const SizedBox(height: 16),
              TextField(
                  controller: _title,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(
                      labelText: 'What is happening?',
                      hintText: 'Refrigeration warning')),
              const SizedBox(height: 12),
              Focus(
                focusNode: _locationFocus,
                child: DropdownButtonFormField<String>(
                  initialValue: _selectedLocationId,
                  decoration: const InputDecoration(labelText: 'Location'),
                  items: const [
                    DropdownMenuItem(
                        value: '30000000-0000-4000-8000-000000000001',
                        child: Text('Suite 14 pantry')),
                    DropdownMenuItem(
                        value: '30000000-0000-4000-8000-000000000002',
                        child: Text('East bar')),
                    DropdownMenuItem(
                        value: '30000000-0000-4000-8000-000000000003',
                        child: Text('West Gate')),
                  ],
                  onChanged: (value) {
                    if (value != null) {
                      setState(() => _selectedLocationId = value);
                    }
                  },
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                  controller: _description,
                  maxLines: 3,
                  decoration: const InputDecoration(
                      labelText: 'Details',
                      hintText:
                          'Temperature warning appeared on the display.')),
              const SizedBox(height: 14),
              Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  alignment: WrapAlignment.spaceBetween,
                  children: [
                    OutlinedButton.icon(
                        onPressed: () {},
                        icon: const Icon(Icons.camera_alt_outlined),
                        label: const Text('Add photo')),
                    FilledButton(
                        onPressed: _submit, child: const Text('Submit issue'))
                  ]),
            ])),
      );

  Future<void> _submit() async {
    if (_title.text.trim().length < 3 || _description.text.trim().isEmpty) {
      return;
    }
    final item = PendingIssueReport(
      idempotencyKey: const Uuid().v4(),
      eventId: '20000000-0000-4000-8000-000000000001',
      venueId: '10000000-0000-4000-8000-000000000001',
      locationId: _selectedLocationId,
      title: _title.text.trim(),
      description: _description.text.trim(),
      category: 'Service',
      severity: 'MODERATE',
      createdAt: DateTime.now(),
    );
    await widget.ref.read(issueSyncProvider.notifier).submit(item);
    if (!mounted) return;
    Navigator.pop(context);
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text(
            'Issue report saved securely · syncs when signed in and online')));
  }
}
