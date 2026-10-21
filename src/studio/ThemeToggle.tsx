import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { currentTheme, setTheme, subscribeTheme } from './theme';

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => 'dark');
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'light' ? 'Thème clair' : 'Thème sombre';
  const action = `Passer au ${label.toLocaleLowerCase('fr')}`;
  return <button type="button" className="theme-toggle" title={action} aria-label={action} onClick={() => setTheme(next)}>
    {next === 'light' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    <span>{label}</span>
  </button>;
}
