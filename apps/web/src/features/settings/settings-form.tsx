import type { SettingDto, SettingKey, SettingScope } from '@hrm/contracts';
import { Button, Card, Checkbox, Input, KeyValueList, MoneyInput, notify, Select } from '@hrm/ui';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, type FieldValues, type UseFormReturn } from 'react-hook-form';
import { ApiError, StepUpCancelledError } from '../../lib/api/client';
import { useErrorMessage } from '../../lib/api/errors';
import { FormError, FormField, useZodForm } from '../../lib/forms';
import { settingsQueries, useUpdateSettings } from './api';
import {
  type FieldDef,
  fieldName,
  fromFormValue,
  normalizeStored,
  numberBounds,
  SETTING_FIELDS,
  settingsFormSchema,
  toFormValue,
} from './fields';

const formValues = (settings: SettingDto[]) =>
  Object.fromEntries(
    settings.map((s) => [fieldName(s.key), toFormValue(SETTING_FIELDS[s.key as SettingKey].kind, s.value)]),
  );

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function describeValue(def: FieldDef, value: unknown): string {
  if (value === null || value === undefined) return def.kind === 'retention' ? 'Keep' : 'Not set';
  if (def.kind === 'bool') return value ? 'On' : 'Off';
  if (def.kind === 'choice') return def.options?.find((o) => o.value === value)?.label ?? String(value);
  if (def.kind === 'multi' && Array.isArray(value))
    return value.map((v) => def.options?.find((o) => o.value === v)?.label ?? v).join(', ');
  return `${String(value)}${def.unit ? ` ${def.unit}` : ''}`;
}

/**
 * Edits one settings scope over `GET/PATCH /settings` (API-CATALOGUE §3). Only changed keys are sent, each with the
 * version it was read at, so another admin's edit of a different key doesn't conflict.
 */
export function SettingsScopeForm({
  scope,
  sections,
  hideFixed = false,
}: {
  scope: SettingScope;
  sections?: string[];
  /** Hide the read-only values (the company page already shows them). */
  hideFixed?: boolean;
}) {
  const { data } = useSuspenseQuery(settingsQueries.values());
  const settings = data[scope] ?? [];
  if (!settings.length) return null;
  // Remount with fresh defaults whenever stored versions change (after save or a conflict).
  const versionKey = settings.map((s) => s.version).join('.');
  return (
    <ScopeForm
      key={versionKey}
      settings={settings}
      hideFixed={hideFixed}
      {...(sections ? { sections } : {})}
    />
  );
}

function ScopeForm({
  settings,
  sections,
  hideFixed,
}: {
  settings: SettingDto[];
  sections?: string[];
  hideFixed: boolean;
}) {
  const queryClient = useQueryClient();
  const update = useUpdateSettings();
  const errorMessage = useErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const keys = settings.map((s) => s.key as SettingKey);
  const form = useZodForm(
    settingsFormSchema(keys),
    formValues(settings) as never,
  ) as unknown as UseFormReturn<FieldValues>;
  const editable = settings.some((s) => s.editable);

  const order = sections ?? [...new Set(keys.map((k) => SETTING_FIELDS[k].section))];
  const fixed = settings.filter((s) => SETTING_FIELDS[s.key as SettingKey].kind === 'fixed');

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    const changes: Record<string, { value: unknown; version: number }> = {};
    for (const s of settings) {
      const def = SETTING_FIELDS[s.key as SettingKey];
      if (def.kind === 'fixed' || !s.editable) continue;
      const value = fromFormValue(def.kind, values[fieldName(s.key)]);
      if (!same(value, normalizeStored(def.kind, s.value))) changes[s.key] = { value, version: s.version };
    }
    if (!Object.keys(changes).length) return;
    try {
      await update.mutateAsync({ changes });
      notify.success('Settings saved');
    } catch (err) {
      if (err instanceof StepUpCancelledError) return;
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        let unplaced = false;
        for (const e of err.errors) {
          const key = /^\/changes\/([^/]+)/.exec(e.path)?.[1];
          if (key && keys.includes(key as SettingKey)) {
            form.setError(fieldName(key), { type: 'server', message: e.message });
          } else unplaced = true;
        }
        if (!unplaced && err.errors.length) return;
      }
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        await queryClient.refetchQueries({ queryKey: settingsQueries.all() });
      }
      setFormError(errorMessage(err));
    }
  });

  return (
    <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
      <FormError message={formError} />
      {fixed.length && !hideFixed ? (
        <Card>
          <KeyValueList
            items={fixed.map((s) => ({
              label: SETTING_FIELDS[s.key as SettingKey].label,
              value: String(s.value),
            }))}
          />
        </Card>
      ) : null}
      {order.map((section) => {
        const inSection = settings.filter((s) => {
          const def = SETTING_FIELDS[s.key as SettingKey];
          return def.section === section && def.kind !== 'fixed';
        });
        if (!inSection.length) return null;
        const headingId = `section-${section.replaceAll(' ', '-').toLowerCase()}`;
        return (
          <Card key={section} aria-labelledby={headingId}>
            <h2 id={headingId} className="mb-4 font-display text-[17px] font-semibold">
              {section}
            </h2>
            <fieldset disabled={!editable} className="flex flex-col gap-5">
              {inSection.map((s) => (
                <SettingField key={s.key} setting={s} form={form} />
              ))}
            </fieldset>
          </Card>
        );
      })}
      {editable ? (
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            loading={update.isPending}
            disabled={!form.formState.isDirty}
          >
            Save changes
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function SettingField({ setting, form }: { setting: SettingDto; form: UseFormReturn<FieldValues> }) {
  const key = setting.key as SettingKey;
  const def = SETTING_FIELDS[key];
  const name = fieldName(key);
  const changed = !same(
    normalizeStored(def.kind, setting.value),
    normalizeStored(def.kind, setting.defaultValue),
  );
  const { min, max } = numberBounds(key);
  const range = min !== null && max !== null ? `From ${min} to ${max}.` : null;
  const hint = [def.hint, range, changed ? `Default: ${describeValue(def, setting.defaultValue)}.` : null]
    .filter(Boolean)
    .join(' ');

  if (def.kind === 'bool' || def.kind === 'multi') {
    return (
      <Controller
        control={form.control}
        name={name}
        render={({ field, fieldState }) =>
          def.kind === 'bool' ? (
            <div className="flex flex-col gap-1">
              <Checkbox
                label={def.label}
                checked={Boolean(field.value)}
                onChange={(e) => field.onChange(e.target.checked)}
                onBlur={field.onBlur}
              />
              {hint ? <p className="pl-6 text-sm text-text-2">{hint}</p> : null}
            </div>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{def.label}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {def.options?.map((o) => {
                  const list = (field.value ?? []) as string[];
                  return (
                    <Checkbox
                      key={o.value}
                      label={o.label}
                      checked={list.includes(o.value)}
                      onChange={(e) =>
                        field.onChange(
                          e.target.checked ? [...list, o.value] : list.filter((v) => v !== o.value),
                        )
                      }
                    />
                  );
                })}
              </div>
              {hint ? <p className="text-sm text-text-2">{hint}</p> : null}
              {fieldState.error ? <p className="text-sm text-bad">{fieldState.error.message}</p> : null}
            </fieldset>
          )
        }
      />
    );
  }

  return (
    <FormField
      control={form.control}
      name={name}
      label={def.label}
      {...(hint ? { hint } : {})}
      optional={def.kind === 'retention'}
      render={(p) => {
        switch (def.kind) {
          case 'choice':
            return (
              <Select {...p} onChange={(e) => p.onChange(e.target.value)}>
                {def.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            );
          case 'money':
            return <MoneyInput {...p} className="max-w-48" onChange={(e) => p.onChange(e.target.value)} />;
          case 'text':
            return (
              <Input
                {...p}
                className="max-w-48 font-mono uppercase"
                onChange={(e) => p.onChange(e.target.value.toUpperCase())}
              />
            );
          default:
            return (
              <div className="flex items-center gap-2">
                <Input
                  {...p}
                  inputMode="numeric"
                  className="max-w-32 text-right font-mono tabular-nums"
                  {...(def.kind === 'retention' ? { placeholder: 'Keep' } : {})}
                  onChange={(e) => p.onChange(e.target.value)}
                />
                {def.unit ? <span className="text-text-2">{def.unit}</span> : null}
              </div>
            );
        }
      }}
    />
  );
}
