import { Alert, Button, Card, CardHeader, CodeInput, ConfirmDialog, Field, notify } from '@hrm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { KeyRound, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { renderSVG } from 'uqr';
import { z } from 'zod';
import { PageHeader } from '../../../components/page-header';
import { api } from '../../../lib/api/client';
import { useErrorMessage } from '../../../lib/api/errors';
import { authClient } from '../../../lib/auth/auth-client';
import { meQuery, needsEnrolment, useMe } from '../../../lib/auth/me';
import { formatDateTime } from '../../../lib/format';

export const Route = createFileRoute('/_app/me/security')({
  validateSearch: z.object({ enrol: z.boolean().optional() }),
  component: Security,
});

interface PasskeyRow {
  id: string;
  name?: string | null;
  createdAt?: string | Date | null;
}

interface SessionRow {
  id: string;
  token: string;
  userAgent?: string | null;
  createdAt: string | Date;
}

// USER-FLOWS 1.3 (enrolment gate) and 1.6; factor changes follow D-045.
function Security() {
  const { t } = useTranslation();
  const { enrol } = Route.useSearch();
  const me = useMe();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  const refreshMe = () => queryClient.invalidateQueries({ queryKey: meQuery.queryKey });

  const passkeys = useQuery({
    queryKey: ['auth', 'passkeys'],
    queryFn: async () => ((await authClient.passkey.listUserPasskeys()).data ?? []) as PasskeyRow[],
  });
  const sessions = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: async () => ((await authClient.listSessions()).data ?? []) as SessionRow[],
  });

  const addPasskey = useMutation({
    mutationFn: async () => {
      const res = await authClient.passkey.addPasskey({
        name: `This device, ${navigator.userAgent.includes('Mobile') ? 'phone' : 'computer'}`,
      });
      if (res?.error) throw new Error(res.error.message);
    },
    onSuccess: async () => {
      notify.success(t('me.security.passkeyAdded'));
      await Promise.all([passkeys.refetch(), refreshMe()]);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const [removing, setRemoving] = useState<PasskeyRow | null>(null);
  const removePasskey = useMutation({
    mutationFn: async (id: string) => {
      const res = await authClient.passkey.deletePasskey({ id });
      if (res?.error) throw new Error(res.error.message);
    },
    onSuccess: async () => {
      notify.success(t('me.security.passkeyRemoved'));
      setRemoving(null);
      await Promise.all([passkeys.refetch(), refreshMe()]);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const [totpSetup, setTotpSetup] = useState<{ uri: string; backupCodes: string[] } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [shownCodes, setShownCodes] = useState<string[] | null>(null);
  const enableTotp = useMutation({
    mutationFn: async () => {
      const res = await authClient.twoFactor.enable({} as never);
      if (res.error) throw new Error(res.error.message);
      return res.data as unknown as { totpURI: string; backupCodes: string[] };
    },
    onSuccess: (data) => setTotpSetup({ uri: data.totpURI, backupCodes: data.backupCodes }),
    onError: (err) => setError(errorMessage(err)),
  });
  const confirmTotp = useMutation({
    mutationFn: () => api.post('/auth/step-up/totp', { code: totpCode }, { noStepUp: true }),
    onSuccess: async () => {
      setShownCodes(totpSetup?.backupCodes ?? null);
      setTotpSetup(null);
      setTotpCode('');
      await refreshMe();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const regenerate = useMutation({
    mutationFn: async () => {
      const res = await authClient.twoFactor.generateBackupCodes({} as never);
      if (res.error) throw new Error(res.error.message);
      return (res.data as unknown as { backupCodes: string[] }).backupCodes;
    },
    onSuccess: (codes) => setShownCodes(codes),
    onError: (err) => setError(errorMessage(err)),
  });

  const revoke = useMutation({
    mutationFn: async (token: string) => {
      await authClient.revokeSession({ token });
    },
    onSuccess: () => sessions.refetch(),
  });

  const secret = totpSetup ? new URL(totpSetup.uri).searchParams.get('secret') : null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title={t('me.security.title')} />
      {enrol && me && needsEnrolment(me) ? <Alert tone="warn">{t('me.security.enrolGate')}</Alert> : null}
      {error ? (
        <Alert tone="bad" assertive>
          {error}
        </Alert>
      ) : null}

      <Card aria-labelledby="passkeys">
        <CardHeader
          id="passkeys"
          title={t('me.security.passkeys')}
          actions={
            <Button
              variant="primary"
              size="sm"
              icon={<KeyRound aria-hidden="true" />}
              loading={addPasskey.isPending}
              onClick={() => addPasskey.mutate()}
            >
              {t('me.security.addPasskey')}
            </Button>
          }
        />
        <p className="mb-4 text-text-2">{t('me.security.passkeysLede')}</p>
        {passkeys.data?.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {passkeys.data.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p>{p.name ?? 'Passkey'}</p>
                  {p.createdAt ? (
                    <p className="text-sm text-text-2">Added {formatDateTime(p.createdAt)}</p>
                  ) : null}
                </div>
                <Button variant="text" onClick={() => setRemoving(p)}>
                  {t('me.security.removePasskey')}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-2">{t('me.security.noPasskeys')}</p>
        )}
      </Card>

      <Card aria-labelledby="totp">
        <CardHeader
          id="totp"
          title={t('me.security.authenticator')}
          actions={
            me?.enrolment.hasTotp ? (
              <span className="text-sm text-ok">{t('me.security.enabled')}</span>
            ) : !totpSetup ? (
              <Button
                variant={me?.enrolment.hasPasskey ? 'secondary' : 'primary'}
                size="sm"
                icon={<Smartphone aria-hidden="true" />}
                loading={enableTotp.isPending}
                onClick={() => enableTotp.mutate()}
              >
                {t('me.security.setUp')}
              </Button>
            ) : null
          }
        />
        <p className="mb-4 text-text-2">{t('me.security.authenticatorLede')}</p>
        {totpSetup ? (
          <div className="flex flex-col gap-4">
            <p>{t('me.security.scan')}</p>
            <div
              className="size-48 rounded-card bg-white p-2"
              role="img"
              aria-label="QR code for the authenticator app"
              dangerouslySetInnerHTML={{ __html: renderSVG(totpSetup.uri) }}
            />
            {secret ? (
              <p className="text-sm">
                {t('me.security.secretKey')}: <span className="font-mono break-all">{secret}</span>
              </p>
            ) : null}
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                confirmTotp.mutate();
              }}
            >
              <Field label={t('me.security.confirmCode')} className="w-56">
                {({ id }) => (
                  <CodeInput
                    id={id}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                )}
              </Field>
              <Button
                type="submit"
                variant="primary"
                loading={confirmTotp.isPending}
                disabled={totpCode.length !== 6}
              >
                {t('me.security.confirm')}
              </Button>
            </form>
          </div>
        ) : null}
        {me?.enrolment.hasTotp ? (
          <div className="flex flex-col gap-3">
            <h3 className="font-semibold">{t('me.security.recoveryCodes')}</h3>
            <p className="text-text-2">{t('me.security.recoveryLede')}</p>
            <Button
              variant="secondary"
              className="w-fit"
              loading={regenerate.isPending}
              onClick={() => regenerate.mutate()}
            >
              {t('me.security.regenerate')}
            </Button>
          </div>
        ) : null}
        {shownCodes ? (
          <Alert tone="warn" title={t('me.security.recoveryCodes')} className="mt-4">
            <p className="mb-2">{t('me.security.recoveryLede')}</p>
            <ul className="grid grid-cols-2 gap-1 font-mono">
              {shownCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </Card>

      <Card aria-labelledby="sessions">
        <CardHeader id="sessions" title={t('me.security.sessions')} />
        <ul className="flex flex-col divide-y divide-line">
          {(sessions.data ?? []).map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate">{s.userAgent ?? 'Unknown device'}</p>
                <p className="text-sm text-text-2">{formatDateTime(s.createdAt)}</p>
              </div>
              <Button variant="text" onClick={() => revoke.mutate(s.token)}>
                {t('me.security.signOutDevice')}
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('me.security.removePasskey')}
        description={t('me.security.removePasskeyConfirm', { name: removing?.name ?? 'this passkey' })}
        confirmLabel={t('me.security.removePasskey')}
        loading={removePasskey.isPending}
        onConfirm={() => {
          if (removing) removePasskey.mutate(removing.id);
        }}
      />
    </div>
  );
}
