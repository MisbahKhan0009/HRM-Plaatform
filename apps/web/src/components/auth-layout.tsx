import { Eyebrow, Logo } from '@hrm/ui';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../lib/theme';
import { ThemeToggle } from './theme-toggle';

/** Auth zone brand moment (INFORMATION-ARCHITECTURE §6): dot grid and glow behind a single card. */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  useEffect(() => {
    document.title = `${title} · Big-Matrix HRM`;
  }, [title]);
  return (
    <div className="bm-stage min-h-screen bg-ground text-text">
      <div className="bm-glow bm-glow-2" aria-hidden="true" />
      <div className="bm-dotgrid" aria-hidden="true" />
      <div className="bm-stage-content mx-auto flex min-h-screen max-w-[1240px] flex-col gap-10 px-4 py-8 sm:px-8">
        <header className="flex items-center justify-between gap-4">
          <Logo theme={theme} />
          <ThemeToggle />
        </header>
        <main className="flex flex-1 flex-wrap items-center gap-12 lg:gap-16">
          <section className="hidden min-w-0 flex-[1_1_420px] flex-col gap-5 md:flex">
            <Eyebrow>{t('app.company')}</Eyebrow>
            <h1 className="font-display text-5xl leading-tight font-semibold tracking-tight">
              Your work life, in <em className="bm-em">{t('auth.headlineEm')}</em> place
            </h1>
            <p className="max-w-md text-lg text-text-2">{t('auth.lede')}</p>
          </section>
          <section
            aria-labelledby="auth-title"
            className="flex w-full flex-col gap-5 rounded-card border border-line bg-surface p-6 sm:p-8 md:flex-[0_1_440px]"
          >
            <Eyebrow>{t('auth.eyebrow')}</Eyebrow>
            <h2 id="auth-title" className="font-display text-2xl font-semibold">
              {title}
            </h2>
            {children}
          </section>
        </main>
      </div>
    </div>
  );
}
