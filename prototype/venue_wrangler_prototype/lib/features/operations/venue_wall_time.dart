final _venueWallPattern = RegExp(r'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$');

String venueWallTime(DateTime wall) {
  String two(int value) => value.toString().padLeft(2, '0');
  return '${wall.year.toString().padLeft(4, '0')}-${two(wall.month)}-${two(wall.day)}T${two(wall.hour)}:${two(wall.minute)}';
}

// UTC carries calendar fields without applying the device's daylight-saving
// rules. This value is never an event instant until the API resolves its venue.
DateTime venueWallDate(int year, int month, int day, int hour, int minute) =>
    DateTime.utc(year, month, day, hour, minute);

DateTime? venueWallCarrier(String? local) {
  final match = _venueWallPattern.firstMatch(local ?? '');
  if (match == null) return null;
  return venueWallDate(
    int.parse(match.group(1)!),
    int.parse(match.group(2)!),
    int.parse(match.group(3)!),
    int.parse(match.group(4)!),
    int.parse(match.group(5)!),
  );
}

String venueWallLabel(String? local, String? timeZone) {
  final match = _venueWallPattern.firstMatch(local ?? '');
  if (match == null || timeZone == null || timeZone.isEmpty) {
    return 'Venue time unavailable';
  }
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ];
  final month = int.parse(match.group(2)!);
  final day = int.parse(match.group(3)!);
  final hour = int.parse(match.group(4)!);
  final minute = match.group(5)!;
  final hour12 = hour % 12 == 0 ? 12 : hour % 12;
  final suffix = hour < 12 ? 'AM' : 'PM';
  return '${months[month - 1]} $day, ${match.group(1)} · $hour12:$minute $suffix · $timeZone';
}
