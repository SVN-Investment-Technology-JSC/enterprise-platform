import './global.css';
import { Toaster } from '@enterprise-platform/shared-ui';

export const metadata = {
  title: 'Workspace · Enterprise Platform',
  description: 'Dự án, công việc, tài liệu và lịch biểu theo tenant.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        {children}
        <Toaster duration={5000} />
      </body>
    </html>
  );
}
