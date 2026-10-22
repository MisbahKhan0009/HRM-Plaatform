import type { Document } from '@hrm/contracts';
import {
  Badge,
  Button,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { History, MoreHorizontal, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { formatDate, formatDateTime, todayIso } from '../../lib/format';
import { CATEGORY_LABEL, downloadUrl } from './api';
import { DeleteDocumentDialog, NewVersionDialog, VersionsDialog } from './DocumentDialogs';
import { expiryState } from './expiry';

type Dialog = { kind: 'versions' | 'version' | 'delete'; document: Document } | null;

/** Expiry date with an "Expiring" or "Expired" badge (text, never colour alone). */
export function ExpiryCell({ date, today }: { date: string | null; today: string }) {
  if (!date) return <span className="text-text-3">—</span>;
  const state = expiryState(date, today);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <time dateTime={date}>{formatDate(date)}</time>
      {state === 'expired' ? <Badge tone="bad">Expired</Badge> : null}
      {state === 'expiring' ? <Badge tone="warn">Expiring</Badge> : null}
    </span>
  );
}

/**
 * Document list (SCREEN-INVENTORY 6.3 and 8.4 Documents tab): title, category, dates, current version, download.
 * With `canManage` (document.manage) each row also offers a new version and retention deletion.
 */
export function DocumentsTable({
  documents,
  caption,
  canManage = false,
}: {
  documents: Document[];
  caption: string;
  canManage?: boolean;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const today = todayIso();
  const close = () => setDialog(null);
  return (
    <>
      {/* relative: keeps sr-only text inside the scroll container, so it cannot widen the page */}
      <Table className="relative">
        <caption className="sr-only">{caption}</caption>
        <THead>
          <tr>
            <TH>Document</TH>
            <TH>Category</TH>
            <TH>Issued</TH>
            <TH>Expires</TH>
            <TH>Version</TH>
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {documents.map((d) => (
            <TR key={d.id}>
              <TD>
                <span className="inline-flex items-center gap-2">
                  <span className="max-w-64 truncate font-medium">{d.title}</span>
                  {d.isRestricted ? (
                    <Badge tone="locked" className="normal-case">
                      Restricted
                    </Badge>
                  ) : null}
                </span>
              </TD>
              <TD>{CATEGORY_LABEL[d.category]}</TD>
              <TD>
                {d.issueDate ? (
                  <time dateTime={d.issueDate}>{formatDate(d.issueDate)}</time>
                ) : (
                  <span className="text-text-3">—</span>
                )}
              </TD>
              <TD>
                <ExpiryCell date={d.expiryDate} today={today} />
              </TD>
              <TD className="whitespace-nowrap">
                <button
                  type="button"
                  className="cursor-pointer text-left hover:underline"
                  onClick={() => setDialog({ kind: 'versions', document: d })}
                >
                  <span className="font-mono">v{d.currentVersion}</span>
                  <span className="text-text-2"> · {formatDateTime(d.current.uploadedAt).split(',')[0]}</span>
                  <span className="sr-only">, show versions of {d.title}</span>
                </button>
              </TD>
              <TD className="text-right whitespace-nowrap">
                <Button variant="text" asChild>
                  <a href={downloadUrl(d.id)} download>
                    Download<span className="sr-only"> {d.title}</span>
                  </a>
                </Button>
                {canManage ? (
                  <MenuRoot>
                    <MenuTrigger asChild>
                      <Button
                        variant="icon"
                        size="icon-sm"
                        className="ml-2"
                        aria-label={`More actions for ${d.title}`}
                      >
                        <MoreHorizontal aria-hidden="true" />
                      </Button>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem onSelect={() => setDialog({ kind: 'versions', document: d })}>
                        <History aria-hidden="true" />
                        Versions
                      </MenuItem>
                      <MenuItem onSelect={() => setDialog({ kind: 'version', document: d })}>
                        <Upload aria-hidden="true" />
                        Upload new version
                      </MenuItem>
                      <MenuItem destructive onSelect={() => setDialog({ kind: 'delete', document: d })}>
                        <Trash2 aria-hidden="true" />
                        Delete…
                      </MenuItem>
                    </MenuContent>
                  </MenuRoot>
                ) : null}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {dialog?.kind === 'versions' ? <VersionsDialog document={dialog.document} onClose={close} /> : null}
      {dialog?.kind === 'version' ? <NewVersionDialog document={dialog.document} onClose={close} /> : null}
      {dialog?.kind === 'delete' ? <DeleteDocumentDialog document={dialog.document} onClose={close} /> : null}
    </>
  );
}
