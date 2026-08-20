import './global.css';

export const metadata = {
  title: 'Kho & Vật tư · Enterprise Platform',
  description: 'Quản lý tài sản, vật tư và tồn kho theo tenant.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
