import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeContext';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="btn-ghost p-2 rounded-xl border border-transparent hover:border-ceitnot-border hover:bg-ceitnot-surface-2/80"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light theme' : 'Dark theme'}
    >
      {isDark ? <Sun size={20} className="text-ceitnot-gold" aria-hidden /> : <Moon size={20} className="text-ceitnot-accent-dim" aria-hidden />}
    </button>
  );
}
