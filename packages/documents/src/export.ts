/**
 * Report exports built in the browser (D-037, TABLES-AND-LISTS §6). A separate entry point (`@hrm/documents/export`)
 * so the web app loads it on demand, without the payslip PDF builder.
 */
import { toCsv } from './csv';
import { type ExportTable, tableMatrix } from './xlsx';

export { toCsv } from './csv';
export {
  type CellValue,
  type ColumnType,
  columnName,
  type ExportColumn,
  type ExportTable,
  neutraliseFormula,
  tableMatrix,
  toXlsx,
  XLSX_MIME,
} from './xlsx';

/** CSV from the same column definition as the XLSX export: money stays a plain decimal string. */
export function tableToCsv<Row>(table: ExportTable<Row>): string {
  return toCsv(tableMatrix(table));
}
