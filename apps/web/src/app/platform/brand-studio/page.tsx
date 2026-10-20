import { PageBreadcrumb } from '@/components/ui/page-breadcrumb';
import { BrandStudioConsole } from './brand-studio-console';

export default function PlatformBrandStudioPage() {
  return (
    <>
      <PageBreadcrumb
        className="mb-5 text-slate-500"
        items={[
          { label: 'Quản trị hệ thống', href: '/platform' },
          { label: 'Thương hiệu SVNDTS (Brand Studio)' },
        ]}
      />

      <BrandStudioConsole />
    </>
  );
}
