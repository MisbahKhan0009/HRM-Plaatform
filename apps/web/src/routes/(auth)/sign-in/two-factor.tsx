import { Alert, Button, CodeInput, Field } from '@hrm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { AuthLayout } from '../../../components/auth-layout';
import { api } from '../../../lib/api/client';
import { useErrorMessage } from '../../../lib/api/errors';
import { nextAfterSignIn } from '../../../lib/auth/after-sign-in';
import { authClient } from '../../../lib/auth/auth-client';
import { useMe } from '../../../lib/auth/me';

export const Route = createFileRoute('/(auth)/sign-in/two-factor')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  component: TwoFactor,
});

// USER-FLOWS 1.3: a weak session of a privileged user becomes strong with TOTP, a recovery code or a passkey.
function TwoFactor() {
  const { t } = useTranslation();
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const me = useMe();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await navigate(await nextAfterSignIn(queryClient, redirect));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t('auth.twoFactor.title')}>
      <p className="text-text-2">{t('auth.twoFactor.lede')}</p>
      {me?.enrolment.hasPasskey ? (
        <Button
          variant="primary"
          icon={<KeyRound aria-hidden="true" />}
          onClick={() =>
            void submit(async () => {
              const res = await authClient.signIn.passkey();
              if (res?.error) throw new Error(res.error.message);
            })
          }
        >
          {t('auth.twoFactor.usePasskey')}
        </Button>
      ) : null}
      {me?.enrolment.hasTotp ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(() => api.post('/auth/step-up/totp', { code }, { noStepUp: true }));
          }}
        >
          <Field
            label={recovery ? t('auth.twoFactor.recoveryCode') : t('auth.twoFactor.code')}
            error={error ?? undefined}
          >
            {({ id, describedBy, invalid }) => (
              <CodeInput
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                maxLength={recovery ? 11 : 6}
                inputMode={recovery ? 'text' : 'numeric'}
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                autoFocus
              />
            )}
          </Field>
          <Button
            type="submit"
            variant={me.enrolment.hasPasskey ? 'secondary' : 'primary'}
            loading={busy}
            disabled={code.length < 6}
          >
            {t('auth.twoFactor.submit')}
          </Button>
          <Button variant="text" onClick={() => setRecovery((r) => !r)}>
            {recovery ? t('auth.twoFactor.useAuthenticator') : t('auth.twoFactor.useRecovery')}
          </Button>
        </form>
      ) : error ? (
        <Alert tone="bad">{error}</Alert>
      ) : null}
    </AuthLayout>
  );
}
