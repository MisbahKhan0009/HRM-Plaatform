import type { ExportColumn } from '@hrm/documents/export';
import type { ReactNode } from 'react';

/**
 * One column of a report: `value` feeds the export (raw API values: decimal strings for money, `YYYY-MM-DD` for
 * dates); `render` is the on-screen cell (formatted). `numeric` right-aligns in mono (COMPONENT-SPECS §7).
 */
export type ReportColumn<Row> = ExportColumn<Row> & {
  key: string;
  numeric?: boolean;
  render?: (row: Row) => ReactNode;
  /** Shown on screen only; left out of the export. */
  screenOnly?: boolean;
};

export const exportColumns = <Row>(columns: ReportColumn<Row>[]): ExportColumn<Row>[] =>
  columns
    .filter((c) => !c.screenOnly)
    .map(({ header, type, width, value }) => ({
      header,
      value,
      ...(type ? { type } : {}),
      ...(width ? { width } : {}),
    }));

/** Columns shared by rows that describe one employee. */
export const employeeColumns = <
  Row extends { employeeCode: string; employeeName: string; departmentName: string | null },
>(): ReportColumn<Row>[] => [
  { key: 'employeeCode', header: 'Employee code', width: 14, value: (r) => r.employeeCode },
  { key: 'employeeName', header: 'Employee', width: 24, value: (r) => r.employeeName },
  { key: 'departmentName', header: 'Department', width: 18, value: (r) => r.departmentName },
];
