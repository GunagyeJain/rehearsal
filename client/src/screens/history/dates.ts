const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** "23 Nov 2026, 14:05" in the viewer's locale. */
export function formatAttemptDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${DATE_FORMAT.format(date)}, ${TIME_FORMAT.format(date)}`;
}
