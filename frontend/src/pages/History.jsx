import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getWorkouts } from '../api/client';
import { Skeleton } from '../components/Skeleton';

const PAGE = 50;

function Row({ w }) {
  return (
    <Link to={`/workouts/${w.id}`} className="flex items-center justify-between py-3 group">
      <div className="min-w-0">
        <p className="font-medium group-hover:underline text-neutral-900 dark:text-neutral-100 truncate">
          {w.routine_name || 'Workout'}
          {w.status === 'in_progress' && (
            <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-500">in progress</span>
          )}
        </p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 truncate">
          {new Date(w.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          {w.exercise_count ? ` · ${w.exercise_count} exercises` : ''}
          {w.program_name ? ` · ${w.program_name}` : ''}
        </p>
      </div>
      {w.duration_minutes ? (
        <span className="text-xs text-neutral-500 dark:text-neutral-400 shrink-0 ml-3">{w.duration_minutes} min</span>
      ) : null}
    </Link>
  );
}

export default function History() {
  // Offset-based paging so history is unbounded (the backend clamps `limit` to 200).
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['workouts-history'],
    queryFn: ({ pageParam }) => getWorkouts({ limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE ? allPages.length * PAGE : undefined,
    staleTime: 60_000,
  });
  const items = data?.pages.flat() ?? [];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link to="/dashboard" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">← Back</Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Workout history</h1>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="py-3 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-neutral-500 py-4">No workouts logged yet.</p>
        ) : (
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {items.map((w) => <Row key={w.id} w={w} />)}
          </div>
        )}
      </div>

      {hasNextPage && (
        <button
          type="button"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="btn-secondary w-full justify-center"
        >
          {isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
