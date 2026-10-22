import { LoadingBlock } from '@hrm/ui';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import {
  EmployeeRecordPage,
  employeeQueries,
  ensureOr404,
  recordTabValues,
} from '../../../features/employees';
import { requireAny } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/employees/$employeeId')({
  validateSearch: z.object({ tab: z.enum(recordTabValues).default('overview').catch('overview') }),
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['employee.read.all', 'employee.read.team']),
  loader: ({ context, params }) =>
    ensureOr404(() => context.queryClient.ensureQueryData(employeeQueries.detail(params.employeeId))),
  pendingComponent: () => <LoadingBlock label="employee" />,
  component: EmployeeRecordPage,
});
