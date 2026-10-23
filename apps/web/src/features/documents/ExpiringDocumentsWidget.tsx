import { Card, CardHeader, LoadingBlock } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { formatDate, todayIso } from '../../lib/format';
import { documentQueries } from './api';
import { expiryState } from './expiry';

/**
 * Dashboard widget 10 (INFORMATION-ARCHITECTURE §5, `document.read.all`). The API has no company-wide expiry list
 * yet, so the widget lists company documents expiring within 30 days; employee documents and contracts reach HR
 * through the daily expiry digest email (`documents.expiry_reminders`).
 */
export function ExpiringDocumentsWidget() {
  const today = todayIso();
  const list = useQuery(documentQueries.company({ page: 1, pageSize: 100 }));
  const expiring = (list.data?.data ?? [])
    .filter((d) => expiryState(d.expiryDate, today) !== null)
    .sort((a, b) => (a.expiryDate ?? '').localeCompare(b.expiryDate ?? ''));
  return (
    <Card aria-labelledby="w-expiring">
      <CardHeader
        id="w-expiring"
        label="Documents"
        title={list.data ? `${expiring.length} expiring soon` : 'Expiring documents'}
      />
      {list.isPending ? (
        <LoadingBlock label="Loading expiring documents" rows={2} />
      ) : expiring.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {expiring.slice(0, 5).map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 truncate">{d.title}</span>
              <time dateTime={d.expiryDate ?? ''} className="shrink-0 text-sm text-text-2">
                {d.expiryDate && d.expiryDate < today ? 'Expired ' : 'Expires '}
                {d.expiryDate ? formatDate(d.expiryDate) : ''}
              </time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-text-2">No company documents expire in the next 30 days.</p>
      )}
      <p className="mt-3 text-sm text-text-2">
        Employee documents and contracts close to expiry are sent to HR in a daily email.
      </p>
    </Card>
  );
}
