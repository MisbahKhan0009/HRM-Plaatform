import type { CurrentUser } from '@hrm/contracts';
import { applyTheme, readStoredTheme, type Theme } from '@hrm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api/client';
import { meQuery, useMe } from './auth/me';

const storage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

/**
 * Theme state (THEMING-AND-TOKENS.md): applied to <html> at once, then saved to localStorage and, when signed in,
 * to the server so it follows the user to a new device. The server value wins after sign-in.
 */
export function useTheme() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme(storage()));

  useEffect(() => {
    if (me && me.user.theme !== theme) {
      applyTheme(me.user.theme, document.documentElement, storage());
      setTheme(me.user.theme);
    }
  }, [me, theme]);

  const change = async (next: Theme) => {
    applyTheme(next, document.documentElement, storage());
    setTheme(next);
    if (me) {
      queryClient.setQueryData(meQuery.queryKey, { ...me, user: { ...me.user, theme: next } } as CurrentUser);
      const updated = await api.patch<CurrentUser>('/auth/me/preferences', { theme: next }).catch(() => null);
      if (updated) queryClient.setQueryData(meQuery.queryKey, updated);
    }
  };
  return { theme, setTheme: change, toggle: () => change(theme === 'ink' ? 'paper' : 'ink') };
}
