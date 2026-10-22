import { Button, KeyValueList, LoadingBlock, Sheet, Table, TBody, TD, TH, THead, TR } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useErrorMessage } from '../../lib/api/errors';
import { formatDate, formatDateRange, formatMoney } from '../../lib/format';
import { payrollQueries } from './api';
import { FlagBadges, Money, StatusLabel } from './components';

const LINE_CODE: Record<string, string> = {
  base_salary: 'Base salary',
  reimbursement: 'Reimbursement',
  addition: 'Addition',
  deduction: 'Deduction',
  proration_adjustment: 'Proration',
  arrears: 'Arrears',
};

type SnapshotStructure = { grossAmount?: unknown; effectiveFrom?: unknown; effectiveTo?: unknown };

/** Reads the parts of the immutable snapshot worth showing (BUSINESS-RULES 6.6), defensively. */
function snapshotSummary(snapshot: Record<string, unknown>) {
  const structures = Array.isArray(snapshot.salaryStructures)
    ? (snapshot.salaryStructures as SnapshotStructure[]).filter(
        (s) => typeof s.grossAmount === 'string' && typeof s.effectiveFrom === 'string',
      )
    : [];
  return {
    ruleVersion: typeof snapshot.ruleVersion === 'string' ? snapshot.ruleVersion : null,
    structures: structures as { grossAmount: string; effectiveFrom: string; effectiveTo: string | null }[],
  };
}

/** Primitive calculation inputs of a line (`days`, `gross amount`, …) as short text; ids are left out. */
function basis(calculation: Record<string, unknown>) {
  return Object.entries(calculation)
    .filter(([k, v]) => !/id$/i.test(k) && ['string', 'number'].includes(typeof v))
    .map(([k, v]) => {
      const text = String(v);
      const shown = /^\d{4}-\d{2}-\d{2}$/.test(text)
        ? formatDate(text)
        : /^-?\d+\.\d{2}$/.test(text)
          ? formatMoney(text)
          : text;
      return `${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${shown}`;
    })
    .join(' · ');
}

/** Row drawer of an item: lines and snapshot summary (SCREEN-INVENTORY 9.2). */
export function ItemDrawer({
  runId,
  itemId,
  onClose,
}: {
  runId: string;
  itemId: string;
  onClose: () => void;
}) {
  const item = useQuery(payrollQueries.item(runId, itemId));
  const message = useErrorMessage();
  const d = item.data;
  const snap = d ? snapshotSummary(d.snapshot) : null;
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={d ? `${d.employee.name} payroll item` : 'Payroll item'}
      side="right"
      className="w-[min(560px,100vw)] bg-surface"
    >
      <div className="flex flex-col gap-5 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.13em] text-text-3">Payroll item</p>
            <h2 className="font-display text-xl font-semibold">{d?.employee.name ?? 'Loading…'}</h2>
            {d ? <p className="font-mono text-sm text-text-2">{d.employee.employeeCode}</p> : null}
          </div>
          <Button variant="icon" size="icon-sm" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
        {item.isPending ? (
          <LoadingBlock label="payroll item" />
        ) : item.isError ? (
          <p className="text-bad">We couldn't load this item. {message(item.error)}</p>
        ) : d && snap ? (
          <>
            <KeyValueList
              items={[
                { label: 'Days employed', value: `${d.daysEmployed} of ${d.daysInPeriod}` },
                { label: 'Gross', value: <Money amount={d.grossAmount.amount} /> },
                { label: 'Deductions', value: <Money amount={d.deductionAmount.amount} /> },
                { label: 'Net pay', value: <Money amount={d.netAmount.amount} className="font-semibold" /> },
                { label: 'Payment', value: <StatusLabel status={d.paymentStatus} /> },
                { label: 'Flags', value: <FlagBadges flags={d.validationFlags} /> },
              ]}
            />
            <section aria-labelledby="lines-h" className="flex flex-col gap-2">
              <h3 id="lines-h" className="font-display font-semibold">
                Line items
              </h3>
              <div className="overflow-x-auto rounded-card border border-line">
                <Table>
                  <THead>
                    <tr>
                      <TH>Line</TH>
                      <TH numeric>Amount</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {[...d.lines]
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((l) => {
                        const b = basis(l.calculation);
                        return (
                          <TR key={l.id}>
                            <TD>
                              <p>{l.label}</p>
                              <p className="text-sm text-text-2">
                                {l.kind === 'deduction' ? 'Deduction' : 'Earning'}
                                {LINE_CODE[l.code] && LINE_CODE[l.code] !== l.label
                                  ? ` · ${LINE_CODE[l.code]}`
                                  : ''}
                                {b ? ` · ${b}` : ''}
                              </p>
                            </TD>
                            <TD numeric>
                              <Money
                                amount={l.kind === 'deduction' ? `-${l.amount.amount}` : l.amount.amount}
                              />
                            </TD>
                          </TR>
                        );
                      })}
                  </TBody>
                </Table>
              </div>
            </section>
            <section aria-labelledby="snap-h" className="flex flex-col gap-2">
              <h3 id="snap-h" className="font-display font-semibold">
                Calculation snapshot
              </h3>
              <p className="text-sm text-text-2">
                Frozen when the run was calculated. Later salary changes don't alter it.
              </p>
              <KeyValueList
                items={[
                  {
                    label: 'Rule version',
                    value: <span className="font-mono">{snap.ruleVersion ?? '—'}</span>,
                  },
                  {
                    label: 'Salary used',
                    value: snap.structures.length ? (
                      <ul className="flex flex-col gap-1">
                        {snap.structures.map((s) => (
                          <li key={s.effectiveFrom}>
                            <Money amount={s.grossAmount} /> a month,{' '}
                            {s.effectiveTo
                              ? formatDateRange(s.effectiveFrom, s.effectiveTo)
                              : `from ${formatDateRange(s.effectiveFrom, s.effectiveFrom)}`}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      'No approved salary structure'
                    ),
                  },
                ]}
              />
            </section>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
