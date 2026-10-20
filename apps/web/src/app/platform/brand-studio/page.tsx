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

      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            SVNDTS Brand Icon Studio
          </h1>
          <p className="text-sm text-slate-500">
            Thiết kế, tùy biến và chuẩn hoá bộ nhận diện thương hiệu độc quyền cho nền tảng SVNDTS và các phân hệ doanh nghiệp.
          </p>
        </div>

        <BrandStudioConsole />
      </div>
    </>
  );
}
