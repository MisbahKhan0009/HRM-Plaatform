import { MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger } from '@hrm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { LogOut, Shield, SlidersHorizontal, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMe } from '../lib/auth/me';
import { initials, USER_MENU_TRIGGER } from '../lib/format-name';

/** The account menu (INFORMATION-ARCHITECTURE §4). Loaded on first use by `UserMenu` in the app shell. */
export function UserMenuPopup({ defaultOpen }: { defaultOpen: boolean }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  if (!me) return null;
  const signOut = async () => {
    // Loaded on demand: the Better Auth client is not needed until sign-out.
    const { authClient } = await import('../lib/auth/auth-client');
    await authClient.signOut().catch(() => undefined);
    queryClient.clear();
    await navigate({ to: '/sign-in' });
  };
  return (
    <MenuRoot defaultOpen={defaultOpen}>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={`${initials(me.user.name)}, ${t('nav.userMenu')}`}
          className={USER_MENU_TRIGGER}
        >
          {initials(me.user.name)}
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>
          <span className="block font-medium text-text">{me.user.name}</span>
          <span className="block">{me.user.email}</span>
        </MenuLabel>
        <MenuSeparator />
        {me.employee ? (
          <MenuItem onSelect={() => navigate({ to: '/me' })}>
            <User aria-hidden="true" />
            {t('nav.profile')}
          </MenuItem>
        ) : null}
        <MenuItem onSelect={() => navigate({ to: '/me/security' })}>
          <Shield aria-hidden="true" />
          {t('nav.security')}
        </MenuItem>
        <MenuItem onSelect={() => navigate({ to: '/me/preferences' })}>
          <SlidersHorizontal aria-hidden="true" />
          {t('nav.preferences')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden="true" />
          {t('nav.signOut')}
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}
