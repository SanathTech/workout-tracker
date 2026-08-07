// Push to ntfy. The topic URL lives in COACH_NTFY_URL; unset means pushes are
// silently skipped (local dev), because a coach that can't notify should still answer.

// HTTP headers are latin-1. The model writes em-dashes and curly quotes into
// headlines, and an unencoded one kills the request *after* the advice is saved and
// paid for — that exact failure ate the first production run of the Python coach.
// ntfy decodes RFC 2047, so encode rather than strip and the punctuation survives.
function headerSafe(text) {
  if ([...text].every((c) => c.charCodeAt(0) <= 0xff)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf-8').toString('base64')}?=`;
}

async function notify(title, message, { priority = 'default', tags = 'muscle' } = {}) {
  const url = process.env.COACH_NTFY_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: message,
      headers: {
        Title: headerSafe(title),
        Priority: priority,
        Tags: tags,
        Markdown: 'yes',
      },
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch (err) {
    // A failed push must never fail the run — the advice is already stored and the
    // Coach tab shows it either way.
    console.error('ntfy push failed:', err.message);
    return false;
  }
}

module.exports = { notify, headerSafe };
