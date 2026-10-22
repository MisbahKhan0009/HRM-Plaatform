import { Button } from '@hrm/ui';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AuthLayout } from '../../components/auth-layout';

export const Route = createFileRoute('/(auth)/recover')({ component: Recover });

// USER-FLOWS 1.5a: there is no public self-service recovery; this page explains the options.
function Recover() {
  const { t } = useTranslation();
  const items = t('auth.recover.items', { returnObjects: true }) as string[];
  return (
    <AuthLayout title={t('auth.recover.title')}>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-text-2">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      <Button variant="secondary" asChild>
        <Link to="/sign-in">{t('auth.recover.back')}</Link>
      </Button>
    </AuthLayout>
  );
}
