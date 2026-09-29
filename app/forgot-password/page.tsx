import Link from 'next/link';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

export default function ForgotPasswordPage() {
  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll send a reset link to your work email."
      footer={
        <p className="t-sm center" style={{ color: 'var(--muted)' }}>
          Remembered it? <Link className="text-btn" href="/login">Back to sign in</Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
