import './global.css';
import { HrmShell, Toaster } from '@enterprise-platform/feature-hrm';

export const metadata = {
  title: 'HRM & Chấm công · Enterprise Platform',
  description: 'Quản lý nhân sự, chấm công, ca làm việc và đơn từ phê duyệt.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body>
        <Toaster>
          <HrmShell>{children}</HrmShell>
        </Toaster>
      </body>
    </html>
  );
}
