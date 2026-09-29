'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, ShieldCheck, QrCode } from 'lucide-react';

/** The only code this mock accepts. */
const DEMO_CODE = '123456';

const RECOVERY_CODES = ['a4f2-91cd', '7be3-0d55', 'c908-2fa1', '51d7-8c3e', 'e240-bb96', '6f18-4a2d'];

export function TwoFactorSetup() {
  const router = useRouter();
  const [stage, setStage] = useState<'verify' | 'on'>('verify');
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const secret = 'NCR T3AM J2K9 4XPL';
  const joined = digits.join('');

  function setDigit(index: number, value: string) {
    const clean = value.replace(/\D/g, '');
    if (!clean) {
      setDigits((current) => current.map((d, i) => (i === index ? '' : d)));
      return;
    }
    setDigits((current) => {
      const next = [...current];
      next[index] = clean[0];
      return next;
    });
    if (index < 5) {
      document.getElementById(`otp-${index + 1}`)?.focus();
    }
  }

  function verify(event: React.FormEvent) {
    event.preventDefault();
    if (joined === DEMO_CODE) {
      setError(null);
      setStage('on');
      return;
    }
    setError('That code is not valid. Use 123456 in this prototype.');
  }

  return (
    <div>
      {stage === 'verify' ? (
        <form onSubmit={verify} noValidate>
          <div className="qr-block">
            <span className="qr-frame">
              <QrCode size={72} />
            </span>
            <p>Scan with your authenticator app, then enter the 6-digit code it shows.</p>
          </div>

          <div className="secret">
            <code>{secret}</code>
            <button
              type="button"
              aria-label="Copy setup key"
              onClick={() => navigator.clipboard?.writeText(secret)}
            >
              <Copy size={14} />
            </button>
          </div>

          <div className="code">
            {digits.map((digit, index) => (
              <input
                key={index}
                id={`otp-${index}`}
                value={digit}
                onChange={(event) => setDigit(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Backspace' && !digit && index > 0) {
                    document.getElementById(`otp-${index - 1}`)?.focus();
                  }
                }}
                inputMode="numeric"
                maxLength={1}
                aria-label={`Digit ${index + 1}`}
              />
            ))}
          </div>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <p className="auth-hint">Prototype hint: the code is 123456</p>

          <button className="primary" type="submit" disabled={joined.length !== 6}>
            Verify and turn on
          </button>
        </form>
      ) : (
        <div>
          <div className="form-field">
            <p className="notice">
              <ShieldCheck size={16} /> Two-factor is on for this session. Nothing was stored on a
              server.
            </p>
          </div>

          <div className="recovery">
            <div className="recovery-head">
              <strong>Recovery codes</strong>
              <button
                type="button"
                onClick={() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy all'}
              </button>
            </div>
            <ul className="codes">
              {RECOVERY_CODES.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ul>
            <small className="field-hint">Sample codes for the mock only.</small>
          </div>

          <button className="primary" type="button" onClick={() => router.push('/settings')}>
            Back to settings
          </button>
        </div>
      )}
    </div>
  );
}
