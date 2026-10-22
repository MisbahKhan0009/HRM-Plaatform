import { Input, MoneyInput, Textarea } from '@hrm/ui';
import type { UseFormReturn } from 'react-hook-form';
import { todayIso } from '../../lib/format';
import { FormField } from '../../lib/forms';
import type { ClaimFormOutput, ClaimFormValues } from './form';

/** Date of travel, amount and description of a transport claim (USER-FLOWS 6 step 2). */
export function ClaimFields({ form }: { form: UseFormReturn<ClaimFormValues, unknown, ClaimFormOutput> }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="expenseDate"
          label="Date of travel"
          render={(p) => <Input type="date" max={todayIso()} {...p} />}
        />
        <FormField
          control={form.control}
          name="amount"
          label="Amount"
          hint="In taka, up to 2 decimals."
          render={(p) => <MoneyInput placeholder="0.00" autoComplete="off" {...p} />}
        />
      </div>
      <FormField
        control={form.control}
        name="description"
        label="Purpose"
        hint="Where you went and why, for example a client meeting in Gulshan."
        render={(p) => <Textarea maxLength={1000} {...p} />}
      />
    </>
  );
}
