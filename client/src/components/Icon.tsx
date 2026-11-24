import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';
import styles from './Icon.module.css';

/** Stroke width fixed by spec/design.md. */
const ICON_STROKE = 1.75;

export type IconSize = 'sm' | 'md' | 'lg';

interface IconProps {
  icon: LucideIcon;
  /** md is the 20px default for --size-md contexts. */
  size?: IconSize;
  /** When given, the icon is announced. Otherwise it is decorative. */
  label?: string;
  className?: string;
}

/** The only way to render a lucide icon: 20px, stroke 1.75, currentColor. */
export function Icon({ icon: Glyph, size = 'md', label, className }: IconProps) {
  return (
    <Glyph
      className={cx(styles.icon, styles[size], className)}
      strokeWidth={ICON_STROKE}
      absoluteStrokeWidth={false}
      color="currentColor"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable={false}
    />
  );
}
