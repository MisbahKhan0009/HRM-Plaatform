import type { ClaimStatus } from '@hrm/contracts';
import { StatusBadge } from '@hrm/ui';
import { useTranslation } from 'react-i18next';

/** Claim status with its translated label (COMPONENT-SPECS §10). */
export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  const { t } = useTranslation();
  return <StatusBadge status={status} label={t(`status.${status}`)} />;
}
