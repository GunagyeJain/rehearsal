import { InlineNotice } from '../components';

interface PlannedNoticeProps {
  phase: number;
  children: string;
}

/** Marks a placeholder screen with the build phase that fills it in. */
export function PlannedNotice({ phase, children }: PlannedNoticeProps) {
  return (
    <InlineNotice tone="info" title={`Arrives in phase ${phase}`}>
      {children}
    </InlineNotice>
  );
}
