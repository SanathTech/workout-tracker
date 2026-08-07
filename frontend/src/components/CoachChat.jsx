import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCoachMessages, sendCoachMessage } from '../api/client';

// The chat shares one thread with the scheduled calls — the server puts recent
// coach_advice into the context — so asking "why did you say that this morning?" works
// and the coach can be held to its own call.
//
// Not streamed. The backend is Express on Vercel with the legacy `builds` config that
// CLAUDE.md says not to modernise, and streaming through it is the kind of change that
// breaks a working deploy for a cosmetic gain. Haiku answers in a couple of seconds.
export default function CoachChat() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const endRef = useRef(null);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['coach-messages'],
    queryFn: () => getCoachMessages({ limit: 50 }),
    staleTime: 60_000,
  });

  const send = useMutation({
    mutationFn: sendCoachMessage,
    // The question is echoed locally the moment it's sent — a chat that shows nothing
    // for three seconds reads as broken. The server is the source of truth for both
    // turns, so the refetch replaces this.
    onMutate: async (text) => {
      await qc.cancelQueries({ queryKey: ['coach-messages'] });
      const previous = qc.getQueryData(['coach-messages']);
      qc.setQueryData(['coach-messages'], (old) => [
        ...(old || []),
        { id: `pending-${Date.now()}`, role: 'user', content: text, pending: true },
      ]);
      return { previous };
    },
    onError: (_e, _t, ctx) => qc.setQueryData(['coach-messages'], ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: ['coach-messages'] }),
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length, send.isPending]);

  const submit = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || send.isPending) return;
    setDraft('');
    send.mutate(text);
  };

  // The server returns its own message for a budget stop or an unconfigured key; those
  // are worth showing verbatim rather than replacing with "something went wrong".
  const errorText =
    send.error?.response?.data?.error ||
    (send.isError ? 'Couldn’t reach the coach — check your connection.' : null);

  return (
    <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
      <h2 className="section-label mb-2">Ask the coach</h2>

      {isLoading ? (
        <div className="h-16" />
      ) : messages.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-2">
          It has this morning’s call, your last two weeks of training, and last night’s
          sleep. Ask it something.
        </p>
      ) : (
        <div className="space-y-3 mb-3 max-h-96 overflow-y-auto">
          {messages.map((m) => (
            <div
              key={m.id}
              className={m.role === 'user' ? 'pl-6 md:pl-16' : 'pr-6 md:pr-16'}
            >
              <div
                className={`text-sm whitespace-pre-wrap rounded-lg px-3 py-2 ${
                  m.role === 'user'
                    ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-neutral-950 ml-auto w-fit'
                    : 'bg-neutral-100 text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200'
                } ${m.pending ? 'opacity-60' : ''}`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {send.isPending && (
            <div className="pr-6 md:pr-16">
              <div className="text-sm rounded-lg px-3 py-2 bg-neutral-100 dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400">
                Thinking…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Should I swim or lift tonight?"
          maxLength={4000}
          disabled={send.isPending}
          className="input flex-1 py-1.5"
          aria-label="Message the coach"
        />
        <button
          type="submit"
          disabled={!draft.trim() || send.isPending}
          className="btn-secondary px-4"
        >
          Ask
        </button>
      </form>

      {errorText && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errorText}</p>}
    </section>
  );
}
