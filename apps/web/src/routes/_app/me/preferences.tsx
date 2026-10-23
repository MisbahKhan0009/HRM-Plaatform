import type { CurrentUser } from '@hrm/contracts';
import { Card, Field, notify, Select } from '@hrm/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../../components/page-header';
import { api } from '../../../lib/api/client';
import { meQuery, useMe } from '../../../lib/auth/me';
import { useTheme } from '../../../lib/theme';

export const Route = createFileRoute('/_app/me/preferences')({ component: Preferences });

// COMPONENT-SPECS §20: the theme is also a two-option radio group here.
function Preferences() {
  const { t } = useTranslation();
  const me = useMe();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const locale = useMutation({
    mutationFn: (value: 'en' | 'bn') => api.patch<CurrentUser>('/auth/me/preferences', { locale: value }),
    onSuccess: (updated) => {
      queryClient.setQueryData(meQuery.queryKey, updated);
      notify.success(t('me.preferences.saved'));
    },
  });
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader title={t('me.preferences.title')} />
      <Card>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">{t('me.preferences.theme')}</legend>
          {(['ink', 'paper'] as const).map((value) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-3 rounded-control border border-line p-3 has-checked:border-accent has-checked:bg-accent-tint"
            >
              <input
                type="radio"
                name="theme"
                value={value}
                checked={theme === value}
                onChange={() => void setTheme(value)}
                className="accent-[var(--action)]"
              />
              {value === 'ink' ? t('me.preferences.themeInk') : t('me.preferences.themePaper')}
            </label>
          ))}
        </fieldset>
      </Card>
      <Card>
        <Field label={t('me.preferences.language')} hint="Bangla is coming later.">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={me?.user.locale ?? 'en'}
              onChange={(e) => locale.mutate(e.target.value as 'en' | 'bn')}
            >
              <option value="en">English</option>
            </Select>
          )}
        </Field>
      </Card>
    </div>
  );
}
