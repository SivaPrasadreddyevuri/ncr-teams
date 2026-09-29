import Link from 'next/link';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { TwoFactorSetup } from '@/components/auth/TwoFactorSetup';

export default function Verify2FAPage() {
  return (
    <AuthLayout
      title="Secure your account"
      subtitle="Add a second step to your sign-in."
      footer={
        <p className="t-sm center" style={{ color: 'var(--muted)' }}>
          <Link className="text-btn" href="/settings">Back to settings</Link>
        </p>
      }
    >
      <TwoFactorSetup />
    </AuthLayout>
  );
}
