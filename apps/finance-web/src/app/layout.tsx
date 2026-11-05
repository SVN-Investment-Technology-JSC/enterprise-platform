import './global.css';
import { Be_Vietnam_Pro } from 'next/font/google';
import { FinanceShell } from '@enterprise-platform/feature-finance';
import { Toaster } from '@enterprise-platform/shared-ui';

/**
 * Font chung của hệ thống: Be Vietnam Pro (thiết kế riêng cho tiếng Việt, dấu thoáng và rõ ở cỡ nhỏ). Tải cùng ứng dụng
 * qua `next/font` (tự lưu trữ lúc build, không gọi CDN khi chạy) và đưa ra biến `--font-sans`; `global.css` và các SCSS
 * module dùng biến này, nên đổi font chỉ cần sửa ở đây.
 */
const fontSans = Be_Vietnam_Pro({
  subsets: ['vietnamese', 'latin', 'latin-ext'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata = {
  title: 'Tài chính · Enterprise Platform',
  description: 'Phiếu thu, phiếu chi, chuyển tiền, tài khoản và báo cáo thu chi.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={fontSans.variable}>
      <body>
        <FinanceShell>{children}</FinanceShell>
        <Toaster duration={5000} />
      </body>
    </html>
  );
}
