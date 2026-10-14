import './global.css';
import { FinanceShell } from '@enterprise-platform/feature-finance';
import { Toaster } from '@enterprise-platform/shared-ui';

export const metadata = {
  title: 'Tài chính · Enterprise Platform',
  description: 'Phiếu thu, phiếu chi, chuyển tiền, tài khoản và báo cáo thu chi.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <FinanceShell>{children}</FinanceShell>
        <Toaster duration={5000} />
      </body>
    </html>
  );
}
