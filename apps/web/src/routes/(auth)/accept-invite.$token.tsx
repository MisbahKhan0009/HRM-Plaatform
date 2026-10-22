import type { InvitationInfo } from '@hrm/contracts';
import { Alert, Button, LoadingBlock } from '@hrm/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AuthLayout } from '../../components/auth-layout';
import { api } from '../../lib/api/client';
import { useErrorMessage } from '../../lib/api/errors';

export const Route = createFileRoute('/(auth)/accept-invite/$token')({ component: AcceptInvite });

// USER-FLOWS 2 steps 3–5.
function AcceptInvite() {
  const { t } = useTranslation();
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const info = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.get<InvitationInfo>(`/auth/invitations/${token}`),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => api.post<{ email: string }>(`/auth/invitations/${token}/accept`),
    onSuccess: (res) => navigate({ to: '/sign-in/verify', search: { email: res.email } }),
  });

  if (info.isPending) {
    return (
      <AuthLayout title={t('auth.signIn.title')}>
        <LoadingBlock label="invitation" rows={2} />
      </AuthLayout>
    );
  }
  if (info.isError) {
    return (
      <AuthLayout title={t('auth.invite.expired')}>
        <Alert tone="warn">{t('auth.invite.expired')}</Alert>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title={t('auth.invite.title', { company: info.data.companyName })}>
      <p className="text-text-2">{t('auth.invite.lede', { email: info.data.maskedEmail })}</p>
      {accept.isError ? (
        <Alert tone="bad" assertive>
          {errorMessage(accept.error)}
        </Alert>
      ) : null}
      <Button variant="primary" loading={accept.isPending} onClick={() => accept.mutate()}>
        {t('auth.invite.continue')}
      </Button>
    </AuthLayout>
  );
}
