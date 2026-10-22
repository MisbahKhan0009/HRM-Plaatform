import { closeDayStep } from '../modules/attendance/attendance.jobs';
import { documentExpiryReminders } from '../modules/documents/documents.jobs';
import { applyAccessRevocation, applyEffectiveEvents } from '../modules/employees/employees.jobs';
import { maintenancePrune } from '../modules/health/maintenance.step';
import { LEAVE_DAILY_STEPS } from '../modules/leave/leave.jobs';
import type { DailyStep } from './dispatcher';

/**
 * Daily dispatcher steps in order (JOBS-AND-OUTBOX §3). Each module exports its steps and they are listed here, so
 * the order is visible in one place.
 */
export const DAILY_STEPS: readonly DailyStep[] = [
  applyEffectiveEvents,
  closeDayStep,
  // accrue, year end, carry-forward expiry, eligibility grants (after attendance is closed)
  ...LEAVE_DAILY_STEPS,
  documentExpiryReminders,
  applyAccessRevocation,
  // Keep last: retention and audit counts run after every other step.
  maintenancePrune,
];
