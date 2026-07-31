// The workout `date` column is a plain DATE — it means "the calendar day you trained",
// which is a local-time question. Vercel runs in UTC, so deriving it from the server
// clock dates every pre-10am Melbourne session to the previous day. The client sends
// its own local date; these helpers validate it and provide a correct fallback.

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Australia/Melbourne';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// 'en-CA' formats as YYYY-MM-DD, which is the format the column wants.
function todayInAppTimezone() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Accepts a client-supplied YYYY-MM-DD, rejecting anything malformed or not a real
// calendar day (so '2026-02-31' doesn't reach Postgres).
function isValidDateString(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function resolveWorkoutDate(clientDate) {
  return isValidDateString(clientDate) ? clientDate : todayInAppTimezone();
}

module.exports = { APP_TIMEZONE, todayInAppTimezone, isValidDateString, resolveWorkoutDate };
