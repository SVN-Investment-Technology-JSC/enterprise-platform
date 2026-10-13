import { LoginForm } from '../_components/login-form';
import { loadPresetAccounts } from '../_components/login-local-accounts';

export default function PlatformLoginPage() {
  return (
    <LoginForm
      portal="platform"
      presetAccounts={loadPresetAccounts('platform')}
      eyebrow="Đăng nhập"
      title="Cổng quản trị hệ thống"
      description="Chỉ dành cho người vận hành hệ thống."
    />
  );
}
