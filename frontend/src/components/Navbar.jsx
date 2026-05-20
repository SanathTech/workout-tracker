import { NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: '📊' },
  { to: '/program', label: 'Program', icon: '📋' },
  { to: '/progress', label: 'Progress', icon: '📈' },
  { to: '/exercises', label: 'Exercises', icon: '🏋️' },
];

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <button
      type="button"
      onClick={() => setDark((d) => !d)}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="ml-auto shrink-0 p-2 rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
    >
      {dark ? '☀️' : '🌙'}
    </button>
  );
}

export default function Navbar() {
  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-10 dark:bg-gray-900 dark:border-gray-800">
      <div className="max-w-6xl mx-auto px-4 flex items-center gap-6 h-14">
        <span className="font-bold text-blue-600 text-lg tracking-tight dark:text-blue-400">🏋️ WorkoutTracker</span>
        <div className="flex gap-1 ml-4 overflow-x-auto">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
                }`
              }
            >
              <span className="mr-1">{l.icon}</span>
              {l.label}
            </NavLink>
          ))}
        </div>
        <ThemeToggle />
      </div>
    </nav>
  );
}
