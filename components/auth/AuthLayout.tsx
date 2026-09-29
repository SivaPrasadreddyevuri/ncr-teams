import Link from 'next/link';
import {
  MessageCircle,
  Video,
  Users,
  FolderOpen,
  CalendarDays,
  ShieldCheck,
} from 'lucide-react';
import { Logo } from '@/components/Logo';

const features = [
  { label: 'Chat', detail: 'Messages', icon: MessageCircle },
  { label: 'Meetings', detail: 'Video & audio', icon: Video },
  { label: 'Teams', detail: 'Collaboration', icon: Users },
  { label: 'Files', detail: 'Shared securely', icon: FolderOpen },
  { label: 'Calendar', detail: 'Events & more', icon: CalendarDays },
];

export function AuthLayout({
  title,
  subtitle,
  children,
  header,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  /** Rendered between the subtitle and the form, e.g. the activation stepper. */
  header?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="auth-split">
      {/* Brand / marketing panel. Hidden on narrow screens where it would
          just push the form below the fold. */}
      <aside className="auth-split-brand">
        <div className="auth-split-brand-inner">
          <Logo />

          <h2 className="auth-caption">
            Connect People
            <br />
            <span className="auth-caption-accent">Empower Teams</span>
            <br />
            Achieve More
          </h2>

          <p className="auth-tagline">
            A modern workspace for team communication, meetings, files and more
            &mdash; all in one place.
          </p>

          <ul className="auth-features">
            {features.map((feature) => (
              <li key={feature.label}>
                <span className="auth-feature-icon">
                  <feature.icon size={17} />
                </span>
                <span>
                  <strong>{feature.label}</strong>
                  <small>{feature.detail}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Form panel */}
      <main className="auth-split-form">
        <div className="auth-card">
          {/* The logo belongs to the left panel on desktop, so it is hidden
              here and shown in its place on narrow screens. */}
          <div className="auth-mobile-brand">
            <Logo />
          </div>

          <h1>{title}</h1>
          <p className="auth-subtitle">{subtitle}</p>

          {header}

          {children}

          {footer}

          <p className="auth-security">
            <ShieldCheck size={13} />
            Interface preview &mdash; no credentials are transmitted or stored
          </p>
        </div>

        <p className="auth-legal">
          NCR Teams &middot; Need help? <Link href="/login">Contact your administrator</Link>
        </p>
      </main>
    </div>
  );
}
