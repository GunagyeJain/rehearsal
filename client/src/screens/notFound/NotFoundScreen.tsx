import { useNavigate } from 'react-router-dom';
import { MapPinOff } from 'lucide-react';
import { Button, EmptyState, PageShell } from '../../components';

export function NotFoundScreen() {
  const navigate = useNavigate();
  return (
    <PageShell title="Page not found" hideTitle>
      <EmptyState
        icon={MapPinOff}
        title="There is nothing at this address."
        body="The link may be out of date. Your path is one tap away."
        action={<Button onClick={() => navigate('/')}>Go to your path</Button>}
      />
    </PageShell>
  );
}
