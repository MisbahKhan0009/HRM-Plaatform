import { useTranslation } from 'react-i18next';
import { ApiError, NetworkError } from './client';

/** Translated message for any error (CONTENT-STYLE §6): by code, never by server text. */
export function useErrorMessage() {
  const { t, i18n } = useTranslation();
  return (error: unknown): string => {
    if (error instanceof NetworkError) return t('errors.NETWORK');
    if (error instanceof ApiError) {
      const key = `errors.${error.code}`;
      if (error.code === 'RATE_LIMITED' && error.retryAfter) {
        const minutes = Math.max(1, Math.ceil(error.retryAfter / 60));
        return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
      }
      if (i18n.exists(key)) return t(key, { requestId: error.requestId ?? 'unknown' });
    }
    return t('errors.INTERNAL_ERROR', {
      requestId: error instanceof ApiError ? (error.requestId ?? 'unknown') : 'unknown',
    });
  };
}

/** Field errors keyed by JSON Pointer path, for forms (FORMS-AND-VALIDATION.md). */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(error.errors.map((e) => [e.path, e.message]));
}
