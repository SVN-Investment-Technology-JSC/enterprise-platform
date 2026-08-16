import type { ReactNode } from 'react';
import styles from './platform-shell.module.css';

export function PlatformShell(props: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  actor?: string;
  children: ReactNode;
}) {
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div><span>{props.eyebrow}</span><h1>{props.title}</h1>{props.subtitle ? <p>{props.subtitle}</p> : null}</div>
        {props.actor ? <strong className={styles.actor}>{props.actor}</strong> : null}
      </header>
      <section className={styles.content}>{props.children}</section>
    </main>
  );
}

export function ModuleCard(props: {
  name: string;
  description: string;
  status?: string;
  href: string;
  icon?: string;
}) {
  return (
    <a className={styles.card} href={props.href}>
      <span className={styles.icon}>{props.icon ?? '◈'}</span>
      <div><small>{props.status ?? 'active'}</small><h2>{props.name}</h2><p>{props.description}</p></div>
      <strong>Truy cập →</strong>
    </a>
  );
}

export function CardGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}
