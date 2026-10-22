import { CreatePositionInputSchema, type Position, UpdatePositionInputSchema } from '@hrm/contracts';
import {
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Input,
  LoadingBlock,
  notify,
  Select,
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
import { BriefcaseBusiness, Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../../components/page-header';
import { orgQueries, useSavePosition } from '../../../features/organization/api';
import { useErrorMessage } from '../../../lib/api/errors';
import { requireAny, useCan } from '../../../lib/auth/me';
import { applyServerErrors, FormError, FormField, useZodForm } from '../../../lib/forms';

export const Route = createFileRoute('/_app/settings/positions')({
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['settings.read', 'org.manage']),
  component: PositionsPage,
});

function PositionsPage() {
  const canEdit = useCan('org.manage');
  const [showInactive, setShowInactive] = useState(false);
  const list = useQuery(orgQueries.positions(showInactive));
  const departments = useQuery(orgQueries.departments(true));
  const depName = (id: string | null) => departments.data?.find((d) => d.id === id)?.name ?? '—';
  const [editing, setEditing] = useState<Position | 'new' | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Positions"
        actions={
          canEdit ? (
            <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setEditing('new')}>
              Add position
            </Button>
          ) : null
        }
      />
      <TableContainer
        toolbar={
          <Checkbox
            label="Show retired positions"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
        }
      >
        {list.isPending ? (
          <div className="p-4">
            <LoadingBlock label="positions" />
          </div>
        ) : !list.data?.length ? (
          <EmptyState
            icon={BriefcaseBusiness}
            title="No positions yet"
            description="Add job titles so employees can be assigned to them."
            className="border-0"
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Title</TH>
                <TH>Department</TH>
                <TH>Grade</TH>
                <TH>Status</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {list.data.map((p) => (
                <TR key={p.id}>
                  <TD>{p.title}</TD>
                  <TD>{depName(p.departmentId)}</TD>
                  <TD>{p.grade ?? '—'}</TD>
                  <TD>
                    <StatusBadge
                      status={p.isActive ? 'active' : 'archived'}
                      label={p.isActive ? 'Active' : 'Retired'}
                    />
                  </TD>
                  <TD className="text-right">
                    {canEdit ? (
                      <Button variant="text" onClick={() => setEditing(p)}>
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
        <PositionDialog position={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function PositionDialog({ position, onClose }: { position: Position | null; onClose: () => void }) {
  const save = useSavePosition();
  const departments = useQuery(orgQueries.departments(false));
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useZodForm(position ? UpdatePositionInputSchema : CreatePositionInputSchema, {
    title: position?.title ?? '',
    departmentId: position?.departmentId ?? null,
    grade: position?.grade ?? null,
    ...(position ? { isActive: position.isActive, version: position.version } : {}),
  } as never);
  const submit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync(
        position ? { id: position.id, update: values as never } : { create: values as never },
      );
      notify.success(position ? 'Position saved' : 'Position added');
      onClose();
    } catch (err) {
      setFormError(applyServerErrors(form, err, errorMessage));
    }
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={position ? `Edit ${position.title}` : 'Add position'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => void submit()}>
            {position ? 'Save changes' : 'Add position'}
          </Button>
        </>
      }
    >
      <FormError message={formError} />
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <FormField
          control={form.control}
          name={'title' as never}
          label="Title"
          render={(p) => <Input {...p} />}
        />
        <FormField
          control={form.control}
          name={'departmentId' as never}
          label="Department"
          optional
          render={(p) => (
            <Select {...p} onChange={(e) => p.onChange(e.target.value || null)}>
              <option value="">Any department</option>
              {departments.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        />
        <FormField
          control={form.control}
          name={'grade' as never}
          label="Grade"
          optional
          render={(p) => <Input {...p} onChange={(e) => p.onChange(e.target.value || null)} />}
        />
        {position ? (
          <FormField
            control={form.control}
            name={'isActive' as never}
            label="Status"
            render={(p) => (
              <Checkbox
                label="Active (untick to retire)"
                checked={Boolean(p.value)}
                onChange={(e) => p.onChange(e.target.checked)}
              />
            )}
          />
        ) : null}
      </form>
    </Dialog>
  );
}
