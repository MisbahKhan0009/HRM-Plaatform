import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { setStepUpHandler } from '../lib/api/client';
import { meQuery } from '../lib/auth/me';
import type { StepUpReason } from './step-up-panel';

const StepUpPanel = lazy(() => import('./step-up-panel').then((m) => ({ default: m.StepUpPanel })));

/**
 * Step-up during a session (USER-FLOWS 1.4): opened by the API client on MFA_REQUIRED / REAUTH_REQUIRED; on success
 * the client retries the original request once with the same Idempotency-Key; on cancel nothing changes.
 * The handler registers at startup; the dialog code loads only when a step-up runs.
 */
export function StepUpDialog() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<StepUpReason | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    setStepUpHandler(
      (r) =>
        new Promise<boolean>((resolve) => {
          const current = queryClient.getQueryData(meQuery.queryKey);
          if (
            r === 'MFA_REQUIRED' &&
            current &&
            !current.enrolment.hasPasskey &&
            !current.enrolment.hasTotp
          ) {
            void navigate({ to: '/me/security', search: { enrol: true } });
            resolve(false);
            return;
          }
          resolver.current = resolve;
          setReason(r);
        }),
    );
    return () => setStepUpHandler(null);
  }, [navigate, queryClient]);

  const finish = async (ok: boolean) => {
    if (ok) await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
    resolver.current?.(ok);
    resolver.current = null;
    setReason(null);
  };

  return reason ? (
    <Suspense fallback={null}>
      <StepUpPanel key={reason} reason={reason} finish={finish} />
    </Suspense>
  ) : null;
}
