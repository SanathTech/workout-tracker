import { useInfiniteQuery } from '@tanstack/react-query';
import { getWorkouts } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import { Page } from '../components/ui';
import WorkoutRow from '../components/WorkoutRow';

// Past sessions, newest first. Completed only: a skip logged nothing, and an open
// session lives on Home.
const PAGE = 20;

export default function History() {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['workouts-history', 'completed', PAGE],
    queryFn: ({ pageParam }) => getWorkouts({ status: 'completed', limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.length === PAGE ? allPages.length * PAGE : undefined),
    staleTime: 60_000,
  });
  const items = data?.pages.flat() ?? [];

  return (
    <Page>
      <h1 className="text-2xl font-semibold tracking-tight">History</h1>
      {isLoading ? (
        <div className="divide-y divide-neutral-800">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="py-3 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-400 py-2">No workouts logged yet.</p>
      ) : (
        <div className="space-y-4">
          <div className="divide-y divide-neutral-800">
            {items.map((w) => <WorkoutRow key={w.id} w={w} />)}
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
      )}
    </Page>
  );
}
