import './global.css';
import { Toaster } from '@enterprise-platform/shared-ui';

export const metadata = {
  title: 'CRM · Enterprise Platform',
  description: 'Khách hàng, cơ hội, báo giá, hợp đồng, đơn bán, công nợ và bảo hành.',
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
