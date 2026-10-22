import { Button, Tooltip } from '@hrm/ui';
import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../lib/theme';

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const label = theme === 'ink' ? t('theme.toLight') : t('theme.toDark');
  return (
    <Tooltip content={label} align="end">
      <Button variant="icon" size="icon" aria-label={label} onClick={() => void toggle()}>
        {theme === 'ink' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      </Button>
    </Tooltip>
  );
}
