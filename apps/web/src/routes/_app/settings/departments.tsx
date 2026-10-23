import { CreateDepartmentInputSchema, type Department, UpdateDepartmentInputSchema } from '@hrm/contracts';
import {
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Input,
  LoadingBlock,
  notify,
  StatusBadge,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Building2, Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../../components/page-header';
import { orgQueries, useSaveDepartment } from '../../../features/organization/api';
import { useErrorMessage } from '../../../lib/api/errors';
import { requireAny, useCan } from '../../../lib/auth/me';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../../lib/forms';

export const Route = createFileRoute('/_app/settings/departments')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['settings.read', 'org.manage']),
  component: DepartmentsPage,
});

function DepartmentsPage() {
  const canEdit = useCan('org.manage');
  const [showInactive, setShowInactive] = useState(false);
  const list = useQuery(orgQueries.departments(showInactive));
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Departments"
        actions={
          canEdit ? (
            <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setEditing('new')}>
              Add department
            </Button>
          ) : null
        }
      />
      <TableContainer
        toolbar={
          <Checkbox
            label="Show retired departments"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
        }
      >
        {list.isPending ? (
          <div className="p-4">
            <LoadingBlock label="departments" />
          </div>
        ) : !list.data?.length ? (
          <EmptyState
            icon={Building2}
            title="No departments yet"
            description="Add departments to group employees and route reports."
            className="border-0"
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Code</TH>
                <TH>Name</TH>
                <TH>Head</TH>
                <TH>Status</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {list.data.map((d) => (
                <TR key={d.id}>
                  <TD className="font-mono">{d.code}</TD>
                  <TD>{d.name}</TD>
                  <TD>{d.headEmployeeName ?? '—'}</TD>
                  <TD>
                    <StatusBadge
                      status={d.isActive ? 'active' : 'archived'}
                      label={d.isActive ? 'Active' : 'Retired'}
                    />
                  </TD>
                  <TD className="text-right">
                    {canEdit ? (
                      <Button variant="text" onClick={() => setEditing(d)}>
                        Edit
                      </Button>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </TableContainer>
      {editing ? (
        <DepartmentDialog department={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function DepartmentDialog({ department, onClose }: { department: Department | null; onClose: () => void }) {
  const save = useSaveDepartment();
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const createForm = useZodForm(CreateDepartmentInputSchema, { code: '', name: '' });
  const updateForm = useZodForm(UpdateDepartmentInputSchema, {
    name: department?.name ?? '',
    isActive: department?.isActive ?? true,
    version: department?.version ?? 1,
  });

  const submitCreate = createForm.handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ create: values });
      notify.success('Department added');
      onClose();
    } catch (err) {
      setFormError(applyServerErrors(createForm, err, errorMessage));
    }
  });
  const submitUpdate = updateForm.handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ id: department?.id as string, update: values });
      notify.success('Department saved');
      onClose();
    } catch (err) {
      setFormError(applyServerErrors(updateForm, err, errorMessage));
    }
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={department ? `Edit ${department.name}` : 'Add department'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => void (department ? submitUpdate() : submitCreate())}
          >
            {department ? 'Save changes' : 'Add department'}
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      {department ? (
        <form className="flex flex-col gap-4" onSubmit={submitUpdate}>
          <FormField control={updateForm.control} name="name" label="Name" render={(p) => <Input {...p} />} />
          <FormField
            control={updateForm.control}
            name="isActive"
            label="Status"
            render={(p) => (
              <Checkbox
                label="Active (untick to retire)"
                checked={Boolean(p.value)}
                onChange={(e) => p.onChange(e.target.checked)}
              />
            )}
          />
        </form>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={submitCreate}>
          <FormField
            control={createForm.control}
            name="code"
            label="Code"
            hint="2 to 20 capital letters, digits or dashes, for example FIN."
            render={(p) => <Input {...p} className="font-mono uppercase" />}
          />
          <FormField control={createForm.control} name="name" label="Name" render={(p) => <Input {...p} />} />
        </form>
      )}
    </Dialog>
  );
}
