import { defaultLocale, resources } from '@hrm/i18n';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Every UI string goes through i18n from day one so Bangla can be added without redesign (D-003).
void i18n.use(initReactI18next).init({
  resources,
  lng: defaultLocale,
  fallbackLng: defaultLocale,
  interpolation: { escapeValue: false },
});
