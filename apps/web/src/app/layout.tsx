import './global.css';
import { Geist } from 'next/font/google';
import { cn } from '@/lib/utils';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toast';
import { StoreProvider } from '@/store/store-provider';

const geist = Geist({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-sans',
  display: 'swap',
  preload: false,
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
    <html lang="vi" className={cn('font-sans', geist.variable)}>
      <body className={geist.className}>
        <StoreProvider>
          <Toaster timeout={5000}>
            <TooltipProvider>{children}</TooltipProvider>
          </Toaster>
        </StoreProvider>
      </body>
    </html>
  );
}
