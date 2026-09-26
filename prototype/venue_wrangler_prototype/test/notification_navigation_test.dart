import 'package:flutter_test/flutter_test.dart';
import 'package:venue_wrangler_prototype/main.dart';

void main() {
  test('notification references resolve to the correct workflow', () {
    expect(
      notificationTargetTab({'issueId': 'issue-1', 'kind': 'issue.assigned'}),
      'Issues',
    );
    expect(
      notificationTargetTab(
          {'shiftId': 'shift-1', 'kind': 'staffing.shift.published'}),
      'Staffing',
    );
    expect(
      notificationTargetTab(
          {'hospitalityOrderId': 'order-1', 'kind': 'hospitality.order.ready'}),
      'Hospitality',
    );
    expect(
      notificationTargetTab({'kind': 'event_closeout_followup'}),
      'Closeout',
    );
    expect(
      notificationTargetTab({'kind': 'vendor_staffing_response'}),
      'Vendors',
    );
    expect(notificationTargetTab({'kind': 'unknown.event'}), 'Today');
  });

  test('workflow navigation remains constrained by capabilities', () {
    expect(
      liveTabsForCapabilities({'issue:read', 'operations:read'}),
      ['Today', 'Issues', 'Operations', 'Stock', 'Staffing', 'Vendors'],
    );
    expect(
      liveTabsForCapabilities({'hospitality:fulfill', 'event:closeout'}),
      ['Today', 'Hospitality', 'Closeout'],
    );
  });
}
