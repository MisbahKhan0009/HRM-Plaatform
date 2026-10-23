import { Alert, Button, CodeInput, Dialog, Field } from '@hrm/ui';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api/client';
import { useErrorMessage } from '../lib/api/errors';
import { authClient } from '../lib/auth/auth-client';
import { useMe } from '../lib/auth/me';

export type StepUpReason = 'MFA_REQUIRED' | 'REAUTH_REQUIRED';

/** The step-up dialog itself; loaded on demand by `StepUpDialog` so Radix Dialog and WebAuthn stay out of the main chunk. */
export function StepUpPanel({
  reason,
  finish,
}: {
  reason: StepUpReason;
  finish: (ok: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const errorMessage = useErrorMessage();
  const [mode, setMode] = useState<'choose' | 'totp' | 'email'>('choose');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await finish(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const passkey = () =>
    run(async () => {
      const res = await authClient.signIn.passkey();
      if (res?.error) throw new Error(res.error.message ?? 'passkey failed');
    });
  const totp = () => run(() => api.post('/auth/step-up/totp', { code }, { noStepUp: true }));
  const sendEmail = async () => {
    if (!me) return;
    setMode('email');
    await authClient.emailOtp.sendVerificationOtp({ email: me.user.email, type: 'sign-in' });
  };
  const verifyEmail = () =>
    run(async () => {
      if (!me) return;
      const res = await authClient.signIn.emailOtp({ email: me.user.email, otp: code });
      if (res?.error) throw new Error(res.error.message ?? 'code rejected');
    });

  const hasPasskey = me?.enrolment.hasPasskey ?? false;
  const hasTotp = me?.enrolment.hasTotp ?? false;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void finish(false);
      }}
      title={t('auth.stepUp.title')}
      description={reason === 'REAUTH_REQUIRED' ? t('auth.stepUp.reauth') : t('auth.stepUp.mfa')}
    >
      {error ? (
        <Alert tone="bad" assertive>
          {error}
        </Alert>
      ) : null}
      {mode === 'choose' ? (
        <div className="flex flex-col gap-2">
          {hasPasskey ? (
            <Button
              variant="primary"
              icon={<KeyRound aria-hidden="true" />}
              loading={busy}
              onClick={() => void passkey()}
            >
              {t('auth.stepUp.usePasskey')}
            </Button>
          ) : null}
          {hasTotp ? (
            <Button variant={hasPasskey ? 'secondary' : 'primary'} onClick={() => setMode('totp')}>
              {t('auth.stepUp.enterCode')}
            </Button>
          ) : null}
          {!hasPasskey && !hasTotp ? (
            <Button variant="primary" onClick={() => void sendEmail()}>
              {t('auth.stepUp.emailCode')}
            </Button>
          ) : null}
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void (mode === 'totp' ? totp() : verifyEmail());
          }}
        >
          <Field label={mode === 'totp' ? t('auth.twoFactor.code') : t('auth.verify.code')}>
            {({ id, describedBy, invalid }) => (
              <CodeInput
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                maxLength={mode === 'totp' ? 11 : 6}
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                autoFocus
              />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMode('choose')}>
              {t('common.back')}
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={code.length < 6}>
              {t('auth.stepUp.verify')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
