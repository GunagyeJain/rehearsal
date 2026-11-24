/** Client routes. One folder per screen under src/screens. */
export const ROUTES = {
  home: '/',
  auth: '/auth',
  onboarding: '/onboarding',
  scenarioSetup: '/scenarios/:scenarioId/setup',
  scenarioBrief: '/scenarios/:scenarioId/brief',
  scenarioLive: '/scenarios/:scenarioId/live',
  report: '/attempts/:attemptId',
  explore: '/explore',
  history: '/history',
  settings: '/settings',
  design: '/design',
} as const;
