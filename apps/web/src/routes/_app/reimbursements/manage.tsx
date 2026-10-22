import { claimStatusValues, IsoDateSchema } from '@hrm/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ManageClaimsPage } from '../../../features/reimbursements/ManageClaimsPage';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/reimbursements/manage')({
  validateSearch: z.object({
    page: z.number().int().min(1).default(1).catch(1),
    pageSize: z.number().int().min(1).max(100).default(25).catch(25),
    status: z.enum(claimStatusValues).optional().catch(undefined),
    employeeId: z.uuid().optional().catch(undefined),
    from: IsoDateSchema.optional().catch(undefined),
    to: IsoDateSchema.optional().catch(undefined),
  }),
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['reimbursement.read.all']),
  component: ManageClaimsPage,
});
