// Logs the real error server-side and returns a generic message to the client,
// so internal details (SQL, stack traces) never leak in API responses.
function serverError(res, err) {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { serverError };
