'use client';

import { useState } from 'react';
import { Check, User, Bell, Palette, Shield } from 'lucide-react';
import { AvatarPicker } from '@/components/profile/AvatarPicker';
import { useProfile } from '@/components/profile/ProfileProvider';
import { type Person } from '@/lib/data';

type Tab = 'profile' | 'notifications' | 'appearance' | 'security';

const TABS: Array<{ id: Tab; label: string; icon: typeof User }> = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'security', label: 'Security', icon: Shield },
];

export function SettingsPanel() {
  const [tab, setTab] = useState<Tab>('profile');
  // The form edits the shared profile rather than a local copy, so a changed
  // name reaches the sidebar and topbar instead of stopping at this panel.
  const { profile, setProfile } = useProfile();
  const [saved, setSaved] = useState(false);

  const [notifications, setNotifications] = useState({
    mentions: true,
    messages: true,
    meetings: true,
    email: false,
  });

  const [density, setDensity] = useState('comfortable');
  const [theme, setTheme] = useState('system');

  function save(event: React.FormEvent) {
    event.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function edit(patch: Partial<Person>) {
    setProfile(patch);
  }

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings sections">
        {TABS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={tab === option.id ? 'active' : ''}
            aria-current={tab === option.id ? 'page' : undefined}
            onClick={() => setTab(option.id)}
          >
            <option.icon size={16} />
            {option.label}
          </button>
        ))}
      </nav>

      <div className="panel settings-panel">
        {tab === 'profile' && (
          <form onSubmit={save}>
            <AvatarPicker />

            <div className="settings-body">
              <div className="form-field">
                <label htmlFor="s-name">Full name</label>
                <input
                  id="s-name"
                  className="table-input"
                  value={profile.name}
                  onChange={(event) => edit({ name: event.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="s-title">Job title</label>
                <input
                  id="s-title"
                  className="table-input"
                  value={profile.jobTitle ?? ''}
                  onChange={(event) => edit({ jobTitle: event.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="s-dept">Department</label>
                <input
                  id="s-dept"
                  className="table-input"
                  value={profile.department ?? ''}
                  onChange={(event) => edit({ department: event.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="s-email">Email</label>
                <input
                  id="s-email"
                  type="email"
                  className="table-input"
                  value={profile.email}
                  onChange={(event) => edit({ email: event.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="s-phone">Phone</label>
                <input
                  id="s-phone"
                  className="table-input"
                  value={profile.phone}
                  onChange={(event) => edit({ phone: event.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="s-bio">Bio</label>
                <textarea
                  id="s-bio"
                  className="table-input"
                  rows={3}
                  value={profile.bio}
                  onChange={(event) => edit({ bio: event.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button className="join" type="submit">
                  Save changes
                </button>
                {saved && (
                  <span className="chip active">
                    <Check size={11} /> Saved in this browser
                  </span>
                )}
              </div>
            </div>
          </form>
        )}

        {tab === 'notifications' && (
          <div className="settings-body">
            {(
              [
                ['mentions', 'Mentions and direct messages'],
                ['messages', 'New channel activity'],
                ['meetings', 'Meeting reminders'],
                ['email', 'Weekly email digest'],
              ] as const
            ).map(([key, label]) => (
              <label className="settings-row" key={key}>
                <span>
                  <strong>{label}</strong>
                  <small>This browser only</small>
                </span>
                <input
                  type="checkbox"
                  checked={notifications[key]}
                  onChange={(event) =>
                    setNotifications({ ...notifications, [key]: event.target.checked })
                  }
                />
              </label>
            ))}
          </div>
        )}

        {tab === 'appearance' && (
          <div className="settings-body">
            <div className="form-field">
              <label htmlFor="a-density">Density</label>
              <select
                id="a-density"
                className="table-input"
                value={density}
                onChange={(event) => setDensity(event.target.value)}
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="a-theme">Theme</label>
              <select
                id="a-theme"
                className="table-input"
                value={theme}
                onChange={(event) => setTheme(event.target.value)}
              >
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>

            <small style={{ color: 'var(--muted)' }}>
              These controls are visual only in the prototype.
            </small>
          </div>
        )}

        {tab === 'security' && (
          <div className="settings-body">
            <div className="settings-row">
              <span>
                <strong>Two-factor authentication</strong>
                <small>Set up on the security screen</small>
              </span>
              <span className="chip">Off</span>
            </div>

            <small style={{ color: 'var(--muted)' }}>
              Password, sessions and two-factor are mocked in this build &mdash; nothing is verified
              or stored.
            </small>
          </div>
        )}
      </div>
    </div>
  );
}
