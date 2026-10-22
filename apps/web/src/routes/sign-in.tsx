import { applyTheme, readStoredTheme, type Theme } from '@hrm/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';

export const Route = createFileRoute('/sign-in')({ component: SignIn });

// Layout skeleton for the sign-in brand moment (design: docs/04-design/canvas/Main.dc.html).
// The passwordless flow itself is wired in Stage 8 after the auth spike.
function SignIn() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme(globalThis.localStorage));
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });

  const toggle = () => {
    const next: Theme = theme === 'ink' ? 'paper' : 'ink';
    applyTheme(next, document.documentElement, globalThis.localStorage);
    setTheme(next);
  };

  return (
    <div className="bm-stage min-h-screen">
      <div className="bm-glow bm-glow-2" aria-hidden="true" />
      <div className="bm-dotgrid" aria-hidden="true" />
      <div className="bm-stage-content mx-auto flex min-h-screen max-w-[1240px] flex-col gap-10 px-4 py-10 sm:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <img
            src={theme === 'paper' ? '/logo-paper.png' : '/logo-ink.png'}
            alt="Big-Matrix Solutions"
            className="h-8 w-auto"
          />
          <button
            type="button"
            onClick={toggle}
            className="h-9 rounded-control border border-control-border px-3 text-sm font-medium"
            aria-label={t('theme.label')}
          >
            {theme === 'ink' ? t('theme.paper') : t('theme.ink')}
          </button>
        </header>
        <main className="flex flex-1 flex-wrap items-center gap-16">
          <section className="flex min-w-0 flex-[1_1_420px] flex-col gap-6">
            <h1 className="font-display text-5xl font-semibold leading-tight tracking-tight">
              Your work life, in <em className="bm-em">one</em> place
            </h1>
          </section>
          <section
            aria-labelledby="sign-in-title"
            className="flex flex-[0_1_440px] flex-col gap-5 rounded-card border border-line bg-surface p-8"
          >
            <h2 id="sign-in-title" className="font-display text-2xl font-semibold">
              {t('auth.signIn.title')}
            </h2>
            <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="email">
              {t('auth.signIn.email')}
              <input
                id="email"
                type="email"
                autoComplete="username webauthn"
                className="h-10 rounded-control border border-control-border bg-ground-2 px-3 font-normal"
              />
            </label>
            <button
              type="button"
              className="h-10 rounded-control bg-action font-semibold text-on-action shadow-primary hover:bg-action-hover"
            >
              {t('auth.signIn.sendCode')}
            </button>
            <button type="button" className="h-10 rounded-control border border-control-border font-semibold">
              {t('auth.signIn.passkey')}
            </button>
          </section>
        </main>
        <footer className="font-mono text-xs uppercase tracking-[0.13em] text-text-3">
          API {health.data ? `v${health.data.version} · ok` : health.isError ? 'unreachable' : '…'}
        </footer>
      </div>
    </div>
  );
}
