// Structured error fields for the canonical log line (CONVENTIONS.md §18): `err_type` is
// the exception class (or a short stable code), `err_msg` is the message — never a raw
// Error object (which pino would otherwise serialize with a full stack trace) and never a
// raw third-party response body. One helper so every catch site produces the same shape
// instead of each of the fleet's ~9 messageless call sites reinventing it slightly
// differently.
export function errFields(err: unknown): { err_type: string; err_msg: string } {
  if (err instanceof Error) {
    return { err_type: err.constructor.name, err_msg: err.message };
  }
  return { err_type: 'UnknownError', err_msg: String(err) };
}
