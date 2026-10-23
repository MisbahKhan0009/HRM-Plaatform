import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLES, PERMISSIONS, ROLE_CODES, STRONG_AUTH_ROLES } from './permissions';

// Parses the permission matrix in SECURITY-MODEL.md §4 so code and doc cannot drift apart.
const doc = readFileSync(new URL('../../../docs/03-architecture/SECURITY-MODEL.md', import.meta.url), 'utf8');
const section = doc.slice(doc.indexOf('## 4. Permission catalogue'), doc.indexOf('## 5.'));
const rows = section.split('\n').filter((l) => l.startsWith('| `'));
const matrix = new Map<string, Set<string>>();
for (const row of rows) {
  const cells = row
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());
  const codes = [...(cells[0] ?? '').matchAll(/`([a-z_.]+)`/g)].map((m) => m[1] as string);
  const granted = ROLE_CODES.filter((_, i) => cells[i + 1] === '✓');
  for (const code of codes) matrix.set(code, new Set(granted));
}

describe('permission catalogue', () => {
  it('lists exactly the permissions in SECURITY-MODEL §4', () => {
    expect([...PERMISSIONS].sort()).toEqual([...matrix.keys()].sort());
  });

  it('has no duplicate codes', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it.each(DEFAULT_ROLES.map((r) => [r.code, r] as const))(
    'grants %s exactly the documented permissions',
    (code, role) => {
      const documented = [...matrix].filter(([, roles]) => roles.has(code)).map(([p]) => p);
      expect([...role.permissions].sort()).toEqual(documented.sort());
    },
  );

  it('requires strong auth for the five privileged roles only', () => {
    expect([...STRONG_AUTH_ROLES].sort()).toEqual([
      'auditor',
      'director',
      'hr_admin',
      'payroll_officer',
      'system_admin',
    ]);
  });
});
