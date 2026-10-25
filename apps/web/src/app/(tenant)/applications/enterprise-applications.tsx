'use client';

import { authFetch } from '@enterprise-platform/shared-ui';
import type {
  ModuleActivationRequestResponse,
  TenantEntitlementStatus,
  TenantModuleCatalogItem,
} from '@enterprise-platform/contracts-tenancy';
import { isLauncherOnlyModule, openAssistant } from '@enterprise-platform/feature-module-shell';
import {
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Package,
  PackageOpen,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { CollapsibleGroup } from '../collapsible-group';

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
  assistant: {
    category: 'Ứng dụng mở rộng',
    tagline: 'Hỏi cách dùng bất kỳ trang nào và tra số liệu trong phạm vi quyền của người hỏi.',
    accentColor: {
      bg: 'bg-yellow-50/70',
      border: 'border-yellow-200/80',
      text: 'text-yellow-800',
      iconBg: 'bg-yellow-100 text-yellow-800',
    },
    features: [
      'Hướng dẫn thao tác theo Hướng dẫn sử dụng, kèm link mở thẳng trang ERP',
      'Biết trang đang mở để trả lời câu hỏi "trang này dùng thế nào"',
      'Đọc tồn kho, phiếu bảo trì, đơn từ, phép năm, công việc và hồ sơ quy trình bằng quyền của người hỏi',
      'Mở từ nút Trợ lý ở mọi phân hệ, dùng chung phiên đăng nhập ERP',
    ],
    targetRoles: ['Toàn thể nhân sự'],
    businessValue:
      'Người dùng tự tra cách làm và số liệu của mình ngay trên ERP, giảm câu hỏi lặp lại gửi tới quản trị viên.',
  },
  shared: {
    category: 'Nền tảng dùng chung',
    tagline: 'Kho tài liệu công ty có phiên bản, thông tin hợp đồng và hạn hiệu lực, dùng chung cho mọi phòng ban.',
    accentColor: {
      bg: 'bg-stone-50/70',
      border: 'border-stone-200/80',
      text: 'text-stone-800',
      iconBg: 'bg-stone-100 text-stone-800',
    },
    features: [
      'Cây thư mục nhiều cấp theo phòng ban, năm, loại hồ sơ',
      'Số hiệu, đối tác, ngày ký và hạn hiệu lực cho cả thư mục hợp đồng lẫn từng tài liệu',
      'Giữ mọi phiên bản, khoá khi đang sửa, nhật ký xem và tải xuống',
      'Độ mật Nội bộ, Hạn chế, Mật',
      'Một hạn mức dung lượng chung cho tệp của mọi phân hệ',
    ],
    targetRoles: ['Văn thư, Hành chính', 'Kinh doanh', 'Ban Tổng giám đốc'],
    businessValue:
      'Hợp đồng, quyết định và văn bản của công ty nằm một chỗ, tìm được theo số hiệu, đối tác và hạn hiệu lực.',
  },
  social: {
    category: 'Nền tảng dùng chung',
    tagline: 'Mạng nội bộ của công ty: bảng tin, thông báo và trao đổi giữa các phòng ban.',
    accentColor: {
      bg: 'bg-rose-50/70',
      border: 'border-rose-200/80',
      text: 'text-rose-700',
      iconBg: 'bg-rose-100 text-rose-700',
    },
    features: [
      'Bảng tin công ty với bài viết, thông báo và chuyên mục',
      'Ghim bài quan trọng, đính kèm ảnh và tệp',
      'Phản ứng, bình luận lồng hai cấp và nhắc tên đồng nghiệp',
      'Kiểm duyệt bài viết và bình luận theo quyền',
    ],
    targetRoles: ['Toàn thể nhân sự', 'Truyền thông nội bộ', 'Ban Tổng giám đốc'],
    businessValue:
      'Tin tức và thông báo của công ty đến đúng người ngay trên ERP, thay cho tin nhắn rời rạc qua nhiều kênh.',
  },
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
  finance: {
    category: 'Tài chính & Quản trị',
    tagline: 'Lập và duyệt phiếu thu, phiếu chi, lệnh chuyển tiền; theo dõi tài khoản và dòng tiền.',
    accentColor: {
      bg: 'bg-emerald-50/70',
      border: 'border-emerald-200/80',
      text: 'text-emerald-700',
      iconBg: 'bg-emerald-100 text-emerald-700',
    },
    features: [
      'Phiếu thu, phiếu chi và lệnh chuyển tiền duyệt qua quy trình, ghi sổ tài khoản khi duyệt',
      'Danh sách tài khoản ngân hàng và quỹ tiền mặt với số dư theo sổ cái',
      'Khoá sổ kỳ kế toán và tách người lập, người duyệt để kiểm soát chi',
      'Báo cáo thu chi, dòng tiền theo kỳ, theo lý do và theo đơn vị',
    ],
    targetRoles: ['Kế toán trưởng', 'Kế toán viên', 'Giám đốc Tài chính (CFO)'],
    businessValue:
      'Kiểm soát dòng tiền công ty trên một nơi: mọi khoản thu chi có người lập, người duyệt và dấu vết kiểm toán.',
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
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'active' | 'not-active'>('all');
  // Khung chi tiết mở sẵn ứng dụng đầu tiên, nằm cạnh danh sách thay cho ngăn kéo.
  const [selectedModule, setSelectedModule] = useState<TenantModuleCatalogItem | null>(
    () => initialModules[0] ?? null,
  );
  // Màn hẹp: khung chi tiết rơi xuống dưới danh sách, nên bấm "Chi tiết" thì cuộn tới nó.
  const [revealPanel, setRevealPanel] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const [requestingKey, setRequestingKey] = useState<string>();
  const [requestedKeys, setRequestedKeys] = useState<Set<string>>(() => new Set());

  // Metrics
  const totalCount = initialModules.length;
  const activeCount = initialModules.filter((m) => m.entitlementStatus === 'active').length;

  // Lọc danh sách danh mục có sẵn
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const m of initialModules) {
      const info = getModuleInfo(m.key, m.name, m.description);
      cats.add(info.category);
    }
    return Array.from(cats);
  }, [initialModules]);

  // Bộ lọc modules
  const filteredModules = useMemo(() => {
    const normQuery = query.trim().toLocaleLowerCase('vi');
    return initialModules.filter((module) => {
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
  }, [initialModules, query, selectedCategory, selectedStatus]);

  useEffect(() => {
    if (!revealPanel) return;
    setRevealPanel(false);
    panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [revealPanel]);

  async function requestActivation(module: TenantModuleCatalogItem) {
    setRequestingKey(module.key);
    try {
      const response = await authFetch(
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
      // Sonner hiển thị thẳng giá trị `loading` làm nội dung toast, nên ở đây chỉ
      // nhận chuỗi; truyền object {title, description} như bước success là vỡ trang.
      loading: `Đang gửi yêu cầu kích hoạt module ${module.name} tới ban quản trị...`,
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

  const resetFilters = () => {
    setQuery('');
    setSelectedCategory('all');
    setSelectedStatus('all');
  };

  // Nhóm theo trạng thái; danh mục thành nhãn trên từng dòng.
  const groups = [
    {
      id: 'active',
      title: 'Đang hoạt động',
      tone: 'bg-emerald-100 text-emerald-800',
      rows: filteredModules.filter((module) => module.entitlementStatus === 'active'),
    },
    {
      id: 'inactive',
      title: 'Chưa kích hoạt',
      tone: 'bg-slate-100 text-slate-700',
      rows: filteredModules.filter((module) => module.entitlementStatus !== 'active'),
    },
  ].filter((group) => group.rows.length > 0);

  const openDetails = (module: TenantModuleCatalogItem) => {
    setSelectedModule(module);
    setRevealPanel(true);
  };

  return (
    <div className="flex flex-col gap-4 text-[14px] text-[#18181b]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-[1_1_420px]">
          <h1 className="m-0 text-[20px] font-bold tracking-[-0.3px]">Ứng dụng Doanh nghiệp</h1>
          <p className="mt-1 text-[14px] text-slate-600">
            Khám phá, quản trị và khởi tạo các module phân hệ nghiệp vụ vận hành cho tổ chức của bạn.
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-[#ffc90a]/45 bg-[#fffbeb] px-3 py-1.5 text-[13px] font-semibold text-[#8a6400]">
          <Sparkles className="size-3.5" aria-hidden />
          Gói Doanh nghiệp Enterprise
        </span>
      </div>

      {initialError ? (
        <p
          className="m-0 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {initialError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex h-[38px] min-w-0 flex-[1_1_200px] items-center gap-2 rounded-lg border border-[#eef0f3] bg-white px-3 text-slate-500 focus-within:border-[#ffc90a]">
              <Search className="size-4 shrink-0" aria-hidden />
              <input
                aria-label="Tìm ứng dụng"
                className="min-w-0 flex-1 bg-transparent text-[14px] text-[#18181b] outline-none placeholder:text-slate-400"
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Tìm kiếm theo tên, chức năng, danh mục..."
                type="search"
                value={query}
              />
            </label>

            <div
              aria-label="Lọc theo trạng thái"
              className="flex max-w-full gap-0.5 overflow-x-auto rounded-[9px] bg-[#f1f3f6] p-[3px]"
              role="group"
            >
              {(
                [
                  ['all', `Tất cả (${totalCount})`],
                  ['active', `Đang hoạt động (${activeCount})`],
                  ['not-active', `Chưa kích hoạt (${totalCount - activeCount})`],
                ] as const
              ).map(([value, label]) => {
                const pressed = selectedStatus === value;
                return (
                  <button
                    aria-pressed={pressed}
                    className={cn(
                      'h-8 cursor-pointer whitespace-nowrap rounded-[7px] px-3 text-[13px] font-semibold',
                      pressed
                        ? cn('bg-white shadow-[0_1px_2px_rgba(0,0,0,.08)]', value === 'active' ? 'text-emerald-700' : 'text-[#18181b]')
                        : 'text-slate-500 hover:text-[#18181b]',
                    )}
                    key={value}
                    onClick={() => setSelectedStatus(value)}
                    type="button"
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <select
              aria-label="Danh mục"
              className="h-[38px] rounded-lg border border-[#eef0f3] bg-white px-2.5 text-[14px] text-slate-700"
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

            {query || selectedCategory !== 'all' || selectedStatus !== 'all' ? (
              <button
                className="flex h-[38px] cursor-pointer items-center gap-1 rounded-lg px-2.5 text-[14px] font-semibold text-slate-500 hover:bg-[#f4f6f9] hover:text-[#18181b]"
                onClick={resetFilters}
                type="button"
              >
                <X className="size-3.5" aria-hidden />
                Đặt lại
              </button>
            ) : null}
          </div>

          {groups.map((group) => (
            <CollapsibleGroup
              count={group.rows.length}
              icon={<Package className="size-4" />}
              key={group.id}
              title={group.title}
              tone={group.tone}
            >
              <div className="sm:overflow-x-auto">
                <div className="sm:min-w-[600px]">
                  {group.rows.map((module) => (
                    <ApplicationRow
                      canRequestActivation={canRequestActivation}
                      isRequested={requestedKeys.has(module.key)}
                      isRequesting={requestingKey === module.key}
                      isSelected={selectedModule?.key === module.key}
                      key={module.key}
                      module={module}
                      onRequest={() => handleTriggerActivation(module)}
                      onViewDetails={() => openDetails(module)}
                    />
                  ))}
                </div>
              </div>
            </CollapsibleGroup>
          ))}

          {groups.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center rounded-[14px] border border-dashed border-slate-200 bg-white p-8 text-center">
              <PackageOpen className="mb-3 size-10 text-slate-300" aria-hidden />
              <h3 className="text-sm font-semibold text-slate-800">
                Không tìm thấy ứng dụng nào phù hợp
              </h3>
              <p className="mt-1 max-w-sm text-xs text-slate-500">
                Thử thay đổi từ khóa tìm kiếm hoặc đặt lại các bộ lọc danh mục và trạng thái.
              </p>
              <button
                className="mt-4 h-8 cursor-pointer rounded-lg border border-[#eef0f3] bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-[#f4f6f9]"
                onClick={resetFilters}
                type="button"
              >
                Xóa bộ lọc
              </button>
            </div>
          ) : null}
        </div>

        {selectedModule ? (
          <ModuleDetailPanel
            canRequestActivation={canRequestActivation}
            isRequested={requestedKeys.has(selectedModule.key)}
            isRequesting={requestingKey === selectedModule.key}
            module={selectedModule}
            onClose={() => setSelectedModule(null)}
            onRequest={() => handleTriggerActivation(selectedModule)}
            panelRef={panelRef}
          />
        ) : null}
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<
  TenantEntitlementStatus,
  { label: string; badge: string; dot: string }
> = {
  active: { label: 'Đang hoạt động', badge: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
  provisioning: { label: 'Đang khởi tạo', badge: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500' },
  failed: { label: 'Lỗi kích hoạt', badge: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  disabled: { label: 'Tạm dừng', badge: 'bg-amber-100 text-[#8a6400]', dot: 'bg-amber-500' },
  'not-entitled': { label: 'Khả dụng', badge: 'bg-[#f1f3f6] text-slate-700', dot: 'bg-slate-400' },
};

function ModuleTile({ module, className }: { module: TenantModuleCatalogItem; className: string }) {
  const info = getModuleInfo(module.key, module.name, module.description);
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center font-extrabold', info.accentColor.iconBg, className)}
    >
      {(module.icon || module.key.slice(0, 2)).toUpperCase()}
    </span>
  );
}

function StatusBadge({ status }: { status: TenantEntitlementStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold',
        style.badge,
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', style.dot)} />
      {style.label}
    </span>
  );
}

/** Nút chính của một ứng dụng: mở nếu đang hoạt động, còn lại là gửi yêu cầu kích hoạt. */
function ModuleAction({
  canRequestActivation,
  isRequested,
  isRequesting,
  module,
  onRequest,
  size,
}: {
  canRequestActivation: boolean;
  isRequested: boolean;
  isRequesting: boolean;
  module: TenantModuleCatalogItem;
  onRequest: () => void;
  size: 'row' | 'panel';
}) {
  const box = cn(
    'whitespace-nowrap',
    size === 'row' ? 'h-8 rounded-[7px] px-3 text-[13px]' : 'h-9 rounded-lg px-3.5 text-[14px]',
  );
  if (module.entitlementStatus === 'active' && isLauncherOnlyModule(module.key)) {
    // Trợ lý không có trang riêng: mở ngăn chat của khung chung thay vì chuyển trang.
    return (
      <button
        className={cn('flex cursor-pointer items-center gap-1.5 bg-[#18181b] font-semibold text-white hover:bg-[#2a2a2f]', box)}
        onClick={openAssistant}
        type="button"
      >
        {size === 'row' ? 'Truy cập' : 'Mở Trợ lý'}
        <Sparkles className="size-3.5" aria-hidden />
      </button>
    );
  }
  if (module.entitlementStatus === 'active') {
    return (
      <a
        className={cn('flex items-center gap-1.5 bg-[#18181b] font-semibold text-white hover:bg-[#2a2a2f]', box)}
        href={module.launchUrl}
      >
        {size === 'row' ? 'Truy cập' : 'Mở ứng dụng ngay'}
        <ExternalLink className="size-3.5" aria-hidden />
      </a>
    );
  }
  if (module.entitlementStatus === 'provisioning') {
    return (
      <span className={cn('flex items-center gap-1.5 bg-blue-50 font-semibold text-blue-700', box)}>
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        {size === 'row' ? 'Đang khởi tạo' : 'Hệ thống đang khởi tạo...'}
      </span>
    );
  }
  return (
    <button
      className={cn(
        'flex cursor-pointer items-center gap-1.5 font-bold disabled:cursor-not-allowed',
        isRequested
          ? 'bg-emerald-50 text-emerald-700'
          : 'bg-[#ffc90a] text-[#18181b] hover:bg-[#ffd84d] disabled:opacity-60',
        box,
      )}
      disabled={!canRequestActivation || isRequesting || isRequested}
      onClick={onRequest}
      type="button"
    >
      {isRequesting ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : isRequested ? (
        <Check className="size-3.5" aria-hidden />
      ) : (
        <Sparkles className="size-3.5" aria-hidden />
      )}
      {size === 'row'
        ? isRequested
          ? 'Đã gửi yêu cầu'
          : 'Kích hoạt'
        : isRequested
          ? 'Đã ghi nhận yêu cầu'
          : canRequestActivation
            ? 'Gửi yêu cầu kích hoạt'
            : 'Chỉ dành cho Tenant Admin'}
    </button>
  );
}

function ApplicationRow({
  canRequestActivation,
  isRequested,
  isRequesting,
  isSelected,
  module,
  onRequest,
  onViewDetails,
}: {
  canRequestActivation: boolean;
  isRequested: boolean;
  isRequesting: boolean;
  isSelected: boolean;
  module: TenantModuleCatalogItem;
  onRequest: () => void;
  onViewDetails: () => void;
}) {
  const info = getModuleInfo(module.key, module.name, module.description);
  return (
    <div
      className={cn(
        // Màn hẹp: nút thao tác xuống dòng dưới tên, không phải cuộn ngang mới thấy.
        'grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t border-[#f1f3f6] px-4 py-3 sm:grid-cols-[40px_minmax(200px,1fr)_76px_140px_200px] sm:px-5',
        isSelected ? 'bg-[#fffbeb] shadow-[inset_3px_0_0_#ffc90a]' : 'bg-white',
      )}
    >
      <ModuleTile className="size-10 rounded-[10px] text-xs" module={module} />
      <div className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <b className="max-w-full shrink-0 truncate font-semibold">{module.name}</b>
          <span className="min-w-0 truncate whitespace-nowrap rounded-[5px] bg-[#f1f3f6] px-[7px] text-[12px] font-semibold text-slate-600">
            {info.category}
          </span>
        </span>
        <span className="truncate text-[13px] text-slate-500">
          {module.description || info.tagline}
        </span>
      </div>
      <span className="hidden justify-self-start rounded-md bg-[#f1f3f6] px-[7px] py-px font-mono text-[12px] text-slate-700 sm:block">
        v{module.version}
      </span>
      <span className="hidden justify-self-start sm:block">
        <StatusBadge status={module.entitlementStatus} />
      </span>
      <div className="col-start-2 flex gap-1.5 sm:col-start-auto sm:justify-end">
        <button
          aria-pressed={isSelected}
          className="h-8 cursor-pointer whitespace-nowrap rounded-[7px] border border-[#eef0f3] bg-white px-2.5 text-[13px] font-semibold text-slate-700 hover:bg-[#f4f6f9]"
          onClick={onViewDetails}
          type="button"
        >
          Chi tiết
        </button>
        <ModuleAction
          canRequestActivation={canRequestActivation}
          isRequested={isRequested}
          isRequesting={isRequesting}
          module={module}
          onRequest={onRequest}
          size="row"
        />
      </div>
    </div>
  );
}

function PanelHeading({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.6px] text-slate-500">
      <span aria-hidden className="h-3.5 w-[3px] rounded-sm bg-[#ffc90a]" />
      {children}
    </span>
  );
}

function ModuleDetailPanel({
  canRequestActivation,
  isRequested,
  isRequesting,
  module,
  onClose,
  onRequest,
  panelRef,
}: {
  canRequestActivation: boolean;
  isRequested: boolean;
  isRequesting: boolean;
  module: TenantModuleCatalogItem;
  onClose: () => void;
  onRequest: () => void;
  panelRef: RefObject<HTMLElement | null>;
}) {
  const info = getModuleInfo(module.key, module.name, module.description);
  return (
    <aside
      aria-label="Chi tiết ứng dụng"
      className="flex max-w-full flex-[1_1_340px] scroll-mt-4 flex-col overflow-hidden rounded-[14px] border border-[#eef0f3] bg-white lg:sticky lg:top-4"
      ref={panelRef}
    >
      <div className="flex flex-col gap-2.5 border-b border-[#eef0f3] bg-[#fafbfc] px-5 py-[18px]">
        <div className="flex items-start gap-3">
          <ModuleTile className="size-[52px] rounded-xl text-[16px]" module={module} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-[12px] font-bold tracking-[0.6px] text-slate-500">
              {info.category.toUpperCase()}
              <span className="rounded-[5px] border border-[#eef0f3] bg-white px-1.5 font-mono font-medium tracking-normal">
                v{module.version}
              </span>
            </span>
            <h2 className="m-0 text-lg font-bold">{module.name}</h2>
          </div>
          <button
            aria-label="Đóng chi tiết"
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-[#eef0f3] bg-white text-slate-600 hover:bg-[#f4f6f9]"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <StatusBadge status={module.entitlementStatus} />
          <span aria-hidden>•</span>
          <span>
            Mã module: <code className="font-mono text-slate-700">{module.key}</code>
          </span>
        </div>
        <p className="m-0 text-[14px] text-slate-600">{info.tagline}</p>
      </div>

      <div className="flex flex-col gap-[18px] px-5 py-[18px]">
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-[#ffc90a]/35 bg-[#fffbeb] px-3.5 py-3">
          <span className="flex items-center gap-1.5 text-[14px] font-bold text-[#8a6400]">
            <Zap className="size-3.5" aria-hidden />
            Giá trị mang lại cho doanh nghiệp
          </span>
          <p className="m-0 text-[14px] text-slate-700">{info.businessValue}</p>
        </div>

        <div className="flex flex-col gap-2">
          <PanelHeading>CÁC PHÂN HỆ &amp; TÍNH NĂNG CỐT LÕI</PanelHeading>
          {info.features.map((feature) => (
            <div
              className="flex items-start gap-2 rounded-[9px] border border-[#f1f3f6] px-3 py-[9px] text-[14px]"
              key={feature}
            >
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
              <span>{feature}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <PanelHeading>ĐỐI TƯỢNG &amp; VAI TRÒ ÁP DỤNG</PanelHeading>
          <div className="flex flex-wrap gap-1.5">
            {info.targetRoles.map((role) => (
              <span className="rounded-full bg-[#f1f3f6] px-2.5 py-[3px] text-[13px] text-slate-700" key={role}>
                {role}
              </span>
            ))}
          </div>
        </div>

        <dl className="m-0 grid grid-cols-[112px_1fr] gap-x-3 gap-y-2 rounded-[10px] border border-[#f1f3f6] bg-[#fafbfc] px-3.5 py-3 text-[13px]">
          <dt className="text-slate-500">Đường dẫn khởi chạy</dt>
          <dd className="m-0 break-all font-mono text-slate-700">{module.launchUrl}</dd>
          <dt className="text-slate-500">Tiêu chuẩn bảo mật</dt>
          <dd className="m-0 flex items-center gap-1.5 text-slate-700">
            <ShieldCheck className="size-3.5 shrink-0 text-emerald-700" aria-hidden />
            CSRF Protected • Multi-tenant Isolation
          </dd>
          <dt className="text-slate-500">Trạng thái phân bổ</dt>
          <dd className="m-0 font-semibold text-slate-700">{statusLabel[module.entitlementStatus]}</dd>
        </dl>
      </div>

      <div className="mt-auto flex justify-between gap-2 border-t border-[#eef0f3] px-5 py-3.5">
        <button
          className="h-9 cursor-pointer rounded-lg border border-[#eef0f3] bg-white px-3.5 text-[14px] font-semibold text-slate-700 hover:bg-[#f4f6f9]"
          onClick={onClose}
          type="button"
        >
          Đóng
        </button>
        <ModuleAction
          canRequestActivation={canRequestActivation}
          isRequested={isRequested}
          isRequesting={isRequesting}
          module={module}
          onRequest={onRequest}
          size="panel"
        />
      </div>
    </aside>
  );
}
