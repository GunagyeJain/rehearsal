import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';
import { Icon } from './Icon';
import { Spinner } from './Spinner';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, keeps the label and width, and blocks clicks. */
  loading?: boolean;
  icon?: LucideIcon;
  iconPosition?: 'start' | 'end';
  fullWidth?: boolean;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    iconPosition = 'start',
    fullWidth = false,
    disabled,
    className,
    type = 'button',
    children,
    ...rest
  },
  ref,
) {
  const glyph = loading ? (
    <Spinner size="sm" label="Working" />
  ) : icon ? (
    <Icon icon={icon} size={size === 'sm' ? 'sm' : 'md'} />
  ) : null;

  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        styles.button,
        styles[variant],
        styles[size],
        fullWidth && styles.fullWidth,
        loading && styles.loading,
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {iconPosition === 'start' && glyph}
      <span className={styles.label}>{children}</span>
      {iconPosition === 'end' && glyph}
    </button>
  );
});
