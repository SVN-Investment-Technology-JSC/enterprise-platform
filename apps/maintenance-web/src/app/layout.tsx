import './global.css';
import { Toaster } from '@enterprise-platform/shared-ui';

export const metadata = {
  title: 'Maintenance · Enterprise Platform',
  description: 'Quản lý thiết bị và bảo trì theo tenant.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
