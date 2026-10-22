import { Card, KeyValueList } from '@hrm/ui';
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '../../../components/page-header';
import { requireAny, useMe } from '../../../lib/auth/me';

export const Route = createFileRoute('/_app/me/')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['employee.read.own']),
  component: MyProfile,
});

// The full profile (employment, contact, profile change requests) is built by the employees feature.
function MyProfile() {
  const me = useMe();
  if (!me?.employee) return null;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title={me.employee.name} code={me.employee.employeeCode} />
      <Card>
        <KeyValueList
          items={[
            { label: 'Email', value: me.user.email },
            { label: 'Employee code', value: <span className="font-mono">{me.employee.employeeCode}</span> },
          ]}
        />
      </Card>
    </div>
  );
}
