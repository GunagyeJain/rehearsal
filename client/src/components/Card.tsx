import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import styles from './Card.module.css';

export type CardTone = 'raised' | 'sunken' | 'outline';

interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'aside' | 'li';
  tone?: CardTone;
  padding?: 'md' | 'lg';
  children: ReactNode;
}

export function Card({ as: Element = 'div', tone = 'raised', padding = 'md', className, children, ...rest }: CardProps) {
  return (
    <Element className={cx(styles.card, styles[tone], styles[padding], className)} {...rest}>
      {children}
    </Element>
  );
}

interface CardHeaderProps {
  eyebrow?: string;
  title: string;
  /** Heading level inside the page outline. */
  level?: 2 | 3;
  aside?: ReactNode;
  /** For aria-labelledby on the surrounding section. */
  id?: string;
}

export function CardHeader({ eyebrow, title, level = 2, aside, id }: CardHeaderProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <header className={styles.header}>
      <div>
        {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
        <Heading id={id} className={styles.title}>{title}</Heading>
      </div>
      {aside}
    </header>
  );
}
