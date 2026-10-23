import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { employees } from './schema';
import { whereEmployeeInScope } from './scope';

const dialect = new PgDialect({ casing: 'snake_case' });

describe('whereEmployeeInScope', () => {
  it('adds no condition for all', () => {
    expect(whereEmployeeInScope(employees.id, { companyId: 'c', employees: 'all' })).toBeUndefined();
  });

  it('binds one parameter per id (no untyped array parameter)', () => {
    const cond = whereEmployeeInScope(employees.id, { companyId: 'c', employees: ['a', 'b'] });
    const q = dialect.sqlToQuery(cond as never);
    expect(q.params).toEqual(['a', 'b']);
    expect(q.sql).toContain(' in ($1, $2)');
  });

  it('matches nothing for an empty scope', () => {
    expect(
      dialect.sqlToQuery(whereEmployeeInScope(employees.id, { companyId: 'c', employees: [] }) as never).sql,
    ).toBe('false');
  });
});
