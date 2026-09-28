import './global.css';

export const metadata = {
  title: 'Workspace · Enterprise Platform',
  description: 'Dự án, công việc, tài liệu và lịch biểu theo tenant.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
