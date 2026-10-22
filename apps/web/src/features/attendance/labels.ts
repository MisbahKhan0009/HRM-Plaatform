import type { AttendanceEventType, AttendanceSource, AttendanceToday } from '@hrm/contracts';
import { formatDuration } from '../../lib/format';

export const EVENT_LABEL: Record<AttendanceEventType, string> = {
  check_in: 'Checked in',
  check_out: 'Checked out',
  manual_entry: 'Manual entry',
  correction: 'Correction applied',
};

export const SOURCE_LABEL: Record<AttendanceSource, string> = {
  web: 'Web',
  manual: 'Recorded by HR',
  correction: 'Approved correction',
  system: 'System',
};

const weekdayDateFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** `2026-10-22` → `Thu 22 Oct`. */
export const formatWeekdayDate = (iso: string) =>
  weekdayDateFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)).replace(',', '');

/** A schedule clock time `16:00` → `4:00 pm` (CONTENT-STYLE §8). */
export function formatClock(hhmm: string) {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** `Standard · core 10:00 am to 4:00 pm · minimum 8h 00m`, or null without a schedule. */
export function scheduleLine(schedule: AttendanceToday['schedule']) {
  if (!schedule) return null;
  return `${schedule.name} · core ${formatClock(schedule.coreStart)} to ${formatClock(schedule.coreEnd)} · minimum ${formatDuration(schedule.minDailyMinutes)}`;
}
