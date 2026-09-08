import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getActiveProgram, getPrograms, getProgram, getWorkouts } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import { Page, Section } from '../components/ui';
import { DayRow, useWeek } from '../components/WeekPlan';
import WorkoutRow from '../components/WorkoutRow';
import ProgramView from './program/ProgramView';

// The plan and the record. Program and History were two screens under a More tab until
// the 2026-09-08 redesign (PR 4); they answer the same question — what am I doing, what
// have I done — so they share this one, with the week's rows on top (they were on Today
// until PR 3 folded them into a strip). Exercises is a link: the library is a picker
// with a management mode, not a destination.
//
// Telemetry justified the slot (CLAUDE.md invariant): over 30 days Program + Exercises +
// History + More drew 43 visits to Lifts' 25, so Train sits third and Lifts fourth.

const PAGE = 20;

function ThisWeek() {
  const { data, isLoading, isError } = useWeek();
  if (isLoading) {
    return (
      <div className="divide-y divide-neutral-800">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="py-2 flex gap-3">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-40" />
          </div>
        ))}
      </div>
    );
  }
  if (isError || !data) return <p className="text-sm text-red-400">Couldn’t load the week.</p>;
  return (
    <div className="divide-y divide-neutral-800">
      {data.days.map((d) => <DayRow key={d.date} day={d} />)}
    </div>
  );
}

function ProgramBlock() {
  const [viewingId, setViewingId] = useState(null);
  const { data: active, isLoading: activeLoading } = useQuery({ queryKey: ['active-program'], queryFn: getActiveProgram });
  const { data: allPrograms = [], isLoading: allLoading } = useQuery({ queryKey: ['programs'], queryFn: getPrograms });
  const { data: selected } = useQuery({
    queryKey: ['program', viewingId],
    queryFn: () => getProgram(viewingId),
    enabled: !!viewingId,
  });

  useEffect(() => {
    if (viewingId) return;
    if (active?.id) setViewingId(active.id);
    else if (allPrograms.length) setViewingId(allPrograms[0].id);
  }, [active, allPrograms, viewingId]);

  const resolving = activeLoading || allLoading;
  const none = !resolving && allPrograms.length === 0;
  // Show the program the user picked. While a newly-picked one is still loading, show a
  // skeleton rather than the active program (which would flash the wrong one). The
  // active program's live progress is merged in — /programs/:id doesn't carry it.
  const displayed = (() => {
    if (!viewingId) return active;
    if (selected) return active && selected.id === active.id ? { ...selected, progress: active.progress } : selected;
    return viewingId === active?.id ? active : undefined;
  })();

  if (none) {
    return (
      <div>
        <p className="font-semibold">No programs yet</p>
        <p className="text-sm text-neutral-400 mt-1">Create one to get started.</p>
        <Link to="/program/new" className="btn-primary mt-4 inline-flex">Create your first program</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {allPrograms.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {allPrograms.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setViewingId(p.id)}
              className={viewingId === p.id ? 'chip-solid' : 'chip'}
            >
              {p.name}{p.status === 'active' ? ' · active' : ''}
            </button>
          ))}
        </div>
      )}
      {displayed
        ? <ProgramView program={displayed} onDeleted={() => setViewingId(null)} />
        : <ProgramSkeleton />}
    </div>
  );
}

function ProgramSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-3 w-40" />
      </div>
      <Skeleton className="h-11 w-full" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2 pt-3 border-t border-neutral-800">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

function HistoryBlock() {
  // Offset paging so history is unbounded (the backend clamps `limit` to 200).
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['workouts-history', PAGE],
    queryFn: ({ pageParam }) => getWorkouts({ limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.length === PAGE ? allPages.length * PAGE : undefined),
    staleTime: 60_000,
  });
  const items = data?.pages.flat() ?? [];

  if (isLoading) {
    return (
      <div className="divide-y divide-neutral-800">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="py-3 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        ))}
      </div>
    );
  }
  if (items.length === 0) return <p className="text-sm text-neutral-400 py-2">No workouts logged yet.</p>;
  return (
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
  );
}

export default function Train() {
  return (
    <Page>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Train</h1>
        <Link to="/exercises" className="text-sm text-neutral-400 hover:text-neutral-200 min-h-11 md:min-h-0 inline-flex items-center">
          Exercises ›
        </Link>
      </div>

      <Section label="This week"><ThisWeek /></Section>
      <Section label="Program"><ProgramBlock /></Section>
      <Section label="History"><HistoryBlock /></Section>
    </Page>
  );
}
