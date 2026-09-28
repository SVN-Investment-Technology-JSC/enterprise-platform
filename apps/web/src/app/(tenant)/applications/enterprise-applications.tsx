'use client';

import type {
  ModuleActivationRequestResponse,
  TenantEntitlementStatus,
  TenantModuleCatalogItem,
} from '@enterprise-platform/contracts-tenancy';
import {
  Boxes,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  FileCog,
  FolderKanban,
  Layers,
  PackageOpen,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
  Wrench,
  X,
  Zap,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';

interface ModuleExtraInfo {
  category: string;
  tagline: string;
  accentColor: {
    bg: string;
    border: string;
    text: string;
    iconBg: string;
  };
  features: string[];
  targetRoles: string[];
  businessValue: string;
}

const moduleCatalogMetadata: Record<string, ModuleExtraInfo> = {
  'procedure-engine': {
    category: 'Vận hành & Quy trình',
    tagline: 'Thiết kế, ban hành và tự động hóa luồng phê duyệt văn bản, tờ trình đa cấp.',
    accentColor: {
      bg: 'bg-violet-50/70',
      border: 'border-violet-200/80',
      text: 'text-violet-700',
      iconBg: 'bg-violet-100 text-violet-700',
    },
    features: [
      'Thiết kế sơ đồ quy trình trực quan (BPMN Canvas)',
      'Phân quyền phê duyệt đa cấp theo ma trận thẩm quyền',
      'Theo dõi tiến độ, cảnh báo SLA và trễ hạn tự động',
      'Ký số nội bộ và xác thực bảo mật chuẩn doanh nghiệp',
    ],
    targetRoles: ['Ban Giám đốc', 'Trưởng phòng ban', 'Chuyên viên xử lý hồ sơ'],
    businessValue:
      'Giúp cắt giảm 70% thời gian xử lý thủ tục hành chính, loại bỏ hoàn toàn tình trạng thất lạc giấy tờ và đảm bảo tính minh bạch trong toàn tổ chức.',
  },
  workflow: {
    category: 'Vận hành & Quy trình',
    tagline: 'Thiết kế, ban hành và tự động hóa luồng phê duyệt văn bản, tờ trình đa cấp.',
    accentColor: {
      bg: 'bg-violet-50/70',
      border: 'border-violet-200/80',
      text: 'text-violet-700',
      iconBg: 'bg-violet-100 text-violet-700',
    },
    features: [
      'Thiết kế sơ đồ quy trình trực quan (BPMN Canvas)',
      'Phân quyền phê duyệt đa cấp theo ma trận thẩm quyền',
      'Theo dõi tiến độ, cảnh báo SLA và trễ hạn tự động',
      'Ký số nội bộ và xác thực bảo mật chuẩn doanh nghiệp',
    ],
    targetRoles: ['Ban Giám đốc', 'Trưởng phòng ban', 'Chuyên viên xử lý hồ sơ'],
    businessValue:
      'Giúp cắt giảm 70% thời gian xử lý thủ tục hành chính và tăng tốc độ ra quyết định liên phòng ban.',
  },
  maintenance: {
    category: 'Tài sản & Kỹ thuật',
    tagline: 'Quản lý lý lịch thiết bị, lịch bảo trì phòng ngừa và tiếp nhận sự cố kỹ thuật.',
    accentColor: {
      bg: 'bg-amber-50/70',
      border: 'border-amber-200/80',
      text: 'text-amber-700',
      iconBg: 'bg-amber-100 text-amber-700',
    },
    features: [
      'Hồ sơ lý lịch máy móc, công cụ và tài sản cố định',
      'Lập lịch bảo trì định kỳ (PM) và kiểm định an toàn tự động',
      'Tiếp nhận phiếu báo hỏng, phân công kỹ thuật viên tức thì',
      'Phân tích chỉ số độ tin cậy MTTR, MTBF và chi phí bảo dưỡng',
    ],
    targetRoles: ['Trưởng bộ phận kỹ thuật', 'Kỹ sư bảo trì', 'Nhân viên vận hành máy'],
    businessValue:
      'Kéo dài tuổi thọ tài sản thiết bị lên tới 35%, hạn chế tối đa thời gian chết (downtime) của dây chuyền và tiết kiệm chi phí sửa chữa đột xuất.',
  },
  inventory: {
    category: 'Kho & Chuỗi cung ứng',
    tagline: 'Kiểm soát tồn kho thời gian thực, quản lý đa kho, truy xuất lô và định mức vật tư.',
    accentColor: {
      bg: 'bg-blue-50/70',
      border: 'border-blue-200/80',
      text: 'text-blue-700',
      iconBg: 'bg-blue-100 text-blue-700',
    },
    features: [
      'Quản lý danh mục hàng hóa, số lô, hạn sử dụng và vị trí kệ kho',
      'Quy trình nhập, xuất, luân chuyển và kiểm kê định kỳ',
      'Cảnh báo chạm ngưỡng tồn kho an toàn & đề xuất đặt hàng',
      'Tích hợp quét mã vạch Barcode / QR Code trên thiết bị cầm tay',
    ],
    targetRoles: ['Thủ kho', 'Quản lý chuỗi cung ứng', 'Bộ phận kế toán kho'],
    businessValue:
      'Đảm bảo dữ liệu tồn kho chuẩn xác 99.8%, hạn chế thất thoát và tối ưu hóa vòng quay vốn lưu động cho doanh nghiệp.',
  },
  accounting: {
    category: 'Tài chính & Quản trị',
    tagline: 'Hạch toán kế toán tổng hợp, theo dõi dòng tiền, công nợ và báo cáo tài chính.',
    accentColor: {
      bg: 'bg-emerald-50/70',
      border: 'border-emerald-200/80',
      text: 'text-emerald-700',
      iconBg: 'bg-emerald-100 text-emerald-700',
    },
    features: [
      'Sổ cái kế toán, chứng từ thu - chi và đối soát ngân hàng',
      'Quản lý công nợ khách hàng, nhà cung cấp theo kỳ hạn',
      'Tự động hạch toán liên thông từ kho và quy trình mua sắm',
      'Lập báo cáo tài chính và báo cáo thuế theo chuẩn mực VAS/IFRS',
    ],
    targetRoles: ['Kế toán trưởng', 'Kế toán viên', 'Giám đốc Tài chính (CFO)'],
    businessValue:
      'Cung cấp bức tranh tài chính chuẩn xác theo thời gian thực, giúp lãnh đạo kiểm soát dòng tiền và tuân thủ tuyệt đối quy định thuế.',
  },
  dms: {
    category: 'Vận hành & Quy trình',
    tagline: 'Số hóa kho tài liệu, lưu trữ tập trung bảo mật cao và phân quyền truy cập thông minh.',
    accentColor: {
      bg: 'bg-indigo-50/70',
      border: 'border-indigo-200/80',
      text: 'text-indigo-700',
      iconBg: 'bg-indigo-100 text-indigo-700',
    },
    features: [
      'Lưu trữ hồ sơ tài liệu tập trung có mã hóa đầu cuối',
      'Kiểm soát phiên bản (Version Control) và lịch sử chỉnh sửa',
      'Phân quyền đọc, sửa, chia sẻ chi tiết theo vai trò',
      'Tìm kiếm toàn văn (Full-Text Search) với công nghệ OCR',
    ],
    targetRoles: ['Văn thư lưu trữ', 'Phòng Pháp chế', 'Toàn thể nhân sự'],
    businessValue:
      'Xóa bỏ không gian lưu trữ vật lý cồng kềnh, tìm kiếm tài liệu chỉ trong 3 giây và đảm bảo an toàn tuyệt đối cho bí mật kinh doanh.',
  },
  hrm: {
    category: 'Tài chính & Quản trị',
    tagline: 'Quản lý cơ cấu nhân sự, hồ sơ lao động, tính công lương và đánh giá hiệu suất.',
    accentColor: {
      bg: 'bg-cyan-50/70',
      border: 'border-cyan-200/80',
      text: 'text-cyan-700',
      iconBg: 'bg-cyan-100 text-cyan-700',
    },
    features: [
      'Hồ sơ nhân viên điện tử đồng bộ với Sơ đồ tổ chức',
      'Chấm công tự động, tính lương và bảo hiểm xã hội',
      'Quản lý hợp đồng lao động, chế độ phúc lợi và ngày nghỉ',
      'Đánh giá hiệu suất làm việc định kỳ theo KPI / OKR',
    ],
    targetRoles: ['Giám đốc Nhân sự', 'Chuyên viên C&B', 'Quản lý phòng ban'],
    businessValue:
      'Gia tăng mức độ gắn kết của nhân viên, tự động hóa quy trình nhân sự và tối ưu hóa hiệu suất nguồn nhân lực.',
  },
};

const moduleIcons: Record<string, LucideIcon> = {
  accounting: FileCog,
  dms: FolderKanban,
  hrm: Users,
  inventory: Boxes,
  maintenance: Wrench,
  'procedure-engine': Workflow,
  workflow: Workflow,
};

const statusLabel: Record<TenantEntitlementStatus, string> = {
  active: 'Đang hoạt động',
  disabled: 'Đã tạm dừng',
  failed: 'Kích hoạt lỗi',
  'not-entitled': 'Khả dụng',
  provisioning: 'Đang khởi tạo',
};

function csrfToken(): string {
  const value = document.cookie
    .split('; ')
    .find((item) => item.startsWith('ep_csrf='))
    ?.split('=')
    .slice(1)
    .join('=');
  return value ? decodeURIComponent(value) : '';
}

function apiError(payload: { message?: string | string[] }): string {
  if (Array.isArray(payload.message)) return payload.message.join(' ');
  return payload.message ?? 'Không thể gửi yêu cầu kích hoạt.';
}

function getModuleInfo(key: string, fallbackName: string, fallbackDesc: string): ModuleExtraInfo {
  const meta = moduleCatalogMetadata[key.toLowerCase()];
  if (meta) return meta;
  return {
    category: 'Ứng dụng mở rộng',
    tagline: fallbackDesc || 'Giải pháp chuyển đổi số chuyên sâu cho doanh nghiệp.',
    accentColor: {
      bg: 'bg-slate-50/70',
      border: 'border-slate-200/80',
      text: 'text-slate-700',
      iconBg: 'bg-slate-100 text-slate-700',
    },
    features: [
      `Tích hợp đồng bộ trong hệ sinh thái ${fallbackName}`,
      'Phân quyền bảo mật đa cấp theo vai trò doanh nghiệp',
      'Quản lý dữ liệu tập trung và truy xuất thời gian thực',
      'Khả năng mở rộng linh hoạt theo quy mô hoạt động',
    ],
    targetRoles: ['Quản trị viên', 'Người dùng chuyên môn'],
    businessValue: `Hỗ trợ doanh nghiệp số hóa và tối ưu năng suất vận hành với phân hệ ${fallbackName}.`,
  };
}

export function EnterpriseApplications({
  canRequestActivation,
  initialError,
  initialModules,
}: {
  canRequestActivation: boolean;
  initialError?: string;
  initialModules: TenantModuleCatalogItem[];
}) {
  // Loại bỏ hoàn toàn CRM theo yêu cầu của user
  const sanitizedModules = useMemo(
    () => initialModules.filter((m) => m.key.toLowerCase() !== 'crm'),
    [initialModules],
  );

  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'active' | 'not-active'>('all');
  const [selectedModule, setSelectedModule] = useState<TenantModuleCatalogItem | null>(null);
  const [requestingKey, setRequestingKey] = useState<string>();
  const [requestedKeys, setRequestedKeys] = useState<Set<string>>(() => new Set());

  // Metrics
  const totalCount = sanitizedModules.length;
  const activeCount = sanitizedModules.filter((m) => m.entitlementStatus === 'active').length;
  const provisioningCount = sanitizedModules.filter((m) => m.entitlementStatus === 'provisioning').length;
  const availableCount = sanitizedModules.filter((m) => m.entitlementStatus !== 'active' && m.entitlementStatus !== 'provisioning').length;

  // Lọc danh sách danh mục có sẵn (không bao gồm CRM)
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const m of sanitizedModules) {
      const info = getModuleInfo(m.key, m.name, m.description);
      cats.add(info.category);
    }
    return Array.from(cats);
  }, [sanitizedModules]);

  // Bộ lọc modules
  const filteredModules = useMemo(() => {
    const normQuery = query.trim().toLocaleLowerCase('vi');
    return sanitizedModules.filter((module) => {
      const info = getModuleInfo(module.key, module.name, module.description);

      // Lọc trạng thái
      if (selectedStatus === 'active' && module.entitlementStatus !== 'active') return false;
      if (selectedStatus === 'not-active' && module.entitlementStatus === 'active') return false;

      // Lọc danh mục
      if (selectedCategory !== 'all' && info.category !== selectedCategory) return false;

      // Tìm kiếm từ khóa
      if (normQuery) {
        const matchesBasic = [module.name, module.description, module.key].some((val) =>
          val.toLocaleLowerCase('vi').includes(normQuery),
        );
        const matchesFeatures = info.features.some((f) => f.toLocaleLowerCase('vi').includes(normQuery));
        const matchesCategory = info.category.toLocaleLowerCase('vi').includes(normQuery);
        if (!matchesBasic && !matchesFeatures && !matchesCategory) return false;
      }

      return true;
    });
  }, [sanitizedModules, query, selectedCategory, selectedStatus]);

  async function requestActivation(module: TenantModuleCatalogItem) {
    setRequestingKey(module.key);
    try {
      const response = await fetch(
        `/api/platform/v1/modules/${encodeURIComponent(module.key)}/activation-requests`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'x-csrf-token': csrfToken() },
        },
      );
      const payload = (await response.json().catch(() => ({}))) as
        | ModuleActivationRequestResponse
        | { message?: string | string[] };
      if (!response.ok) {
        throw new Error(apiError(payload as { message?: string | string[] }));
      }
      setRequestedKeys((current) => new Set(current).add(module.key));
    } finally {
      setRequestingKey(undefined);
    }
  }

  function handleTriggerActivation(module: TenantModuleCatalogItem) {
    void toast.promise(requestActivation(module), {
      loading: {
        title: 'Đang gửi yêu cầu kích hoạt',
        description: `Đang gửi yêu cầu kích hoạt module ${module.name} tới ban quản trị...`,
      },
      success: {
        title: 'Đã gửi yêu cầu thành công',
        description: `Yêu cầu kích hoạt ${module.name} đã được tiếp nhận để xử lý.`,
      },
      error: (err) => ({
        title: 'Không thể gửi yêu cầu',
        description: err instanceof Error ? err.message : 'Vui lòng thử lại sau.',
      }),
    });
  }

  return (
    <>
      <main className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden p-4 sm:p-6">
        {/* Header & Breadcrumb */}
        <div className="shrink-0 mb-3">
          <nav
            aria-label="Breadcrumb"
            className="mb-1.5 flex items-center text-xs sm:text-sm text-slate-500"
          >
            <Link className="hover:text-[#091426]" href="/dashboard">
              Tenant Portal
            </Link>
            <ChevronRight className="mx-1 size-4" />
            <span>Quản trị</span>
            <ChevronRight className="mx-1 size-4" />
            <span className="font-medium text-[#0d1c2d]">Ứng dụng doanh nghiệp</span>
          </nav>

          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0d1c2d]">
                Ứng dụng Doanh nghiệp
              </h1>
              <p className="mt-0.5 text-xs sm:text-sm text-slate-500">
                Khám phá, quản trị và khởi tạo các module phân hệ nghiệp vụ vận hành cho tổ chức của bạn.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs">
                <Sparkles className="size-3.5 text-amber-500" />
                Gói Doanh nghiệp Enterprise
              </span>
            </div>
          </div>
        </div>

        {/* Top Metric Cards */}
        <section className="shrink-0 mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            icon={Layers}
            label="Tổng ứng dụng"
            value={totalCount}
          />
          <MetricCard
            accent="text-emerald-700"
            icon={CheckCircle2}
            label="Đang hoạt động"
            value={activeCount}
          />
          <MetricCard
            accent="text-blue-700"
            icon={Clock}
            label="Đang khởi tạo"
            value={provisioningCount}
          />
          <MetricCard
            accent="text-amber-700"
            icon={Boxes}
            label="Sẵn sàng mở rộng"
            value={availableCount}
          />
        </section>

        {initialError ? (
          <p
            className="shrink-0 mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            role="alert"
          >
            {initialError}
          </p>
        ) : null}

        {/* Main Content Area */}
        <section className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* Toolbar */}
          <div className="shrink-0 flex flex-col justify-between gap-3 border-b border-slate-200 bg-white p-3 sm:p-4 md:flex-row md:items-center">
            {/* Search Input */}
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="bg-slate-50 focus:bg-white pl-9 text-xs sm:text-sm"
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Tìm kiếm theo tên, chức năng, danh mục..."
                value={query}
              />
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Status Tabs */}
              <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
                <button
                  className={cn(
                    'rounded-md px-2.5 py-1 font-medium transition',
                    selectedStatus === 'all'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900',
                  )}
                  onClick={() => setSelectedStatus('all')}
                  type="button"
                >
                  Tất cả ({sanitizedModules.length})
                </button>
                <button
                  className={cn(
                    'rounded-md px-2.5 py-1 font-medium transition',
                    selectedStatus === 'active'
                      ? 'bg-white text-emerald-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900',
                  )}
                  onClick={() => setSelectedStatus('active')}
                  type="button"
                >
                  Đang hoạt động ({activeCount})
                </button>
                <button
                  className={cn(
                    'rounded-md px-2.5 py-1 font-medium transition',
                    selectedStatus === 'not-active'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900',
                  )}
                  onClick={() => setSelectedStatus('not-active')}
                  type="button"
                >
                  Chưa kích hoạt ({totalCount - activeCount})
                </button>
              </div>

              {/* Category Select */}
              <select
                className="h-8.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                onChange={(event) => setSelectedCategory(event.currentTarget.value)}
                value={selectedCategory}
              >
                <option value="all">Tất cả danh mục</option>
                {availableCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>

              {(query || selectedCategory !== 'all' || selectedStatus !== 'all') && (
                <Button
                  className="h-8.5 text-xs text-slate-500 hover:text-slate-900"
                  onClick={() => {
                    setQuery('');
                    setSelectedCategory('all');
                    setSelectedStatus('all');
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <X className="mr-1 size-3.5" />
                  Đặt lại
                </Button>
              )}
            </div>
          </div>

          {/* Body: Internal Scrollable Grid */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
            {filteredModules.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3">
                {filteredModules.map((module) => {
                  const isRequested = requestedKeys.has(module.key);
                  const isRequesting = requestingKey === module.key;
                  return (
                    <ApplicationCard
                      canRequestActivation={canRequestActivation}
                      isRequested={isRequested}
                      isRequesting={isRequesting}
                      key={module.key}
                      module={module}
                      onRequest={() => handleTriggerActivation(module)}
                      onViewDetails={() => setSelectedModule(module)}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 p-8 text-center">
                <PackageOpen className="mb-3 size-10 text-slate-300" />
                <h3 className="text-sm font-semibold text-slate-800">
                  Không tìm thấy ứng dụng nào phù hợp
                </h3>
                <p className="mt-1 max-w-sm text-xs text-slate-500">
                  Thử thay đổi từ khóa tìm kiếm hoặc đặt lại các bộ lọc danh mục và trạng thái.
                </p>
                <Button
                  className="mt-4 text-xs"
                  onClick={() => {
                    setQuery('');
                    setSelectedCategory('all');
                    setSelectedStatus('all');
                  }}
                  size="sm"
                  variant="outline"
                >
                  Xóa bộ lọc
                </Button>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Drawer Chi tiết ứng dụng (Right Sheet 620px) */}
      <ModuleDetailsDrawer
        canRequestActivation={canRequestActivation}
        isRequested={selectedModule ? requestedKeys.has(selectedModule.key) : false}
        isRequesting={selectedModule ? requestingKey === selectedModule.key : false}
        module={selectedModule}
        onClose={() => setSelectedModule(null)}
        onRequest={() => selectedModule && handleTriggerActivation(selectedModule)}
      />
    </>
  );
}

function MetricCard({
  accent,
  icon: Icon,
  label,
  value,
}: {
  accent?: string;
  icon: LucideIcon;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
      <div>
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className={cn('mt-0.5 text-2xl font-bold tracking-tight text-[#0d1c2d]', accent)}>
          {value}
        </p>
      </div>
      <div className="grid size-9 place-items-center rounded-lg bg-slate-100 text-slate-600">
        <Icon className="size-4.5" />
      </div>
    </div>
  );
}

function ApplicationCard({
  canRequestActivation,
  isRequested,
  isRequesting,
  module,
  onRequest,
  onViewDetails,
}: {
  canRequestActivation: boolean;
  isRequested: boolean;
  isRequesting: boolean;
  module: TenantModuleCatalogItem;
  onRequest: () => void;
  onViewDetails: () => void;
}) {
  const Icon = moduleIcons[module.key.toLowerCase()] ?? Boxes;
  const info = getModuleInfo(module.key, module.name, module.description);
  const isActive = module.entitlementStatus === 'active';
  const isProvisioning = module.entitlementStatus === 'provisioning';

  return (
    <article
      className={cn(
        'group flex flex-col justify-between rounded-xl border bg-white p-4.5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        isActive
          ? 'border-slate-200/90 hover:border-emerald-300/80'
          : 'border-slate-200/80 hover:border-slate-300',
      )}
    >
      <div>
        {/* Card Header: Icon + Badge */}
        <div className="mb-3.5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'grid size-11 place-items-center rounded-xl transition group-hover:scale-105',
                info.accentColor.iconBg,
              )}
            >
              <Icon className="size-5.5" />
            </div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                {info.category}
              </span>
              <h2 className="text-base font-bold text-slate-900 line-clamp-1 group-hover:text-blue-600 transition">
                {module.name}
              </h2>
            </div>
          </div>

          <StatusBadge status={module.entitlementStatus} />
        </div>

        {/* Description */}
        <p className="text-xs leading-relaxed text-slate-600 line-clamp-2 min-h-9">
          {module.description || info.tagline}
        </p>

        {/* Feature Highlights Pills */}
        <div className="mt-3.5 space-y-1.5 rounded-lg bg-slate-50/80 p-2.5 border border-slate-100">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            Tính năng cốt lõi:
          </p>
          <ul className="space-y-1 text-xs text-slate-700">
            {info.features.slice(0, 2).map((feat, idx) => (
              <li className="flex items-center gap-1.5" key={idx}>
                <Check className="size-3.5 text-emerald-600 shrink-0" />
                <span className="truncate">{feat}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Card Footer: Actions */}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <span>Phiên bản</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-700">
            v{module.version}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            className="h-8 px-2.5 text-xs text-slate-600 hover:text-slate-900"
            onClick={onViewDetails}
            size="sm"
            variant="ghost"
          >
            Chi tiết
          </Button>

          {isActive ? (
            <a
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#091426] px-3 text-xs font-semibold text-white shadow-xs transition hover:bg-[#132747]"
              href={module.launchUrl}
            >
              Truy cập
              <ExternalLink className="size-3.5" />
            </a>
          ) : isProvisioning ? (
            <Button
              className="h-8 gap-1.5 border-blue-200 bg-blue-50 text-xs text-blue-700 hover:bg-blue-50"
              disabled
              size="sm"
              variant="outline"
            >
              <Loader2 className="size-3.5 animate-spin" />
              Đang khởi tạo
            </Button>
          ) : (
            <Button
              className={cn(
                'h-8 gap-1.5 text-xs font-semibold',
                isRequested
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                  : 'bg-blue-600 hover:bg-blue-700 text-white',
              )}
              disabled={!canRequestActivation || isRequesting || isRequested}
              onClick={onRequest}
              size="sm"
            >
              {isRequesting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : isRequested ? (
                <Check className="size-3.5" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {isRequested ? 'Đã gửi yêu cầu' : 'Kích hoạt'}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: TenantEntitlementStatus }) {
  if (status === 'active') {
    return (
      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50 shrink-0 gap-1.5 text-[11px] font-semibold">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-emerald-600" />
        </span>
        Đang hoạt động
      </Badge>
    );
  }

  if (status === 'provisioning') {
    return (
      <Badge className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-50 shrink-0 gap-1.5 text-[11px] font-semibold">
        <Loader2 className="size-3 animate-spin text-blue-600" />
        Đang khởi tạo
      </Badge>
    );
  }

  if (status === 'failed') {
    return (
      <Badge className="border-red-200 bg-red-50 text-red-700 hover:bg-red-50 shrink-0 text-[11px] font-semibold">
        Lỗi kích hoạt
      </Badge>
    );
  }

  if (status === 'disabled') {
    return (
      <Badge className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50 shrink-0 text-[11px] font-semibold">
        Tạm dừng
      </Badge>
    );
  }

  return (
    <Badge
      className="border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-100 shrink-0 text-[11px] font-semibold"
      variant="outline"
    >
      Khả dụng
    </Badge>
  );
}

function ModuleDetailsDrawer({
  canRequestActivation,
  isRequested,
  isRequesting,
  module,
  onClose,
  onRequest,
}: {
  canRequestActivation: boolean;
  isRequested: boolean;
  isRequesting: boolean;
  module: TenantModuleCatalogItem | null;
  onClose: () => void;
  onRequest: () => void;
}) {
  if (!module) return null;

  const Icon = moduleIcons[module.key.toLowerCase()] ?? Boxes;
  const info = getModuleInfo(module.key, module.name, module.description);
  const isActive = module.entitlementStatus === 'active';
  const isProvisioning = module.entitlementStatus === 'provisioning';

  return (
    <Sheet onOpenChange={(open) => !open && onClose()} open={Boolean(module)}>
      <SheetContent className="flex h-full w-full flex-col overflow-hidden data-[side=right]:sm:max-w-[620px] p-0">
        {/* Drawer Header */}
        <SheetHeader className="shrink-0 border-b border-slate-200 bg-slate-50/70 p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                'grid size-14 place-items-center rounded-2xl shadow-xs shrink-0',
                info.accentColor.iconBg,
              )}
            >
              <Icon className="size-7" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {info.category}
                </span>
                <span className="rounded bg-slate-200/80 px-1.5 py-0.2 font-mono text-[10px] font-medium text-slate-700">
                  v{module.version}
                </span>
              </div>
              <SheetTitle className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl">
                {module.name}
              </SheetTitle>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge status={module.entitlementStatus} />
                <span className="text-xs text-slate-400">•</span>
                <span className="font-mono text-xs text-slate-500">
                  Mã module: {module.key}
                </span>
              </div>
            </div>
          </div>
          <SheetDescription className="mt-3 text-xs leading-relaxed text-slate-600 sm:text-sm">
            {info.tagline}
          </SheetDescription>
        </SheetHeader>

        {/* Drawer Body (Internal Scroll) */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* Lợi ích nghiệp vụ */}
          <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-900">
              <Zap className="size-4 text-blue-600" />
              Giá trị mang lại cho doanh nghiệp
            </div>
            <p className="mt-2 text-xs leading-relaxed text-blue-950 sm:text-sm">
              {info.businessValue}
            </p>
          </div>

          {/* Danh sách tính năng */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-3 flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-emerald-600" />
              Các phân hệ & tính năng cốt lõi
            </h4>
            <div className="space-y-2">
              {info.features.map((feature, idx) => (
                <div
                  className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-xs"
                  key={idx}
                >
                  <div className="grid size-5 place-items-center rounded-full bg-emerald-100 text-emerald-700 shrink-0 mt-0.5">
                    <Check className="size-3" />
                  </div>
                  <div className="text-xs sm:text-sm text-slate-800 leading-snug">
                    {feature}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Đối tượng sử dụng */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-2.5 flex items-center gap-1.5">
              <Users className="size-4 text-slate-700" />
              Đối tượng & vai trò áp dụng
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {info.targetRoles.map((role, idx) => (
                <span
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
                  key={idx}
                >
                  {role}
                </span>
              ))}
            </div>
          </div>

          {/* Thông tin kỹ thuật & Bảo mật */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs">
            <div className="flex items-center justify-between py-1 border-b border-slate-200/60">
              <span className="text-slate-500">Đường dẫn khởi chạy</span>
              <span className="font-mono text-slate-700 truncate max-w-xs">
                {module.launchUrl}
              </span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-slate-200/60">
              <span className="text-slate-500">Tiêu chuẩn bảo mật</span>
              <span className="font-medium text-slate-700 flex items-center gap-1">
                <ShieldCheck className="size-3.5 text-emerald-600" />
                CSRF Protected • Multi-tenant Isolation
              </span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-slate-500">Trạng thái phân bổ</span>
              <span className="font-semibold text-slate-800">
                {statusLabel[module.entitlementStatus]}
              </span>
            </div>
          </div>
        </div>

        {/* Drawer Footer Actions */}
        <div className="shrink-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 p-4 sm:px-6">
          <Button
            className="text-xs"
            onClick={onClose}
            variant="outline"
          >
            Đóng
          </Button>

          <div className="flex items-center gap-2">
            {isActive ? (
              <a
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#091426] px-4 text-xs font-semibold text-white shadow-xs transition hover:bg-[#132747]"
                href={module.launchUrl}
              >
                Mở ứng dụng ngay
                <ExternalLink className="size-4" />
              </a>
            ) : isProvisioning ? (
              <Button
                className="gap-2 border-blue-200 bg-blue-50 text-xs text-blue-700 hover:bg-blue-50"
                disabled
              >
                <Loader2 className="size-4 animate-spin" />
                Hệ thống đang khởi tạo...
              </Button>
            ) : (
              <Button
                className={cn(
                  'gap-2 text-xs font-semibold',
                  isRequested
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                    : 'bg-blue-600 hover:bg-blue-700 text-white',
                )}
                disabled={!canRequestActivation || isRequesting || isRequested}
                onClick={onRequest}
              >
                {isRequesting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : isRequested ? (
                  <Check className="size-4" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {isRequested
                  ? 'Đã ghi nhận yêu cầu'
                  : canRequestActivation
                    ? 'Gửi yêu cầu kích hoạt'
                    : 'Chỉ dành cho Tenant Admin'}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
