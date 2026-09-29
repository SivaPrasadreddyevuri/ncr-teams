import Link from 'next/link';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { ActivateForm } from '@/components/auth/ActivateForm';

export default function ActivatePage() {
  return (
    <AuthLayout
      title="Activate your account"
      subtitle="Set up your workspace access in a couple of steps."
      footer={
        <p className="t-sm center" style={{ color: 'var(--muted)' }}>
          Already activated? <Link className="text-btn" href="/login">Sign in</Link>
        </p>
      }
    >
      <ActivateForm />
    </AuthLayout>
  );
}
