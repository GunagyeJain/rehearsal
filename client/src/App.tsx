import { lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { LoadingState, RouteFallback } from './components';
import { AuthProvider } from './auth/AuthProvider';
import { AccountThemeProvider } from './auth/AccountThemeProvider';
import { RequireAuth, type OnboardingRule } from './auth/RequireAuth';
import { ROUTES } from './routes';

/**
 * Route-level code splitting: each screen is its own chunk, fetched on first visit. Screens use
 * named exports (no default exports), so the loader maps the named export onto `default`.
 */
function lazyScreen<K extends string>(
  load: () => Promise<Record<K, ComponentType>>,
  name: K,
): LazyExoticComponent<ComponentType> {
  return lazy<ComponentType>(() => load().then((m) => ({ default: m[name] })));
}

const AuthScreen = lazyScreen(() => import('./screens/auth/AuthScreen'), 'AuthScreen');
const ExploreScreen = lazyScreen(() => import('./screens/explore/ExploreScreen'), 'ExploreScreen');
const HistoryScreen = lazyScreen(() => import('./screens/history/HistoryScreen'), 'HistoryScreen');
const HomeScreen = lazyScreen(() => import('./screens/home/HomeScreen'), 'HomeScreen');
const NotFoundScreen = lazyScreen(() => import('./screens/notFound/NotFoundScreen'), 'NotFoundScreen');
const OnboardingScreen = lazyScreen(() => import('./screens/onboarding/OnboardingScreen'), 'OnboardingScreen');
const ScenarioBriefScreen = lazyScreen(() => import('./screens/scenario/ScenarioBriefScreen'), 'ScenarioBriefScreen');
const ScenarioLiveScreen = lazyScreen(() => import('./screens/scenario/ScenarioLiveScreen'), 'ScenarioLiveScreen');
const ScenarioReportScreen = lazyScreen(() => import('./screens/scenario/ScenarioReportScreen'), 'ScenarioReportScreen');
const ScenarioSetupScreen = lazyScreen(() => import('./screens/scenario/ScenarioSetupScreen'), 'ScenarioSetupScreen');
const SettingsScreen = lazyScreen(() => import('./screens/settings/SettingsScreen'), 'SettingsScreen');

/** One quiet fallback per route, so a chunk load never blanks the whole app. */
function screen(element: ReactNode): ReactNode {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

// Dev-only kitchen sink. Created inside the DEV branch so production builds drop it entirely.
function designRoutes(): RouteObject[] {
  const DesignScreen = lazy(() =>
    import('./screens/design/DesignScreen').then((m) => ({ default: m.DesignScreen })),
  );
  return [
    {
      path: ROUTES.design,
      element: (
        <Suspense fallback={<LoadingState message="Loading the design system" />}>
          <DesignScreen />
        </Suspense>
      ),
    },
  ];
}

/** Signed-in only; by default the user must also have finished onboarding (spec/screens.md). */
function protect(element: ReactNode, onboarding: OnboardingRule = 'required'): ReactNode {
  return <RequireAuth onboarding={onboarding}>{screen(element)}</RequireAuth>;
}

const routes: RouteObject[] = [
  { path: ROUTES.home, element: protect(<HomeScreen />) },
  { path: ROUTES.auth, element: screen(<AuthScreen />) },
  { path: ROUTES.onboarding, element: protect(<OnboardingScreen />, 'pending') },
  { path: ROUTES.scenarioSetup, element: protect(<ScenarioSetupScreen />) },
  { path: ROUTES.scenarioBrief, element: protect(<ScenarioBriefScreen />) },
  { path: ROUTES.scenarioLive, element: protect(<ScenarioLiveScreen />) },
  { path: ROUTES.report, element: protect(<ScenarioReportScreen />) },
  { path: ROUTES.explore, element: protect(<ExploreScreen />) },
  { path: ROUTES.history, element: protect(<HistoryScreen />) },
  // Reachable mid-onboarding so a user can always sign out or change appearance.
  { path: ROUTES.settings, element: protect(<SettingsScreen />, 'any') },
  ...(import.meta.env.DEV ? designRoutes() : []),
  { path: '*', element: screen(<NotFoundScreen />) },
];

const router = createBrowserRouter(routes);

export function App() {
  return (
    <AuthProvider>
      <AccountThemeProvider>
        <RouterProvider router={router} />
      </AccountThemeProvider>
    </AuthProvider>
  );
}
