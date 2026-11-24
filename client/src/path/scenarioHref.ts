/** Where a path row opens a scenario: setup, which forwards to the brief when there is nothing to set up. */
export function scenarioHref(scenarioId: string): string {
  return `/scenarios/${encodeURIComponent(scenarioId)}/setup`;
}
