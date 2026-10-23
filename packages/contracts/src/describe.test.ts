import { describe, expect, it } from 'vitest';
import { describePermission, PERMISSIONS } from './permissions';

describe('describePermission', () => {
  it('reads like a sentence', () => {
    expect(describePermission('employee.read.all')).toBe('Read employees (all employees)');
    expect(describePermission('leave.request.review.team')).toBe('Request review leave (own team)');
    expect(describePermission('payroll.approve')).toBe('Approve payroll');
    expect(describePermission('approval.inbox')).toBe('Inbox approvals');
  });

  it('never returns the bare code', () => {
    for (const p of PERMISSIONS) expect(describePermission(p)).not.toBe(p);
  });
});
