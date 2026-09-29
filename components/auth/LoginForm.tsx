'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { currentUser } from '@/lib/data';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState(currentUser.email);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Enter an email and password to continue.');
      return;
    }

    setBusy(true);
    // Prototype: any credentials are accepted and nothing is sent anywhere.
    setTimeout(() => router.push('/'), 350);
  }

  return (
    <form onSubmit={submit} noValidate>
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
