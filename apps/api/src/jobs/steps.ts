import type { DailyStep } from './dispatcher';

/**
 * Daily dispatcher steps in order (JOBS-AND-OUTBOX §3). Each module exports its steps and they are listed here, so
 * the order is visible in one place.
 */
export const DAILY_STEPS: readonly DailyStep[] = [];
