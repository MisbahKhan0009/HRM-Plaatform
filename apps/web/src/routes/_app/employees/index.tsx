import { employeeStatusValues } from '@hrm/contracts';
import { LoadingBlock } from '@hrm/ui';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { DirectoryPage, directoryQuery, directorySortValues } from '../../../features/employees';
import { requireAny } from '../../../lib/auth/me';

const search = z.object({
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(1).max(100).default(25).catch(25),
  q: z.string().max(100).optional().catch(undefined),
  status: z
    .enum([...employeeStatusValues, 'all'])
    .optional()
    .catch(undefined),
  departmentId: z.uuid().optional().catch(undefined),
  positionId: z.uuid().optional().catch(undefined),
  managerId: z.uuid().optional().catch(undefined),
  sort: z.enum(directorySortValues).default('lastName').catch('lastName'),
});

export const Route = createFileRoute('/_app/employees/')({
  validateSearch: search,
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['employee.read.all', 'employee.read.team']),
  loaderDeps: ({ search: s }) => s,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(directoryQuery(deps)),
  pendingComponent: () => <LoadingBlock label="employees" />,
  component: DirectoryPage,
});
