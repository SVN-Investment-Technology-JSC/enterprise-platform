import './global.css';
import { Geist } from 'next/font/google';
import { cn } from '@/lib/utils';
import { TooltipProvider } from '@/components/ui/tooltip';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

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
      <body>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
