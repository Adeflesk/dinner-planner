// One line of JSON per event, so Vercel's runtime logs stay greppable and a
// future log drain can parse them without a format change.
//
// There is no test-environment branch on purpose: tests spy on console, which
// both silences the output and lets them assert the reason code. A logger with
// a test-only silent path is a logger whose output is never verified.

type Fields = Record<string, unknown>;

function line(evt: string, fields: Fields): string {
  try {
    return JSON.stringify({ evt, ...fields });
  } catch {
    // A field that cannot be serialised must never take down a plan.
    return JSON.stringify({ evt, unserialisableFields: true });
  }
}

/** Routine, expected events. Goes to stdout. */
export function logEvent(evt: string, fields: Fields = {}): void {
  console.log(line(evt, fields));
}

/** Something went wrong and someone may need to look. Goes to stderr. */
export function logWarn(evt: string, fields: Fields = {}): void {
  console.warn(line(evt, fields));
}
