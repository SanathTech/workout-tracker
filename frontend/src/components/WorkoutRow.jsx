import { Link } from 'react-router-dom';
import StatusBadge from './StatusBadge';
import { formatDay } from '../util/format';

// The one row for a logged workout, wherever a list of them appears (Train's history
// today; anything that lists sessions later). Name + status, then date · exercises ·
// program, duration on the right.
export default function WorkoutRow({ w }) {
  return (
    <Link to={`/workouts/${w.id}`} className="flex items-center justify-between py-3 group min-h-11">
      <div className="min-w-0">
        <p className="font-medium group-hover:underline text-neutral-200 truncate">
          {w.routine_name || 'Workout'}
          <StatusBadge status={w.status} className="ml-2" />
        </p>
        <p className="text-sm text-neutral-400 truncate">
          {formatDay(w.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          {w.exercise_count ? ` · ${w.exercise_count} exercises` : ''}
          {w.program_name ? ` · ${w.program_name}` : ''}
        </p>
      </div>
      {w.duration_minutes ? (
        <span className="text-xs text-neutral-400 shrink-0 ml-3 tabular-nums">{w.duration_minutes} min</span>
      ) : null}
    </Link>
  );
}
