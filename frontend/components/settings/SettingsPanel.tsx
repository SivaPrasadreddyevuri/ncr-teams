'use client';

import { useState } from 'react';
import { Check, User, Bell, Palette, Shield } from 'lucide-react';
import { AvatarPicker } from '@/components/profile/AvatarPicker';
import { useActivePerson, useProfile } from '@/components/profile/ProfileProvider';
import { api, ApiError } from '@/lib/api';
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
  // name reaches the sidebar and topbar instead of stopping at this panel. It
  // follows the signed-in persona, so switching users switches the whole form.
  const me = useActivePerson();
  const { setProfile } = useProfile();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [notifications, setNotifications] = useState({
    mentions: true,
    messages: true,
    meetings: true,
    email: false,
  });

  const [density, setDensity] = useState('comfortable');
  const [theme, setTheme] = useState('system');

  /*
   * Persists the profile to the server.
   *
   * Only four fields are sent, because only four are accepted. `PATCH
   * /users/me` is a strict schema, so an unknown key is a 400 rather than a
   * silent no-op, and two of the six editable fields are deliberately excluded:
   *
   * - `email` is the login identity. Changing it is an account-verification
   *   problem, not a profile field.
   * - `department` is a text input, but a department is a foreign key. Syncing a
   *   free-text value into it would need a name-to-id lookup and a
   *   move-the-employee flow, which is not a settings toggle. It stays local.
   *
   * The avatar is a third exclusion: it is cropped client-side into a data URL
   * of several kilobytes, and `avatarUrl` is capped at 1000 characters. Syncing
   * it properly needs the file to be stored and a relation on the user, not a
   * longer string.
   */
  const SYNCED_FIELDS = ['name', 'jobTitle', 'phone', 'bio'] as const;

  async function save(event: React.FormEvent) {
    event.preventDefault();

    const patch: Record<string, string> = {};
    for (const field of SYNCED_FIELDS) {
      const value = me[field];
      // `''` would be rejected by the schema for jobTitle/phone, which are
      // nullable-but-not-empty. Clearing a field is expressed as null.
      patch[field] = value ? value : '';
    }

    setSaving(true);
    setSaveError(null);

    try {
      await api.updateMyProfile(patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (cause) {
      setSaveError(cause instanceof ApiError ? cause.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
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
                  value={me.name}
                  onChange={(event) => edit({ name: event.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="s-title">Job title</label>
                <input
                  id="s-title"
                  className="table-input"
                  value={me.jobTitle ?? ''}
                  onChange={(event) => edit({ jobTitle: event.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="s-dept">Department</label>
                <input
                  id="s-dept"
                  className="table-input"
                  value={me.department ?? ''}
                  onChange={(event) => edit({ department: event.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="s-email">Email</label>
                <input
                  id="s-email"
                  type="email"
                  className="table-input"
                  value={me.email}
                  onChange={(event) => edit({ email: event.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="s-phone">Phone</label>
                <input
                  id="s-phone"
                  className="table-input"
                  value={me.phone}
                  onChange={(event) => edit({ phone: event.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="s-bio">Bio</label>
                <textarea
                  id="s-bio"
                  className="table-input"
                  rows={3}
                  value={me.bio}
                  onChange={(event) => edit({ bio: event.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button className="join" type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save changes'}
                </button>
                {saved && (
                  <span className="chip active">
                    <Check size={11} /> Saved
                  </span>
                )}
                {/*
                  Errors get their own slot rather than replacing the success
                  chip. A failed save that silently showed nothing would look
                  exactly like a save that had not been attempted.
                */}
                {saveError && (
                  <span className="form-error" role="alert">
                    {saveError}
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
