import './global.css';
import { Toaster } from '@enterprise-platform/shared-ui';

export const metadata = {
  title: 'Procedure Engine · Enterprise Platform',
  description: 'Thiết kế và vận hành quy trình cho từng tenant.',
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
