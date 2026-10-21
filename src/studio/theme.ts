export type InterfaceTheme = 'dark' | 'light';
export const THEME_STORAGE_KEY = 'srtb-interface-theme';
const THEME_CHANGE_EVENT = 'srtb:interface-theme';

export function resolveTheme(value: unknown): InterfaceTheme {
  return value === 'light' ? 'light' : 'dark';
}

export function currentTheme(): InterfaceTheme {
  return resolveTheme(document.documentElement.dataset.theme);
}

export function setTheme(theme: InterfaceTheme) {
  document.documentElement.dataset.theme = theme;
  try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch {
    // Keep the control usable when this browser disallows persistence.
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function subscribeTheme(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    document.documentElement.dataset.theme = resolveTheme(event.newValue);
    onChange();
  };
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
