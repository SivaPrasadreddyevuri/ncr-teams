'use client';

import { useState } from 'react';
import { Check, User, Bell, Palette, Shield } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { initials } from '@/lib/format';
import { currentUser, type Person } from '@/lib/data';

type Tab = 'profile' | 'notifications' | 'appearance' | 'security';

const TABS: Array<{ id: Tab; label: string; icon: typeof User }> = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'security', label: 'Security', icon: Shield },
];

export function SettingsPanel() {
  const [tab, setTab] = useState<Tab>('profile');
  const [profile, setProfile] = useState<Person>(currentUser);
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
            <div className="settings-identity">
              <Avatar initials={initials(profile.name)} size="lg" online={profile.online} />
              <div>
                <strong>{profile.name}</strong>
                <small>{profile.email}</small>
              </div>
            </div>

            <div className="settings-body">
              <div className="form-field">
                <label htmlFor="s-name">Full name</label>
                <input
                  id="s-name"
                  className="table-input"
                  value={profile.name}
                  onChange={(event) => setProfile({ ...profile, name: event.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="s-title">Job title</label>
                <input
                  id="s-title"
                  className="table-input"
                  value={profile.jobTitle ?? ''}
                  onChange={(event) => setProfile({ ...profile, jobTitle: event.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="s-dept">Department</label>
                <input
                  id="s-dept"
                  className="table-input"
                  value={profile.department ?? ''}
                  onChange={(event) => setProfile({ ...profile, department: event.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="s-email">Email</label>
                <input
                  id="s-email"
                  type="email"
                  className="table-input"
                  value={profile.email}
                  onChange={(event) => setProfile({ ...profile, email: event.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="s-phone">Phone</label>
                <input
                  id="s-phone"
                  className="table-input"
                  value={profile.phone}
                  onChange={(event) => setProfile({ ...profile, phone: event.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="s-bio">Bio</label>
                <textarea
                  id="s-bio"
                  className="table-input"
                  rows={3}
                  value={profile.bio}
                  onChange={(event) => setProfile({ ...profile, bio: event.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button className="join" type="submit">
                  Save changes
                </button>
                {saved && (
                  <span className="chip active">
                    <Check size={11} /> Updated in this session
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
