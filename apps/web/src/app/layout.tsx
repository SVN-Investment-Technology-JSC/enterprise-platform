import './global.css';
import { Be_Vietnam_Pro } from 'next/font/google';
import { cn } from '@/lib/utils';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { StoreProvider } from '@/store/store-provider';

/**
 * Font chung của hệ thống: Be Vietnam Pro (thiết kế riêng cho tiếng Việt, dấu thoáng và rõ ở cỡ nhỏ), cùng font với mọi
 * phân hệ. Tải cùng ứng dụng qua `next/font` và đưa ra biến `--font-sans`.
 */
const fontSans = Be_Vietnam_Pro({
  subsets: ['vietnamese', 'latin', 'latin-ext'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata = {
  title: 'Enterprise Platform',
  description: 'Multi-tenant modular SaaS platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" className={cn('font-sans', fontSans.variable)}>
      <body className={fontSans.className}>
        <StoreProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster duration={5000} />
        </StoreProvider>
      </body>
    </html>
  );
}
