import type { LeaveBalance } from '@hrm/contracts';
import { Card, CardHeader, StatBar } from '@hrm/ui';
import { formatDays } from '../../../lib/format';
import { formatQty, isZeroQty } from '../format';

/**
 * One StatBar per leave type (SCREEN-INVENTORY 4.1): entitled, used, reserved and available exactly as the API
 * computed them; the client never adds balances up (CODING-STANDARDS §4).
 */
export function BalanceCards({ balances }: { balances: LeaveBalance[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {balances.map((b) => (
        <Card key={b.leaveTypeId} aria-labelledby={`bal-${b.leaveTypeId}`}>
          <CardHeader
            id={`bal-${b.leaveTypeId}`}
            label={b.leaveTypeCode}
            title={b.leaveTypeName}
            actions={
              <span className="text-sm text-text-2">
                <span className="font-mono tabular-nums">{formatDays(b.available)}</span> left
              </span>
            }
          />
          <StatBar
            stats={[
              { label: 'Available', value: formatQty(b.available) },
              { label: 'Reserved', value: formatQty(b.reserved) },
              { label: 'Used', value: formatQty(b.used) },
              { label: 'Entitled', value: formatQty(b.entitled) },
            ]}
          />
          {!isZeroQty(b.adjusted) ? (
            <p className="mt-3 text-sm text-text-2">
              Includes HR adjustments of{' '}
              <span className="font-mono tabular-nums">{formatDays(b.adjusted)}</span>.
            </p>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
