'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MailCheck } from 'lucide-react';

export function ForgotPasswordForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setSent(true);
  }

  if (sent) {
    return (
      <div>
        <div className="form-field">
          <p className="notice">
            <MailCheck size={16} /> If an account exists for <strong>{email}</strong>, a reset link
            has been sent. In this prototype no email is actually delivered.
          </p>
        </div>
        <button className="primary" type="button" onClick={() => router.push('/login')}>
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <div className="form-field">
        <label htmlFor="forgot-email">Work email</label>
        <input
          id="forgot-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          required
        />
      </div>

      <button className="primary" type="submit" disabled={!email.trim()}>
        Send reset link
      </button>
    </form>
  );
}
