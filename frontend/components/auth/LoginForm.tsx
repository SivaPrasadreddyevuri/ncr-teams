'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { ProfileProvider } from '@/components/profile/ProfileProvider';
import { WorkspaceProvider, useWorkspace } from '@/components/workspace/WorkspaceProvider';
import { directory, type Person } from '@/lib/data';

const ROLE_LABEL: Record<Person['role'], string> = {
  HR_ADMIN: 'HR',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
};

/**
 * Personas offered on the sign-in screen.
 *
 * A prototype has no real authentication, so who you are has to be chosen
 * explicitly -- otherwise every visitor is the same person and the role-based
 * parts of the app cannot be demonstrated at all. The chosen id is what decides
 * which nav items appear and which pages open.
 */
const PERSONAS = directory.filter((person) =>
  person.role === 'HR_ADMIN' ? true : person.role === 'MANAGER' ? true : person.id === 'u1',
);

export function LoginForm() {
  return (
    <WorkspaceProvider>
      <ProfileProvider>
        <LoginFormInner />
      </ProfileProvider>
    </WorkspaceProvider>
  );
}

function LoginFormInner() {
  const router = useRouter();
  const { signIn, activeUser } = useWorkspace();
  const [personaId, setPersonaId] = useState(activeUser.id);
  // Prefilled from the selected persona rather than left blank, so the default
  // screen looks like a real sign-in form. Choosing another persona overwrites it.
  const [email, setEmail] = useState(activeUser.email);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const persona = directory.find((person) => person.id === personaId) ?? activeUser;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Enter an email and password to continue.');
      return;
    }

    setBusy(true);
    // Prototype: any credentials are accepted and nothing is sent anywhere.
    // Signing in is just choosing which persona the app should act as.
    signIn(personaId);
    setTimeout(() => router.push('/'), 350);
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="persona-picker">
        <p className="persona-picker-label">Sign in as</p>
        {PERSONAS.map((option) => (
          <button
            key={option.id}
            className="persona-option"
            type="button"
            onClick={() => {
              setPersonaId(option.id);
              setEmail(option.email);
            }}
            aria-pressed={option.id === personaId}
          >
            <PersonAvatar person={option} size="md" online={option.online} />
            <span className="persona-option-text">
              <strong>{option.name}</strong>
              <small>{option.jobTitle ?? option.email}</small>
            </span>
            <span className="chip tiny">{ROLE_LABEL[option.role]}</span>
          </button>
        ))}
      </div>

      <div className="form-field">
        <label htmlFor="login-email">Work email</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
        />
      </div>

      <div className="form-field">
        <label htmlFor="login-password">Password</label>
        <div className="field-wrap">
          <input
            id="login-password"
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShow((current) => !current)}
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <div className="auth-row">
        <label className="check">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          <span>Remember me</span>
        </label>

        <Link className="auth-inline-link" href="/forgot-password">
          Forgot password?
        </Link>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <button className="primary auth-submit" type="submit" disabled={busy}>
        <LogIn size={16} />
        {busy ? 'Signing in...' : 'Sign in'}
      </button>

      <p className="auth-hint">Prototype build &mdash; any credentials are accepted.</p>
    </form>
  );
}
