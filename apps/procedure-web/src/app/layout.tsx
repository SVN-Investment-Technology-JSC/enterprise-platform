import './global.css';
import { Be_Vietnam_Pro } from 'next/font/google';
import { BrandSlotProvider, Toaster } from '@enterprise-platform/shared-ui';

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
  title: 'Quy trình · Enterprise Platform',
  description: 'Thiết kế và vận hành quy trình cho từng tenant.',
  icons: {
    icon: [
      { url: '/api/platform/v1/brand/slots/brand.favicon/svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" className={fontSans.variable}>
      <body>
        <BrandSlotProvider>{children}</BrandSlotProvider>
        <Toaster />
      </body>
    </html>
  );
}
