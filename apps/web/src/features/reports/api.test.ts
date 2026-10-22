import { describe, expect, it } from 'vitest';
import { exportFilters } from './api';
import { exportColumns, type ReportColumn } from './columns';

describe('exportFilters (FR-REP-005)', () => {
  it('drops paging and empty values', () => {
    expect(
      exportFilters({
        page: 2,
        pageSize: 25,
        from: '2026-10-01',
        to: '2026-10-31',
        status: undefined,
        q: '',
      }),
    ).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });
});

describe('exportColumns', () => {
  it('keeps column order and leaves screen-only columns out', () => {
    const columns: ReportColumn<{ a: string }>[] = [
      { key: 'a', header: 'A', value: (r) => r.a },
      { key: 'b', header: 'B', screenOnly: true, value: () => 'x' },
      { key: 'c', header: 'C', type: 'money', value: () => '1.00' },
    ];
    expect(exportColumns(columns).map((c) => [c.header, c.type])).toEqual([
      ['A', undefined],
      ['C', 'money'],
    ]);
  });
});
