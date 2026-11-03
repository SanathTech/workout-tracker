import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { getProgram, startProgram } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import { Page } from '../components/ui';
import { useSmartBack } from '../hooks/useSmartBack';
import ProgramEditor from './program/ProgramEditor';

// The program editor as a real route (/program/new, /program/:id/edit) rather than a
// mode of the Program page, so the phone's back gesture leaves the editor instead of
// the app, and the bottom bar can hide itself per route. Saving and cancelling both go
// back to wherever the editor was opened from — Home, normally. A new program starts on
// save: there is no program list any more to start it from.
export default function ProgramEdit() {
  const { id: param } = useParams();
  const qc = useQueryClient();
  const goBack = useSmartBack('/');
  // A new program is saved, then started. If the start fails, stay here with a retry that
  // only starts it — saving again would create a duplicate — because nothing else in the
  // app can start a program now.
  const [unstarted, setUnstarted] = useState(null);
  const [starting, setStarting] = useState(false);
  const start = async (id) => {
    setStarting(true);
    try {
      await startProgram(id);
      qc.invalidateQueries({ queryKey: ['active-program'] });
      setUnstarted(null);
      goBack();
    } catch {
      setUnstarted(id);
    } finally {
      setStarting(false);
    }
  };
  const isNew = !param;
  // Numeric so the key matches what Train and the editor's invalidation use.
  const id = isNew ? null : Number(param);
  const validId = isNew || Number.isInteger(id);

  const { data: program, isLoading, isError } = useQuery({
    queryKey: ['program', id],
    queryFn: () => getProgram(id),
    enabled: !isNew && validId,
  });

  return (
    <Page>
      <button type="button" onClick={goBack} className="text-sm text-neutral-400 hover:text-neutral-200 inline-flex items-center min-h-11 md:min-h-0 -ml-1 pl-1">← Back</button>
      <h1 className="text-2xl font-semibold tracking-tight">{isNew ? 'Set up routines' : 'Edit routines'}</h1>
      {!isNew && isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {!isNew && (isError || !validId) && <p className="text-sm text-red-400">Couldn’t load that program.</p>}
      {unstarted != null ? (
        <div className="space-y-3">
          <p className="text-sm text-red-400" role="alert">Saved, but couldn’t make it active — check your connection.</p>
          <button type="button" onClick={() => start(unstarted)} disabled={starting} className="btn-primary">
            {starting ? 'Trying…' : 'Try again'}
          </button>
        </div>
      ) : (isNew || program) && (
        <ProgramEditor
          initial={isNew ? null : program}
          onCancel={goBack}
          onSaved={(saved) => (isNew ? start(saved.id) : goBack())}
        />
      )}
    </Page>
  );
}
