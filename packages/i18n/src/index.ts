import en from './locales/en.json';

/** English is the source catalogue; Bangla (`bn`) is added later with the same keys (D-003). */
export const resources = { en: { translation: en } } as const;
export const defaultLocale = 'en';
export const supportedLocales = ['en'] as const;
export type Locale = (typeof supportedLocales)[number];
