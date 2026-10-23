import { Alert, Button, Field, Input } from '@hrm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { AuthLayout } from '../../../components/auth-layout';
import { useErrorMessage } from '../../../lib/api/errors';
import { nextAfterSignIn } from '../../../lib/auth/after-sign-in';
import { authClient } from '../../../lib/auth/auth-client';

export const Route = createFileRoute('/(auth)/sign-in/')({
  validateSearch: z.object({ redirect: z.string().optional(), email: z.string().optional() }),
  component: SignIn,
});

// USER-FLOWS 1.1–1.2: email code or passkey. The send endpoint answers the same for unknown emails.
function SignIn() {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [email, setEmail] = useState(search.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'code' | 'passkey' | null>(null);

  const sendCode = async () => {
    setBusy('code');
    setError(null);
    try {
      const res = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: 'sign-in' });
      if (res.error) throw new Error(res.error.message);
      await navigate({
        to: '/sign-in/verify',
        search: { email: email.trim(), ...(search.redirect ? { redirect: search.redirect } : {}) },
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const passkey = async () => {
    setBusy('passkey');
    setError(null);
    try {
      const res = await authClient.signIn.passkey();
      if (res?.error) {
        // A cancelled browser prompt is not an error (USER-FLOWS 1.1).
        if (!('code' in res.error) || res.error.code !== 'AUTH_CANCELLED')
          setError(t('auth.signIn.passkeyFailed'));
        return;
      }
      await navigate(await nextAfterSignIn(queryClient, search.redirect));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AuthLayout title={t('auth.signIn.title')}>
      {error ? (
        <Alert tone="bad" assertive>
          {error}
        </Alert>
      ) : null}
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void sendCode();
        }}
      >
        <Field label={t('auth.signIn.email')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="email"
              required
              autoComplete="username webauthn"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" loading={busy === 'code'} disabled={!email.includes('@')}>
          {t('auth.signIn.sendCode')}
        </Button>
      </form>
      <div className="flex items-center gap-3 text-sm text-text-3">
        <span className="h-px flex-1 bg-line" />
        {t('auth.signIn.or')}
        <span className="h-px flex-1 bg-line" />
      </div>
      <Button
        variant="secondary"
        icon={<KeyRound aria-hidden="true" />}
        loading={busy === 'passkey'}
        onClick={() => void passkey()}
      >
        {t('auth.signIn.passkey')}
      </Button>
      <Link to="/recover" className="text-sm text-link underline-offset-4 hover:underline">
        {t('auth.signIn.recover')}
      </Link>
    </AuthLayout>
  );
}
