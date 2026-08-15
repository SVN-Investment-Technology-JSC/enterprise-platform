import './global.css';

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
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
