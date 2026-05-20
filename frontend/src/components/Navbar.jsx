import { NavLink } from 'react-router-dom';

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: '📊' },
  { to: '/log', label: 'Log Workout', icon: '💪' },
  { to: '/plans', label: 'Plans', icon: '📋' },
  { to: '/progress', label: 'Progress', icon: '📈' },
  { to: '/exercises', label: 'Exercises', icon: '🏋️' },
];

export default function Navbar() {
  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 flex items-center gap-6 h-14">
        <span className="font-bold text-blue-600 text-lg tracking-tight">🏋️ WorkoutTracker</span>
        <div className="flex gap-1 ml-4 overflow-x-auto">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              <span className="mr-1">{l.icon}</span>
              {l.label}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
}
