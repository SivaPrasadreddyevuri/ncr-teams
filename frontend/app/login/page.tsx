import Link from 'next/link';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { LoginForm } from '@/components/auth/LoginForm';

export default function LoginPage() {
  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your NCR Teams workspace."
      footer={
        <p className="t-sm center" style={{ color: 'var(--muted)' }}>
          Need an account? <Link className="text-btn" href="/activate">Activate your invite</Link>
        </p>
      }
    >
      <LoginForm />
    </AuthLayout>
  );
}
