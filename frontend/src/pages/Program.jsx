import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getActiveProgram, getPrograms, getProgram } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import ProgramEditor from './program/ProgramEditor';
import ProgramView from './program/ProgramView';

export default function Program() {
  const [editing, setEditing] = useState(null);
  const [viewingId, setViewingId] = useState(null);

  const { data: active, isLoading: activeLoading } = useQuery({
    queryKey: ['active-program'],
    queryFn: getActiveProgram,
  });
  const { data: allPrograms = [], isLoading: allLoading } = useQuery({
    queryKey: ['programs'],
    queryFn: getPrograms,
  });
  const { data: selected } = useQuery({
    queryKey: ['program', viewingId],
    queryFn: () => getProgram(viewingId),
    enabled: !!viewingId,
  });

  useEffect(() => {
    if (viewingId || editing) return;
    if (active?.id) {
      setViewingId(active.id);
    } else if (allPrograms.length) {
      setViewingId(allPrograms[0].id);
    }
  }, [active, allPrograms, viewingId, editing]);

  if (editing) {
    return (
      <div className="space-y-3">
        <button onClick={() => setEditing(null)} className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 inline-flex items-center min-h-11 md:min-h-0 -ml-1 pl-1">← Back</button>
        <h1 className="text-2xl font-semibold tracking-tight">{editing === 'new' ? 'New program' : 'Edit program'}</h1>
        <ProgramEditor
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={(p) => { setEditing(null); setViewingId(p.id); }}
        />
      </div>
    );
  }

  const stillResolving = activeLoading || allLoading;
  const noPrograms = !stillResolving && allPrograms.length === 0;
  // Show the program the user selected. While a newly-selected program is still
  // loading, show a skeleton rather than falling back to the active program
  // (which would flash the wrong program). Merge live progress for the active one.
  const displayed = (() => {
    if (!viewingId) return active;
    if (selected) {
      return active && selected.id === active.id ? { ...selected, progress: active.progress } : selected;
    }
    return viewingId === active?.id ? active : undefined;
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Program</h1>
        <button onClick={() => setEditing('new')} className="btn-primary">New program</button>
      </div>

      {noPrograms && (
        <div className="card">
          <p className="font-semibold">No programs yet</p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">Create one to get started.</p>
          <button onClick={() => setEditing('new')} className="btn-primary mt-4">Create your first program</button>
        </div>
      )}

      {allPrograms.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {allPrograms.map((p) => (
            <button
              key={p.id}
              onClick={() => setViewingId(p.id)}
              className={
                (viewingId === p.id)
                  ? 'badge-solid cursor-pointer'
                  : 'badge cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-100'
              }
            >
              {p.name}{p.status === 'active' ? ' · active' : ''}
            </button>
          ))}
        </div>
      )}

      {displayed && <ProgramView program={displayed} onEdit={() => setEditing(displayed)} onDeleted={() => setViewingId(null)} />}
      {!displayed && !noPrograms && <ProgramSkeleton />}
    </div>
  );
}

function ProgramSkeleton() {
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-11 w-full" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-3 w-44" />
        </div>
      ))}
    </div>
  );
}
