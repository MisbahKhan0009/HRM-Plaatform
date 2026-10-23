import { type EmployeeStatus, employeeStatusValues } from '@hrm/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type EmployeeAction,
  employeeActions,
  eventUpdates,
  importedEmployment,
  isAllowedStatusChange,
  keysOnCycles,
  nextEmployeeStatus,
} from './lifecycle';

// DOMAIN-MODEL §5.2: every (status, action) pair. `null` = INVALID_TRANSITION.
const TABLE: Record<EmployeeStatus, Record<EmployeeAction, EmployeeStatus | null>> = {
  draft: {
    start_preboarding: 'preboarding',
    hire: null,
    confirm: null,
    start_notice: null,
    separate: null,
    rehire: null,
    archive: null,
  },
  preboarding: {
    start_preboarding: null,
    hire: 'active',
    confirm: null,
    start_notice: null,
    separate: null,
    rehire: null,
    archive: null,
  },
  probation: {
    start_preboarding: null,
    hire: null,
    confirm: 'active',
    start_notice: null,
    separate: 'separated',
    rehire: null,
    archive: null,
  },
  active: {
    start_preboarding: null,
    hire: null,
    confirm: null,
    start_notice: 'notice_period',
    separate: 'separated',
    rehire: null,
    archive: null,
  },
  notice_period: {
    start_preboarding: null,
    hire: null,
    confirm: null,
    start_notice: null,
    separate: 'separated',
    rehire: null,
    archive: null,
  },
  separated: {
    start_preboarding: null,
    hire: null,
    confirm: null,
    start_notice: null,
    separate: null,
    rehire: 'active',
    archive: 'archived',
  },
  archived: {
    start_preboarding: null,
    hire: null,
    confirm: null,
    start_notice: null,
    separate: null,
    rehire: null,
    archive: null,
  },
};

describe('nextEmployeeStatus (DOMAIN-MODEL §5.2)', () => {
  const cases = employeeStatusValues.flatMap((status) =>
    employeeActions.map((action) => [status, action, TABLE[status][action]] as const),
  );

  it.each(cases)('%s + %s -> %s', (status, action, expected) => {
    expect(nextEmployeeStatus(status, action)).toBe(expected);
  });

  it('hires into probation when the hire sets a probation period', () => {
    expect(nextEmployeeStatus('preboarding', 'hire', { withProbation: true })).toBe('probation');
  });

  it('never leaves archived', () => {
    fc.assert(
      fc.property(fc.constantFrom(...employeeActions), fc.boolean(), (action, withProbation) => {
        expect(nextEmployeeStatus('archived', action, { withProbation })).toBeNull();
      }),
    );
  });
});

describe('isAllowedStatusChange', () => {
  it('accepts the changes an action makes and rejects skips', () => {
    expect(isAllowedStatusChange('preboarding', 'probation')).toBe(true);
    expect(isAllowedStatusChange('notice_period', 'separated')).toBe(true);
    expect(isAllowedStatusChange('draft', 'active')).toBe(false);
    expect(isAllowedStatusChange('archived', 'active')).toBe(false);
  });
});

describe('eventUpdates', () => {
  it('keeps allow-listed fields only', () => {
    expect(
      eventUpdates({
        status: { from: 'probation', to: 'active' },
        salary: { from: '1', to: '2' },
        managerId: { from: null, to: 'm' },
      }),
    ).toEqual({ status: 'active', managerId: 'm' });
    expect(eventUpdates(null)).toEqual({});
  });
});

describe('keysOnCycles (BUSINESS-RULES §7.1)', () => {
  it('finds a two-person cycle and leaves chains alone', () => {
    const links = new Map([
      ['A', 'B'],
      ['B', 'A'],
      ['C', 'A'],
      ['D', 'E'],
    ]);
    expect([...keysOnCycles(links)].sort()).toEqual(['A', 'B']);
  });

  it('finds a self-link', () => {
    expect([...keysOnCycles(new Map([['X', 'X']]))]).toEqual(['X']);
  });

  it('reports no cycle for any forest built from earlier nodes', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: 40 }), (parents) => {
        // Node i may only point at a node with a smaller index: a forest, never a cycle.
        const links = new Map<string, string>();
        parents.forEach((p, i) => {
          if (i > 0) links.set(String(i), String(p % i));
        });
        expect(keysOnCycles(links).size).toBe(0);
      }),
    );
  });
});

describe('importedEmployment (BUSINESS-RULES §10)', () => {
  const today = '2026-03-01';

  it('hires straight into active without a probation end date', () => {
    const { status, steps } = importedEmployment({
      joiningDate: '2019-07-01',
      probationEndDate: null,
      today,
    });
    expect(status).toBe('active');
    expect(steps.map((s) => `${s.action}:${s.type}@${s.effectiveDate}`)).toEqual([
      'start_preboarding:status_changed@2019-07-01',
      'hire:hired@2019-07-01',
    ]);
    expect(steps[1]?.changes).toEqual({
      status: { from: 'preboarding', to: 'active' },
      joiningDate: { from: null, to: '2019-07-01' },
      probationEndDate: { from: null, to: null },
    });
  });

  it('stays in probation while the probation end date is after today', () => {
    const { status, steps } = importedEmployment({
      joiningDate: '2026-01-05',
      probationEndDate: '2026-07-05',
      today,
    });
    expect(status).toBe('probation');
    expect(steps.map((s) => s.action)).toEqual(['start_preboarding', 'hire']);
  });

  it('confirms on the probation end date once it has passed', () => {
    const { status, steps } = importedEmployment({
      joiningDate: '2025-01-05',
      probationEndDate: '2025-07-05',
      today,
    });
    expect(status).toBe('active');
    expect(steps.map((s) => `${s.type}@${s.effectiveDate}`)).toEqual([
      'status_changed@2025-01-05',
      'hired@2025-01-05',
      'confirmed@2025-07-05',
    ]);
  });

  it('walks only allowed transitions and ends in probation exactly when probation ends after today', () => {
    const day = fc
      .integer({ min: 0, max: 4000 })
      .map((n) => new Date(Date.UTC(2016, 0, 1 + n)).toISOString().slice(0, 10));
    fc.assert(
      fc.property(day, fc.option(fc.integer({ min: 1, max: 400 })), day, (joiningDate, months, todayArb) => {
        const t = joiningDate > todayArb ? joiningDate : todayArb;
        const probationEndDate =
          months === null
            ? null
            : new Date(Date.parse(joiningDate) + months * 86_400_000).toISOString().slice(0, 10);
        const { status, steps } = importedEmployment({ joiningDate, probationEndDate, today: t });
        let current: EmployeeStatus = 'draft';
        for (const s of steps) {
          expect(s.changes.status?.from).toBe(current);
          current = s.changes.status?.to as EmployeeStatus;
          expect(isAllowedStatusChange(s.changes.status?.from as EmployeeStatus, current)).toBe(true);
          expect(s.effectiveDate <= t).toBe(true);
        }
        expect(current).toBe(status);
        expect(status).toBe(probationEndDate !== null && probationEndDate > t ? 'probation' : 'active');
      }),
    );
  });
});
