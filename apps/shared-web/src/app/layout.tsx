import './global.css';
import { Toaster } from '@enterprise-platform/shared-ui';

export const metadata = {
  title: 'Hệ dùng chung · Enterprise Platform',
  description: 'Tài liệu công ty và dịch vụ dùng chung giữa các phân hệ.',
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
