'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, KeyRound } from 'lucide-react';

const STEPS = ['Set password', 'Security details', 'Finish'];

export function ActivateForm() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [phone, setPhone] = useState('');

  const passwordValid = password.length >= 8;
  const confirmValid = confirm.length > 0 && confirm === password;

  function next(event: React.FormEvent) {
    event.preventDefault();
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
  }

  return (
    <div>
      <div className="steps">
        {STEPS.map((label, index) => (
          <div key={label} className="step-group">
            {index > 0 && <span className="step-line" />}
            <span className={index <= step ? 'step active' : 'step'}>
              <b>{index < step ? <Check size={12} /> : index + 1}</b>
              {label}
            </span>
          </div>
        ))}
      </div>

      {step === 0 && (
        <form onSubmit={next}>
          <div className="form-field">
            <label htmlFor="new-password">Create a password</label>
            <input
              id="new-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
          </div>

          <div className="form-field">
            <label htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="Re-enter your password"
              autoComplete="new-password"
            />
          </div>

          <ul className="rules">
            <li className={passwordValid ? 'ok' : ''}>
              <b>{passwordValid ? <Check size={11} /> : '1'}</b> At least 8 characters
            </li>
            <li className={confirmValid ? 'ok' : ''}>
              <b>{confirmValid ? <Check size={11} /> : '2'}</b> Both passwords match
            </li>
          </ul>

          <button className="primary" type="submit" disabled={!passwordValid || !confirmValid}>
            Continue
          </button>
        </form>
      )}

      {step === 1 && (
        <form onSubmit={next}>
          <div className="form-field">
            <label htmlFor="activate-phone">Mobile number</label>
            <input
              id="activate-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+1 555 0100"
              inputMode="tel"
            />
            <small className="field-hint">Used for meeting reminders. Optional.</small>
          </div>

          <button className="primary" type="submit">
            Continue
          </button>
        </form>
      )}

      {step === 2 && (
        <div>
          <div className="form-field">
            <p className="notice">
              <KeyRound size={16} /> Your account is ready. In this prototype nothing was created
              &mdash; you can go straight to sign in.
            </p>
          </div>
          <button className="primary" type="button" onClick={() => router.push('/login')}>
            Go to sign in
          </button>
        </div>
      )}
    </div>
  );
}
