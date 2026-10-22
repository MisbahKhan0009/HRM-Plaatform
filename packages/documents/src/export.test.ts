import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { columnName, type ExportTable, neutraliseFormula, tableToCsv, toXlsx } from './export';

interface Row {
  code: string;
  name: string;
  amount: string;
  days: number;
}

const table: ExportTable<Row> = {
  sheetName: 'Claims: Oct/2026',
  columns: [
    { header: 'Employee code', value: (r) => r.code },
    { header: 'Name', value: (r) => r.name },
    { header: 'Amount (BDT)', type: 'money', value: (r) => r.amount },
    { header: 'Days', type: 'integer', value: (r) => r.days },
  ],
  rows: [
    { code: 'EMP-0001', name: '=HYPERLINK("http://x")', amount: '45000.00', days: 22 },
    { code: 'EMP-0002', name: 'Rahim & <Sons> "Ltd"', amount: '-350.50', days: 0 },
  ],
};

function sheet(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  const xml = files['xl/worksheets/sheet1.xml'];
  if (!xml) throw new Error('sheet missing');
  return { files, xml: strFromU8(xml) };
}

/** The `r` reference and text or value of each cell, in document order. */
function cells(xml: string) {
  return [
    ...xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t><\/is>)<\/c>/g),
  ].map((m) => [m[1], m[2] ?? m[3]]);
}

describe('columnName', () => {
  it('maps indexes to spreadsheet column letters', () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
  });
});

describe('neutraliseFormula', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])('prefixes %j', (v) => {
    expect(neutraliseFormula(v)).toBe(`'${v}`);
  });
  it('leaves ordinary text alone', () => {
    expect(neutraliseFormula('Rahim')).toBe('Rahim');
  });
});

describe('tableToCsv', () => {
  it('writes the header and cells in column order', () => {
    const lines = tableToCsv(table).split('\r\n');
    expect(lines[0]).toBe('Employee code,Name,Amount (BDT),Days');
    expect(lines[1]).toBe(`EMP-0001,"'=HYPERLINK(""http://x"")",45000.00,22`);
  });
  it('neutralises negative money too, since CSV has no types', () => {
    expect(tableToCsv(table).split('\r\n')[2]).toBe(`EMP-0002,"Rahim & <Sons> ""Ltd""",'-350.50,0`);
  });
});

describe('toXlsx', () => {
  it('is a zip with the parts Excel needs', () => {
    const { files } = sheet(toXlsx(table));
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
  });

  it('writes the header and cells in column order', () => {
    const { xml } = sheet(toXlsx(table));
    expect(cells(xml).slice(0, 8)).toEqual([
      ['A1', 'Employee code'],
      ['B1', 'Name'],
      ['C1', 'Amount (BDT)'],
      ['D1', 'Days'],
      ['A2', 'EMP-0001'],
      ['B2', `'=HYPERLINK(&quot;http://x&quot;)`],
      ['C2', '45000.00'],
      ['D2', '22'],
    ]);
  });

  it('neutralises formulas in text cells and escapes XML', () => {
    const { xml } = sheet(toXlsx(table));
    expect(xml).not.toContain('<f>');
    expect(xml).toContain('Rahim &amp; &lt;Sons&gt; &quot;Ltd&quot;');
    expect(xml).toContain(`'=HYPERLINK`);
  });

  it('writes money as a number with the money format, straight from the decimal string', () => {
    const { xml } = sheet(toXlsx(table));
    expect(xml).toContain('<c r="C2" s="2"><v>45000.00</v></c>');
    expect(xml).toContain('<c r="C3" s="2"><v>-350.50</v></c>');
    const styles = strFromU8(unzipSync(toXlsx(table))['xl/styles.xml'] as Uint8Array);
    expect(styles).toContain('numFmtId="4"');
  });

  it('writes a non-numeric value in a money column as neutralised text', () => {
    const { xml } = sheet(toXlsx({ ...table, rows: [{ code: 'X', name: 'Y', amount: '-1+1', days: 1 }] }));
    expect(xml).toContain(`<c r="C2" t="inlineStr"><is><t xml:space="preserve">'-1+1</t></is></c>`);
  });

  it('drops characters XML cannot carry and skips empty cells', () => {
    const { xml } = sheet(
      toXlsx({
        sheetName: 'S',
        columns: [
          { header: 'A', value: () => 'a\u0001b' },
          { header: 'B', value: () => null },
          { header: 'C', value: () => 'c' },
        ],
        rows: [{}],
      }),
    );
    expect(cells(xml).slice(3)).toEqual([
      ['A2', 'ab'],
      ['C2', 'c'],
    ]);
  });

  it('cleans the sheet name and is deterministic', () => {
    const a = toXlsx(table);
    const workbook = strFromU8(unzipSync(a)['xl/workbook.xml'] as Uint8Array);
    expect(workbook).toContain('<sheet name="Claims  Oct 2026"');
    expect(toXlsx(table)).toEqual(a);
  });
});
