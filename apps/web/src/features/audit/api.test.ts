import { AUDIT_ACTIONS } from '@hrm/contracts';
import { describe, expect, it } from 'vitest';
import { ACTION_GROUPS, addDaysIso, metadataText, rangeProblem, spanDays } from './api';

describe('audit helpers', () => {
  it('adds days across month and year ends', () => {
    expect(addDaysIso('2026-10-22', -6)).toBe('2026-10-16');
    expect(addDaysIso('2026-01-03', -6)).toBe('2025-12-28');
    expect(spanDays('2026-10-16', '2026-10-22')).toBe(7);
  });

  it('refuses ranges the API refuses', () => {
    expect(rangeProblem('2026-10-16', '2026-10-22')).toBeNull();
    expect(rangeProblem('2026-10-23', '2026-10-22')).toMatch(/before/);
    expect(rangeProblem('2025-01-01', '2026-01-01')).toBeNull();
    expect(rangeProblem('2025-01-01', '2026-01-02')).toMatch(/366/);
  });

  it('groups every action under its prefix', () => {
    expect(ACTION_GROUPS.flatMap((g) => g.actions)).toHaveLength(AUDIT_ACTIONS.length);
    for (const g of ACTION_GROUPS) for (const a of g.actions) expect(a.startsWith(g.prefix)).toBe(true);
  });

  it('prints metadata values as text', () => {
    expect(metadataText(null)).toBe('—');
    expect(metadataText(3)).toBe('3');
    expect(metadataText({ a: 1 })).toContain('"a": 1');
  });
});
