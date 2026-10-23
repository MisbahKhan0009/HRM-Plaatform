export type Theme = 'ink' | 'paper';

export const THEME_STORAGE_KEY = 'hrm.theme';

/** Ink is the brand default; the OS colour-scheme setting is deliberately ignored (D-040). */
export function readStoredTheme(storage: Pick<Storage, 'getItem'> | undefined): Theme {
  try {
    return storage?.getItem(THEME_STORAGE_KEY) === 'paper' ? 'paper' : 'ink';
  } catch {
    return 'ink';
  }
}

export function applyTheme(theme: Theme, root: HTMLElement, storage?: Pick<Storage, 'setItem'>): void {
  root.dataset.theme = theme;
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode); the server-side preference still applies.
  }
}
