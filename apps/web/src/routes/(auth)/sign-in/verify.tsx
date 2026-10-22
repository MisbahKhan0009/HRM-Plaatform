import { Alert, Button, CodeInput, Field, notify } from '@hrm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { AuthLayout } from '../../../components/auth-layout';
import { nextAfterSignIn } from '../../../lib/auth/after-sign-in';
import { authClient } from '../../../lib/auth/auth-client';

export const Route = createFileRoute('/(auth)/sign-in/verify')({
  validateSearch: z.object({ email: z.string(), redirect: z.string().optional() }),
  component: Verify,
});

const RESEND_SECONDS = 60;

// USER-FLOWS 1.2 steps 3–4.
function Verify() {
  const { t } = useTranslation();
  const { email, redirect } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.signIn.emailOtp({ email, otp: code });
      if (res.error) {
        const status = res.error.status;
        setError(
          status === 429
            ? t('errors.RATE_LIMITED')
            : status === 403
              ? t('auth.suspended')
              : t('errors.OTP_INVALID'),
        );
        return;
      }
      await navigate(await nextAfterSignIn(queryClient, redirect));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' });
    setWait(RESEND_SECONDS);
    notify.info(t('auth.verify.sent'));
  };

  return (
    <AuthLayout title={t('auth.verify.title')}>
      <p className="text-text-2">{t('auth.verify.lede', { email })}</p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void verify();
        }}
      >
        <Field label={t('auth.verify.code')} error={error ?? undefined}>
          {({ id, describedBy, invalid }) => (
            <CodeInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoFocus
            />
          )}
        </Field>
        <Button type="submit" variant="primary" loading={busy} disabled={code.length !== 6}>
          {t('auth.verify.submit')}
        </Button>
      </form>
      {error === t('auth.suspended') ? <Alert tone="bad">{error}</Alert> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <Button variant="text" disabled={wait > 0} onClick={() => void resend()}>
          {wait > 0 ? t('auth.verify.resendIn', { seconds: wait }) : t('auth.verify.resend')}
        </Button>
        <Link to="/sign-in" search={{ email }} className="text-link underline-offset-4 hover:underline">
          {t('auth.verify.differentEmail')}
        </Link>
      </div>
    </AuthLayout>
  );
}
