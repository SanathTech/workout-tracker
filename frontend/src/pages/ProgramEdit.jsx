import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { getProgram } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import { useSmartBack } from '../hooks/useSmartBack';
import ProgramEditor from './program/ProgramEditor';

// The program editor as a real route (/program/new, /program/:id/edit) rather than a
// mode of the Program page, so the phone's back gesture leaves the editor instead of
// the app, and the bottom bar can hide itself per route. Saving and cancelling both go
// back to wherever the editor was opened from — Train, normally.
export default function ProgramEdit() {
  const { id: param } = useParams();
  const goBack = useSmartBack('/train');
  const isNew = !param;
  // Numeric so the key matches what Train and the editor's invalidation use.
  const id = isNew ? null : Number(param);

  const { data: program, isLoading, isError } = useQuery({
    queryKey: ['program', id],
    queryFn: () => getProgram(id),
    enabled: !isNew,
  });

  return (
    <div className="space-y-3">
      <button type="button" onClick={goBack} className="text-sm text-neutral-400 hover:text-neutral-200 inline-flex items-center min-h-11 md:min-h-0 -ml-1 pl-1">← Back</button>
      <h1 className="text-2xl font-semibold tracking-tight">{isNew ? 'New program' : 'Edit program'}</h1>
      {!isNew && isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {!isNew && isError && <p className="text-sm text-red-400">Couldn’t load that program.</p>}
      {(isNew || program) && (
        <ProgramEditor
          initial={isNew ? null : program}
          onCancel={goBack}
          onSaved={goBack}
        />
      )}
    </div>
  );
}
