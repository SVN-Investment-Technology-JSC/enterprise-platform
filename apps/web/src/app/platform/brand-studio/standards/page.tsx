import { PageBreadcrumb } from '@/components/ui/page-breadcrumb';
import { StandardsPage } from './standards-page';

export default function PlatformBrandStandardsPage() {
  return (
    <>
      <PageBreadcrumb
        className="mb-5 text-slate-500"
        items={[{ label: 'Quản trị hệ thống', href: '/platform' }, { label: 'Bảng màu & quy chuẩn' }]}
      />
      <StandardsPage />
    </>
  );
}
