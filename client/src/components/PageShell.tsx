import { useEffect, useRef, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Compass, History, Route, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';
import { Icon } from './Icon';
import styles from './PageShell.module.css';

const APP_NAME = 'Rehearsal';

/** Path of the last screen shell that mounted. Null until the first screen, so page load keeps native focus. */
let lastShellPath: string | null = null;

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Path', icon: Route },
  { to: '/explore', label: 'Explore', icon: Compass },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Wordmark() {
  return (
    <Link to="/" className={styles.wordmark} aria-label={`${APP_NAME}, home`}>
      <span className={styles.mark} aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      <span>{APP_NAME}</span>
    </Link>
  );
}

/** The default app header: wordmark and the four destinations. */
export function AppHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Wordmark />
        <nav aria-label="Main">
          <ul role="list" className={styles.nav}>
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => cx(styles.navLink, isActive && styles.navLinkActive)}
                >
                  <Icon icon={item.icon} size="sm" />
                  <span className={styles.navLabel}>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}

export type ShellHeader = 'app' | 'minimal' | 'none';

interface PageShellProps {
  /** Page heading and document title. */
  title: string;
  /** Hide the visible heading when the page draws its own, keeping the document title. */
  hideTitle?: boolean;
  /** Small label above the title. */
  eyebrow?: string;
  /** One or two sentences under the title. */
  lead?: ReactNode;
  /** Right-aligned with the title, e.g. a progress count. */
  aside?: ReactNode;
  /** 'app' full header, 'minimal' wordmark only, 'none' for chrome-free screens. */
  header?: ShellHeader;
  /** Replaces the default header entirely. */
  headerSlot?: ReactNode;
  footer?: ReactNode;
  /** 'full' is edge to edge with no padding, for the live screen. */
  width?: 'reading' | 'wide' | 'full';
  /** Content sits in the vertical middle, for single-card screens such as auth. */
  centered?: boolean;
  children?: ReactNode;
}

/** Layout for reading screens: 42rem measure, header and footer slots, one h1. */
export function PageShell({
  title,
  hideTitle = false,
  eyebrow,
  lead,
  aside,
  header = 'app',
  headerSlot,
  footer,
  width = 'reading',
  centered = false,
  children,
}: PageShellProps) {
  const mainRef = useRef<HTMLElement>(null);

  // A client-side navigation does not move focus on its own, so a keyboard or screen reader user
  // would stay on a link that no longer exists. Land on the new screen instead.
  useEffect(() => {
    const path = window.location.pathname;
    if (lastShellPath !== null && lastShellPath !== path) mainRef.current?.focus({ preventScroll: true });
    lastShellPath = path;
  }, []);

  useEffect(() => {
    document.title = title === APP_NAME ? APP_NAME : `${title} · ${APP_NAME}`;
  }, [title]);

  const headerNode =
    headerSlot ??
    (header === 'app' ? (
      <AppHeader />
    ) : header === 'minimal' ? (
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Wordmark />
        </div>
      </header>
    ) : null);

  return (
    <div className={styles.shell}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      {headerNode}
      <main id="main" ref={mainRef} className={cx(styles.main, styles[width], centered && styles.centered)} tabIndex={-1}>
        <div className={hideTitle ? 'visually-hidden' : styles.titleBlock}>
          <div className={styles.titleText}>
            {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
            <h1 className={styles.title}>{title}</h1>
            {lead && <div className={styles.lead}>{lead}</div>}
          </div>
          {aside && <div className={styles.aside}>{aside}</div>}
        </div>
        {children}
      </main>
      {footer && (
        <footer className={styles.footer}>
          <div className={cx(styles.footerInner, styles[width])}>{footer}</div>
        </footer>
      )}
    </div>
  );
}
