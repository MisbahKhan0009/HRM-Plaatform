import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Field } from '@hrm/ui';
import type { ReactElement, ReactNode } from 'react';
import {
  type Control,
  Controller,
  type DefaultValues,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
  useForm,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { ApiError } from './api/client';
import { useErrorMessage } from './api/errors';

/** RHF with the contract's Zod schema (FORMS-AND-VALIDATION §1): validate on blur, then on change. */
export function useZodForm<S extends z.ZodType<FieldValues, FieldValues>>(
  schema: S,
  defaultValues: DefaultValues<z.input<S>>,
) {
  return useForm<z.input<S>, unknown, z.output<S>>({
    resolver: zodResolver(schema as never) as never,
    defaultValues,
    mode: 'onTouched',
    reValidateMode: 'onChange',
  });
}

const pointerToField = (path: string) => path.replace(/^\//, '').replaceAll('/', '.');

// Business codes tied to a field (FORMS-AND-VALIDATION §3).
const FIELD_FOR: Record<string, string> = {
  EMAIL_TAKEN: 'email',
  WORK_EMAIL_TAKEN: 'workEmail',
  DEPARTMENT_CODE_TAKEN: 'code',
  INSUFFICIENT_BALANCE: 'endDate',
  OVERLAPPING_LEAVE: 'startDate',
  LEAVE_NO_WORKING_DAYS: 'startDate',
  LEAVE_NOT_ELIGIBLE: 'leaveTypeId',
  SELF_MANAGER: 'managerId',
  REPORTING_CYCLE: 'managerId',
  PAYMENT_AMOUNT_MISMATCH: 'amount',
  SELF_APPROVAL_NOTE_REQUIRED: 'selfApprovalNote',
  INVALID_DATE: 'workDate',
  FILE_TOO_LARGE: 'file',
  UNSUPPORTED_FILE_TYPE: 'file',
};

/**
 * Puts server errors on their fields; returns the message for a form-level alert, or null when every error found a
 * field (FORMS-AND-VALIDATION §3).
 */
export function applyServerErrors<T extends FieldValues>(
  form: UseFormReturn<T>,
  error: unknown,
  message: (e: unknown) => string,
): string | null {
  if (!(error instanceof ApiError)) return message(error);
  const fields = Object.keys(form.getValues());
  let unplaced = false;
  if (error.code === 'VALIDATION_FAILED' || error.code === 'DUPLICATE' || error.code === 'INVALID_DATE') {
    for (const issue of error.errors) {
      const field = pointerToField(issue.path);
      if (fields.includes(field.split('.')[0] ?? '')) {
        form.setError(field as FieldPath<T>, {
          type: 'server',
          message: error.code === 'DUPLICATE' ? 'This value is already in use.' : issue.message,
        });
      } else unplaced = true;
    }
    if (error.errors.length && !unplaced) return null;
  }
  const field = FIELD_FOR[error.code];
  if (field && fields.includes(field)) {
    form.setError(field as FieldPath<T>, { type: 'server', message: message(error) });
    return null;
  }
  return message(error);
}

export function FormError({ message }: { message: string | null }) {
  return message ? (
    <Alert tone="bad" assertive>
      {message}
    </Alert>
  ) : null;
}

/** Connects a contract field to a labelled control (label, hint, error, aria wiring). */
export function FormField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  optional,
  render,
  className,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: ReactNode;
  hint?: ReactNode;
  optional?: boolean;
  className?: string;
  render: (props: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean;
    value: never;
    onChange: (v: unknown) => void;
    onBlur: () => void;
    name: string;
  }) => ReactElement;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field
          label={label}
          hint={hint}
          error={fieldState.error?.message}
          optional={optional ?? false}
          {...(className ? { className } : {})}
        >
          {({ id, describedBy, invalid }) =>
            render({
              id,
              'aria-describedby': describedBy,
              'aria-invalid': invalid,
              value: (field.value ?? '') as never,
              onChange: field.onChange,
              onBlur: field.onBlur,
              name: field.name,
            })
          }
        </Field>
      )}
    />
  );
}

/** Form-level helpers bundled for pages. */
export function useFormHelpers() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  return { t, errorMessage };
}
