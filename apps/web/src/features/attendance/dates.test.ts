import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysInMonth,
  dhakaInstant,
  dhakaTime,
  monthRange,
  proposedInstants,
  shiftMonth,
  weekRange,
} from './dates';

describe('attendance dates', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('gives the Sunday-to-Saturday week around a date', () => {
    // 22 Oct 2026 is a Thursday.
    expect(weekRange('2026-10-22')).toEqual({ from: '2026-10-18', to: '2026-10-24' });
    expect(weekRange('2026-10-18')).toEqual({ from: '2026-10-18', to: '2026-10-24' });
  });

  it('shifts months and counts their days', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(daysInMonth('2028-02')).toBe(29);
  });

  it('stops the current month at today', () => {
    expect(monthRange('2026-10', '2026-10-22')).toEqual({ from: '2026-10-01', to: '2026-10-22' });
    expect(monthRange('2026-09', '2026-10-22')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('converts Asia/Dhaka wall-clock times', () => {
    expect(dhakaInstant('2026-10-21', '09:30')).toBe('2026-10-21T03:30:00.000Z');
    expect(dhakaTime('2026-10-21T12:05:00Z')).toBe('18:05');
    expect(dhakaTime('2026-10-21T18:30:00Z')).toBe('00:30');
  });

  it('puts a check-out before the check-in on the next morning', () => {
    expect(proposedInstants('2026-10-21', '22:00', '02:00')).toEqual({
      proposedCheckInAt: '2026-10-21T16:00:00.000Z',
      proposedCheckOutAt: '2026-10-21T20:00:00.000Z',
    });
    expect(proposedInstants('2026-10-21', '', '18:05')).toEqual({
      proposedCheckInAt: null,
      proposedCheckOutAt: '2026-10-21T12:05:00.000Z',
    });
  });
});
