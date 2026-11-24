import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '../../components';
import type { ScenarioLoad } from './useScenario';

interface ScenarioLoadStatesProps {
  load: Exclude<ScenarioLoad, { status: 'ready' }>;
  onRetry: () => void;
}

/** Loading and error states shared by the setup and brief screens. */
export function ScenarioLoadStates({ load, onRetry }: ScenarioLoadStatesProps) {
  if (load.status === 'loading') return <LoadingState message="Loading the scenario" />;
  if (load.notFound) {
    return (
      <EmptyState
        icon={Compass}
        title="This scenario does not exist."
        body={
          <>
            Pick another one from <Link to="/">your list</Link>.
          </>
        }
      />
    );
  }
  return <ErrorState title="The scenario could not load." message={load.message} onRetry={onRetry} />;
}
