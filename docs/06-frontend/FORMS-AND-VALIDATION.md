# Forms and validation

Every form uses **React Hook Form** with the **same Zod schema the API uses**, imported from `@hrm/contracts`. The client validates for speed and clarity; the server validates for truth. Field layout and visual states are in `docs/04-design/COMPONENT-SPECS.md` sections 3 to 6; copy in `docs/04-design/CONTENT-STYLE.md`.

## 1. Building a form

```tsx
// features/leave/forms/use-leave-request-form.ts (shape)
import { createLeaveRequestInput, type CreateLeaveRequestInput } from '@hrm/contracts'

export function useLeaveRequestForm(defaults: Partial<CreateLeaveRequestInput>) {
  return useForm<CreateLeaveRequestInput>({
    resolver: zodResolver(createLeaveRequestInput),
    defaultValues: { unit: 'day', ...defaults },
    mode: 'onTouched',          // validate a field after first blur, then on change
    reValidateMode: 'onChange',
  })
}
```

Rules:

- **One schema, both sides.** Never write a second schema in the frontend for the same input. If the UI needs extra client-only fields (a confirmation checkbox), extend the contract schema locally with `.extend()` and strip the extra fields before sending.
- Field components (`<FormField>` wrappers in `packages/ui`) connect RHF `Controller` to the input, label, hint and error, and set `aria-invalid` and `aria-describedby` (ACCESSIBILITY.md section 5).
- Default values come from the server record for edit forms, and from known context for create forms (WCAG 3.3.7 redundant entry: prefill employee, last used category).
- Submit with a mutation hook from `features/<module>/api.ts`. Disable the submit button while pending and show its loading state; never allow a double submit.
- Actions that create money or ledger effects send an `Idempotency-Key` (generated once per user action, reused on step-up retry; ARCHITECTURE.md section 4).
- Edit forms send the record's `version` (optimistic locking, API-STANDARDS.md); the field is hidden and part of the schema.

## 2. When validation runs

| Moment | What happens |
|---|---|
| Typing in an untouched field | Nothing (don't nag) |
| Leaving a field (blur) | That field validates; error shows below it |
| Changing a field that has an error | Re-validates on each change so the error clears as soon as it's fixed |
| Submit | All fields validate; if any fail, focus moves to the error summary at the top of the form, which links to each field |
| Server response | Server field errors are applied to fields (section 3); other errors as an inline alert |

Async previews (leave working days, balance after request) are not validation: they call `POST /leave/requests/preview` debounced by 300 ms after both dates are valid, show the result next to the fields, and never block submit. The submit response is authoritative.

## 3. Mapping server errors

Server errors are RFC 9457 problem responses (API-STANDARDS.md section 7).

```ts
function applyServerErrors(form: UseFormReturn<any>, error: ApiError) {
  if (error.code === 'VALIDATION_FAILED') {
    for (const issue of error.errors ?? []) {
      const field = pointerToFieldPath(issue.path)   // "/endDate" -> "endDate", "/lines/0/amount" -> "lines.0.amount"
      if (field && form.getFieldState(field)) {
        form.setError(field, { type: 'server', message: t(`validation:${issue.code}`, issue) })
      } else {
        formLevel.push(issue)                         // shown in the error summary
      }
    }
    return
  }
  // Business errors tied to a field
  const fieldFor: Partial<Record<ApiErrorCode, string>> = {
    DUPLICATE: pointerToFieldPath(error.errors?.[0]?.path),
    EMAIL_TAKEN: 'email',
    WORK_EMAIL_TAKEN: 'workEmail',
    DEPARTMENT_CODE_TAKEN: 'code',
    INVALID_DATE: pointerToFieldPath(error.errors?.[0]?.path),
    INSUFFICIENT_BALANCE: 'endDate',
    OVERLAPPING_LEAVE: 'startDate',
    LEAVE_NO_WORKING_DAYS: 'startDate',
    LEAVE_NOT_ELIGIBLE: 'leaveTypeId',
    SELF_MANAGER: 'managerId',
    REPORTING_CYCLE: 'managerId',
    PAYMENT_AMOUNT_MISMATCH: 'amount',
    SELF_APPROVAL_NOTE_REQUIRED: 'justification',
    FILE_TOO_LARGE: 'file',
    UNSUPPORTED_FILE_TYPE: 'file',
  }
  // otherwise: inline alert above the form with the message for error.code
}
```

- Field paths are JSON Pointers relative to the body; `query/…` paths never map to form fields.
- The message shown is always chosen by `code` through i18n (`errors:<CODE>` or `validation:<issueCode>`), never the server's `message` text.
- `409 VERSION_CONFLICT`: keep the user's input, refetch the record, show the inline alert "Someone else changed this…" and a **Review changes** link that opens a side-by-side of their input and the latest server values for changed fields.
- `409 INVALID_TRANSITION`: refetch the record and show the alert; the form usually closes because the action is no longer available.
- `403 MFA_REQUIRED` / `REAUTH_REQUIRED`: handled by the API client's step-up flow; the form stays as is and resubmits after success.
- Network errors: inline alert with **Try again**; input is kept.

## 4. Field rules shared across forms

| Field type | Rule |
|---|---|
| Dates | `YYYY-MM-DD` strings; range forms validate end ≥ start client-side (schema refinement) |
| Money | 2-decimal string, positive unless the schema allows negatives; `MoneyInput` normalises (I18N.md section 5.1) |
| Text reasons and comments | Trimmed; min and max lengths from the schema; counter shown when within 20% of max |
| Email | Lowercased and trimmed before validation; uniqueness only from the server (`DUPLICATE`) |
| Files | Type and size checked before upload; the server re-checks (COMPONENT-SPECS.md section 6) |
| Selects of records (employee, manager) | Send ids, show code and name |
| Optional fields | Empty string converted to `undefined` (not `null`) before sending unless the API uses `null` to clear a value; the contract states which |

## 5. Confirmation patterns

Choose the level from COMPONENT-SPECS.md section 12; copy from CONTENT-STYLE.md section 7.

- Level 2 and 3 confirmations run **after** client validation passes and **before** the request. The confirm button triggers the mutation; the dialog shows the mutation's pending state and closes on success.
- Level 4 (typed confirmation) compares the typed value with the expected value exactly (case-sensitive for run numbers, case-insensitive for emails). The API still checks permissions and re-auth.
- Payroll self-approval (D-007): the approve dialog contains the justification textarea (min 20 characters, required) and the acknowledgement checkbox; both are part of the request schema (`selfApprovalNote`) and validated by the server (`SELF_APPROVAL_NOTE_REQUIRED`).

## 6. Leaving with unsaved changes

When a form is dirty and the user navigates away, TanStack Router's `useBlocker` shows a dialog: "Discard changes?" with **Discard** (destructive) and **Keep editing**. Browser close or reload uses `beforeunload`. Claims additionally offer **Save draft** in this dialog, since claim drafts exist in the API (FR-REIM, API-CATALOGUE section 7). Leave requests have no drafts in v1.

## 7. Multi-step forms

Used by employee CSV import and the new employee form.

- Each step validates its own part of the schema before moving on; **Back** never loses data.
- Step state lives in the form (one RHF instance) and the current step index in the URL search param (`?step=2`), so refresh keeps the user on the step when possible.
- The CSV import preview (`POST /employees/import/preview`) is a server step; the commit uses the returned `previewToken` with an `Idempotency-Key`.

## 8. Testing

Each form has feature tests (`docs/07-quality/TESTING-STRATEGY.md`): field error after blur, error summary and focus on failed submit, server `VALIDATION_FAILED` mapped to the right fields, business error codes mapped to fields or alert, pending state blocks double submit, discard guard.
