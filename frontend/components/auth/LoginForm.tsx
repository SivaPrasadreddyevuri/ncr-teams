'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { ProfileProvider } from '@/components/profile/ProfileProvider';
import { WorkspaceProvider, useWorkspace } from '@/components/workspace/WorkspaceProvider';
import { directory, type Person } from '@/lib/data';
import { api, ApiError } from '@/lib/api';

const ROLE_LABEL: Record<Person['role'], string> = {
  HR_ADMIN: 'HR',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
};

/**
 * Personas offered on the sign-in screen.
 *
 * The account is now real, so the picker no longer decides who you are -- it
 * decides which seeded account's email is prefilled, and the password is checked
 * by the API. It is kept because a showcase needs a way to demonstrate the
 * role-gated parts of the app, and because it makes the email field useful
 * without a visitor having to know an address.
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

  // A two-step sign-in: the password is correct but the account has a second
  // factor, so the API hands back a challenge instead of a session.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const persona = directory.find((person) => person.id === personaId) ?? activeUser;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (challenge) {
      if (!code.trim()) {
        setError('Enter the code from your authenticator app.');
        return;
      }
      setBusy(true);
      try {
        await api.loginWithTwoFactor(challenge, code.trim());
        signIn(personaId);
        router.push('/');
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Could not verify that code.');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!email.trim() || !password) {
      setError('Enter an email and password to continue.');
      return;
    }

    setBusy(true);
    try {
      const result = await api.login(email.trim(), password);

      // A challenge means the password was right and 2FA is still outstanding.
      // No session has been issued at this point.
      if (result.challengeToken) {
        setChallenge(result.challengeToken);
        setError(null);
        return;
      }

      // The persona is what drives role gating across the app; the cookie set by
      // the API is what authenticates the request. Both are needed.
      signIn(personaId);
      router.push('/');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not sign in. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const demoEmail = process.env.NEXT_PUBLIC_DEMO_EMAIL;
  const demoPassword = process.env.NEXT_PUBLIC_DEMO_PASSWORD;

  return (
    <form onSubmit={submit} noValidate>
      {!challenge && (
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
      )}

      {challenge ? (
        <div className="form-field">
          <label htmlFor="login-code">Authentication code</label>
          <input
            id="login-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
          />
          <p className="auth-hint">
            Open your authenticator app for the six-digit code.
          </p>
        </div>
      ) : (
        <>
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
        </>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <button className="primary auth-submit" type="submit" disabled={busy}>
        <LogIn size={16} />
        {busy ? 'Signing in...' : challenge ? 'Verify' : 'Sign in'}
      </button>

      {/*
        Shown only when the deployment sets the demo credentials. A showcase
        viewer should be able to sign in without reading a README, and the value
        is public either way -- it is displayed here on purpose rather than
        hidden in a source file. Leave the variables unset and this is not
        rendered at all.
      */}
      {!challenge && demoEmail && demoPassword && (
        <p className="auth-hint">
          Demo account: <strong>{demoEmail}</strong> / <code>{demoPassword}</code>{' '}
          <button
            type="button"
            className="auth-inline-link"
            onClick={() => {
              setEmail(demoEmail);
              setPassword(demoPassword);
            }}
          >
            Fill in
          </button>
        </p>
      )}
    </form>
  );
}
