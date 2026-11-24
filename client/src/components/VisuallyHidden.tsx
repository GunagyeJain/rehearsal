import type { ReactNode } from 'react';

interface VisuallyHiddenProps {
  children: ReactNode;
}

/** Text for assistive technology only. */
export function VisuallyHidden({ children }: VisuallyHiddenProps) {
  return <span className="visually-hidden">{children}</span>;
}
