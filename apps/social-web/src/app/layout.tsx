import './global.css';
import { Toaster } from '@enterprise-platform/shared-ui';

export const metadata = {
  title: 'Mạng nội bộ · Enterprise Platform',
  description: 'Bảng tin, bài viết và trao đổi nội bộ của công ty.',
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
