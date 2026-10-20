import { PageBreadcrumb } from '@/components/ui/page-breadcrumb';
import { IconLibraryPage } from './library/icon-library-page';

export default function PlatformBrandStudioPage() {
  return (
    <>
      <PageBreadcrumb
        className="mb-5 text-slate-500"
        items={[{ label: 'Quản trị hệ thống', href: '/platform' }, { label: 'Thư viện icon' }]}
      />
      <IconLibraryPage />
    </>
  );
}
