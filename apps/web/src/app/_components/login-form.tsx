'use client';

import type { LoginPortal, LoginResponse } from '@enterprise-platform/contracts-identity';
import { SearchableSelect, type SearchableSelectOption } from '@enterprise-platform/shared-ui';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  Lock,
  Mail,
  Quote,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { SessionRecovery } from './session-recovery';

interface LoginFormProps {
  portal: LoginPortal;
  eyebrow: string;
  title: string;
  description: string;
}

interface LocalLoginAccount extends SearchableSelectOption {
  readonly password: string;
}

const LOCAL_TENANT_PASSWORD = 'ChangeMe-Docker-Tenant-123';
const LOCAL_LOGIN_ACCOUNTS: readonly LocalLoginAccount[] = [
  { value: 'superadmin@platform.local', label: 'Platform Super Admin', description: 'Platform Core', password: 'ChangeMe-Docker-Superadmin-123' },
  { value: 'admin@savina.local', label: 'Quản trị SAVINA', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'bui.cong.quyen@savina.local', label: 'Bùi Công Quyền', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'bui.duy.khanh@savina.local', label: 'Bùi Duy Khánh', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'bui.huu.van@savina.local', label: 'Bùi Hữu Vân', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'bui.long.quoc.huy@savina.local', label: 'Bùi Long Quốc Huy', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'cao.khanh.ngoc@savina.local', label: 'Cao Khánh Ngọc', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'dau.ba.kien@savina.local', label: 'Đậu Bá Kiên', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'dau.xuan.thanh@savina.local', label: 'Đậu Xuân Thanh', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'do.thanh.phong@savina.local', label: 'Đỗ Thanh Phong', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'dong.trinh.bao@savina.local', label: 'Đồng Trịnh Bảo', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'ha.nguyen.hoang@savina.local', label: 'Hà Nguyên Hoàng', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'huynh.kim.viet@savina.local', label: 'Huỳnh Kim Việt', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'huynh.thi.dong@savina.local', label: 'Huỳnh Thị Đông', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'huynh.thi.hong.nhung@savina.local', label: 'Huỳnh Thị Hồng Nhung', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'huynh.van.trong@savina.local', label: 'Huỳnh Văn Trọng', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'le.minh.tri@savina.local', label: 'Lê Minh Trí', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'le.thi.to.nga@savina.local', label: 'Lê Thị Tố Nga', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'ngo.tan.trinh@savina.local', label: 'Ngô Tấn Trinh', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.duy.thuan@savina.local', label: 'Nguyễn Duy Thuận', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.gia.bao@savina.local', label: 'Nguyễn Gia Bảo', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.hong.sang@savina.local', label: 'Nguyễn Hồng Sang', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.huu.hung@savina.local', label: 'Nguyễn Hữu Hưng', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.minh.y@savina.local', label: 'Nguyễn Minh Ý', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.tan.thinh@savina.local', label: 'Nguyễn Tấn Thịnh', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.thi.diem.my@savina.local', label: 'Nguyễn Thị Diễm My', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.thi.thuy@savina.local', label: 'Nguyễn Thị Thủy', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.tran.nhu.quynh@savina.local', label: 'Nguyễn Trần Như Quỳnh', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.vu.bao.cuong@savina.local', label: 'Nguyễn Vũ Bảo Cường', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.vu.hau@savina.local', label: 'Nguyễn Vũ Hậu', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'pham.viet.quan@savina.local', label: 'Phạm Việt Quân', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'phan.duc.thang@savina.local', label: 'Phan Đức Thắng', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'phan.thi.dieu.thuy@savina.local', label: 'Phan Thị Diệu Thúy', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'phan.trung.kien@savina.local', label: 'Phan Trung Kiên', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'quach.van.quy@savina.local', label: 'Quách Văn Quý', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'ta.quang.hoang@savina.local', label: 'Tạ Quang Hoàng', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'tran.cao.vu@savina.local', label: 'Trần Cao Vũ', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'tran.quang.binh@savina.local', label: 'Trần Quang Bình', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'tran.quoc.vuong@savina.local', label: 'Trần Quốc Vương', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'tran.thi.to.uyen@savina.local', label: 'Trần Thị Tố Uyên', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'tran.thuy.uyen@savina.local', label: 'Trần Thúy Uyên', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'tran.van.cuong@savina.local', label: 'Trần Văn Cường', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'tran.van.quoc@savina.local', label: 'Trần Văn Quốc', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'tran.van.thin@savina.local', label: 'Trần Văn Thìn', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'truong.quang.bao.vuong@savina.local', label: 'Trương Quang Bảo Vương', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'vo.tuan.kiet@savina.local', label: 'Võ Tuấn Kiệt', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'buithih@test.com', label: 'Bùi Thị Hoa', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'dangvang@test.com', label: 'Đặng Văn Giang', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'dinhthil@test.com', label: 'Đinh Thị Lan', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'hoangvane@test.com', label: 'Hoàng Văn Em', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'lequangc@test.com', label: 'Lê Quang Cường', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'maihoangm@test.com', label: 'Mai Hoàng Minh', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'ngothin@test.com', label: 'Ngô Thị Nga', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyenkhoai@test.com', label: 'Nguyễn Khoa Ích', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyenvana@test.com', label: 'Nguyễn Văn An', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'phamthid@test.com', label: 'Phạm Thị Dung', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'phanvano@test.com', label: 'Phan Văn Oanh', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'test@test.com', label: 'test_name', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'tranthib@test.com', label: 'Trần Thị Bình', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'truongvank@test.com', label: 'Trương Văn Khang', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'vothif@test.com', label: 'Võ Thị Phương', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'vuongthip@test.com', label: 'Võ Thị Phúc', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
];

const TESTIMONIALS = [
  {
    quote:
      'Enterprise Platform tối ưu toàn bộ quy trình nhân sự, phê duyệt và điều phối kho vận trong một hệ thống đồng nhất, cắt giảm hơn 40% chi phí vận hành.',
    author: 'Nguyễn Hoàng Nam',
    role: 'Giám đốc Vận hành',
    organization: 'SAVINA Group',
    avatarFallback: 'HN',
  },
  {
    quote:
      'Kiến trúc multi-tenant phân lập dữ liệu triệt để, phân quyền ma trận RBAC chặt chẽ và chuẩn mã hóa đầu cuối mang lại sự yên tâm tuyệt đối cho doanh nghiệp.',
    author: 'Trần Minh Tuấn',
    role: 'Kiến trúc sư Trưởng',
    organization: 'Enterprise Cloud System',
    avatarFallback: 'MT',
  },
  {
    quote:
      'Giao diện chuẩn mực 16:9, thao tác mượt mà và trực quan giúp toàn bộ cán bộ nhân viên hòa nhập ngay từ ngày đầu mà không cần đào tạo phức tạp.',
    author: 'Lê Thùy Chi',
    role: 'Trưởng phòng Nhân sự Cấp cao',
    organization: 'Tập đoàn Đầu tư & Công nghệ',
    avatarFallback: 'TC',
  },
];

export function LoginForm({ portal, eyebrow, title, description }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [ssoMessage, setSsoMessage] = useState<string>();

  const localAccounts =
    LOCAL_LOGIN_ACCOUNTS.filter((account) =>
      portal === 'platform'
        ? account.value === 'superadmin@platform.local'
        : account.value !== 'superadmin@platform.local',
    );
  const [selectedAccount, setSelectedAccount] = useState('');

  // Testimonial Carousel State
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isCarouselPaused, setIsCarouselPaused] = useState(false);

  useEffect(() => {
    if (isCarouselPaused) return;
    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % TESTIMONIALS.length);
    }, 6500);
    return () => clearInterval(interval);
  }, [isCarouselPaused]);

  function selectLocalAccount(accountEmail: string) {
    const account = localAccounts.find((candidate) => candidate.value === accountEmail);
    setSelectedAccount(accountEmail);
    setEmail(accountEmail);
    setPassword(account?.password ?? '');
    setError(undefined);
  }

  function handleSsoLogin(provider: string) {
    setSsoMessage(
      `Đăng nhập ${provider} đang được quản trị viên đồng bộ với Identity Provider của doanh nghiệp. Vui lòng đăng nhập bằng email công vụ bên dưới.`,
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch('/api/auth/v1/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, portal }),
      });
      if (response.status >= 500) {
        throw new Error('Dịch vụ đăng nhập tạm thời chưa sẵn sàng. Vui lòng thử lại sau.');
      }
      const text = await response.text();
      let payload: (LoginResponse & { message?: string }) | null = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        // Response trả về HTML thay vì JSON (ví dụ: trang lỗi của proxy)
      }

      if (!response.ok) {
        throw new Error(
          payload?.message ??
            `Đăng nhập không thành công (${response.status}: ${response.statusText || 'Lỗi kết nối máy chủ'}).`,
        );
      }
      if (!payload?.redirectTo) {
        throw new Error('Phản hồi đăng nhập không hợp lệ. Vui lòng thử lại sau.');
      }
      router.replace(payload.redirectTo);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Đăng nhập không thành công.');
    } finally {
      setBusy(false);
    }
  }

  const isPlatform = portal === 'platform';

  return (
    <main className="flex min-h-screen w-full bg-[#f6f8fb] text-slate-800 antialiased font-sans selection:bg-blue-500/20">
      <SessionRecovery />

      {/* LEFT COLUMN: BRAND HERO & TESTIMONIAL CAROUSEL (HANDO TEMPLATE STYLE) */}
      <section
        className="hidden lg:flex flex-1 flex-col justify-between relative bg-gradient-to-br from-[#07152c] via-[#091f3d] to-[#040e1f] text-white p-10 xl:p-14 overflow-hidden rounded-3xl m-4 shadow-2xl border border-white/10"
        onMouseEnter={() => setIsCarouselPaused(true)}
        onMouseLeave={() => setIsCarouselPaused(false)}
      >
        {/* Ambient Glows & Grid Pattern */}
        <div className="pointer-events-none absolute -right-20 -top-20 size-96 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-20 size-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:24px_24px] opacity-40" />

        {/* Top Badges */}
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-2.5 rounded-full bg-white/10 backdrop-blur-md px-3.5 py-1.5 border border-white/15 text-xs font-medium text-slate-200">
            <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Hệ thống vận hành an toàn · 99.99% Uptime</span>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-300 font-medium">
            <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10">Multi-Tenant</span>
            <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10">ISO 27001</span>
            <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10">Zero-Trust</span>
          </div>
        </div>

        {/* Center: Frosted Glass Testimonial Card */}
        <div className="relative z-10 my-auto mx-auto max-w-xl w-full">
          <div className="rounded-3xl bg-white/[0.07] backdrop-blur-xl border border-white/15 p-8 xl:p-10 shadow-2xl text-center relative overflow-hidden">
            {/* Quote Icon */}
            <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-500/20 to-indigo-500/20 border border-blue-400/30 text-blue-400 shadow-inner">
              <Quote className="size-7" />
            </div>

            {/* Testimonial Quote */}
            <div className="min-h-[110px] flex items-center justify-center">
              <p className="text-base xl:text-lg leading-relaxed text-white/95 font-normal transition-all duration-300">
                "{TESTIMONIALS[currentSlide].quote}"
              </p>
            </div>

            {/* Author Information */}
            <div className="mt-6 flex flex-col items-center">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white shadow-sm">
                  {TESTIMONIALS[currentSlide].avatarFallback}
                </div>
                <div className="text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-sm text-white">
                      {TESTIMONIALS[currentSlide].author}
                    </span>
                    <CheckCircle2 className="size-3.5 text-blue-400" />
                  </div>
                  <span className="text-xs text-slate-300">
                    {TESTIMONIALS[currentSlide].role} · {TESTIMONIALS[currentSlide].organization}
                  </span>
                </div>
              </div>
            </div>

            {/* Carousel Controls & Indicators */}
            <div className="mt-8 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() =>
                  setCurrentSlide(
                    (prev) => (prev - 1 + TESTIMONIALS.length) % TESTIMONIALS.length,
                  )
                }
                aria-label="Nhận xét trước"
                className="flex size-7 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
              >
                <ChevronLeft className="size-4" />
              </button>

              <div className="flex items-center gap-1.5">
                {TESTIMONIALS.map((item, idx) => (
                  <button
                    key={item.author}
                    type="button"
                    onClick={() => setCurrentSlide(idx)}
                    aria-label={`Chuyển đến nhận xét ${idx + 1}`}
                    className={`h-2 transition-all duration-300 rounded-full ${idx === currentSlide
                      ? 'w-7 bg-blue-500'
                      : 'w-2 bg-white/30 hover:bg-white/50'
                      }`}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={() =>
                  setCurrentSlide((prev) => (prev + 1) % TESTIMONIALS.length)
                }
                aria-label="Nhận xét kế tiếp"
                className="flex size-7 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Feature Badges Bar */}
        <div className="relative z-10 grid grid-cols-3 gap-4 pt-4 border-t border-white/10 text-xs">
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-blue-400" />
            <span className="text-slate-300">Quản trị HRM & Chấm công</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-indigo-400" />
            <span className="text-slate-300">Phân quyền RBAC động</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-emerald-400" />
            <span className="text-slate-300">Kiến trúc SaaS linh hoạt</span>
          </div>
        </div>
      </section>

      {/* RIGHT COLUMN: AUTHENTICATION FORM */}
      <section className="flex w-full flex-col justify-between bg-white px-6 py-8 sm:px-12 md:px-16 lg:w-[48%] xl:w-[42%] 2xl:w-[38%] lg:py-10 shadow-xl border-r border-slate-200/80 z-10 overflow-y-auto">
        {/* Top Header & Navigation */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20">
              <Layers className="size-5" />
            </div>
            <div>
              <span className="block text-sm font-bold tracking-tight text-slate-900 leading-none">
                Enterprise Platform
              </span>
              <span className="block text-[11px] font-medium text-slate-500 leading-tight mt-0.5">
                {isPlatform ? 'Hệ thống Quản trị Nền tảng' : 'Hệ thống Doanh nghiệp'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${isPlatform
                ? 'bg-blue-50 text-blue-700 border border-blue-200/60'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                }`}
            >
              {isPlatform ? 'Platform Core' : 'Tenant Portal'}
            </span>
            <Link
              href="/"
              prefetch={true}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              title="Quay lại màn hình chọn cổng"
            >
              <ArrowLeft className="size-3.5" />
              <span className="hidden sm:inline">Chọn cổng</span>
            </Link>
          </div>
        </div>

        {/* Center: Auth Form Container */}
        <div className="my-auto w-full max-w-sm mx-auto py-8">
          <div className="mb-6">
            <small className="text-[11px] font-bold tracking-wider text-blue-600 uppercase">
              {eyebrow}
            </small>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
              {title}
            </h1>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              {description}
            </p>
          </div>

          {/* Social / SSO Auth Buttons */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            <button
              type="button"
              onClick={() => handleSsoLogin('Google')}
              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 active:bg-slate-100"
            >
              <svg className="size-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.36 7.33 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.24C.45 8.16 0 9.94 0 12s.45 3.84 1.24 5.42l4.04-3.15z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                />
              </svg>
              <span>Google</span>
            </button>

            <button
              type="button"
              onClick={() => handleSsoLogin('SSO')}
              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 active:bg-slate-100"
            >
              <ShieldCheck className="size-4 shrink-0 text-blue-600" />
              <span>Đăng nhập SSO</span>
            </button>
          </div>

          {ssoMessage ? (
            <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/80 p-3 text-xs text-blue-800 leading-relaxed">
              {ssoMessage}
            </div>
          ) : null}

          {/* Separator */}
          <div className="relative mb-5 flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <span className="relative bg-white px-3 text-xs text-slate-500 font-medium">
              hoặc đăng nhập bằng email
            </span>
          </div>

          {/* Dev Mode Account Picker */}
          {localAccounts.length ? (
            <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-900">
                  <Sparkles className="size-3.5 text-blue-600" />
                  Tài khoản kiểm thử nhanh (Tự điền)
                </span>
                <span className="text-[11px] text-blue-700/80">Tự điền email & mật khẩu</span>
              </div>
              <SearchableSelect
                options={localAccounts}
                placeholder="Chọn tài khoản để tự điền thông tin"
                searchPlaceholder="Tìm theo tên hoặc email…"
                value={selectedAccount}
                onChange={selectLocalAccount}
                clearable
              />
            </div>
          ) : null}

          {/* Main Credentials Form */}
          <form className="space-y-4" onSubmit={submit}>
            {/* Email Field */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-xs font-semibold text-slate-700">
                Email
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Mail className="size-4" />
                </div>
                <input
                  id="email"
                  name="email"
                  autoComplete="username"
                  autoFocus
                  onChange={(event) => setEmail(event.currentTarget.value)}
                  placeholder="name@company.com"
                  required
                  type="email"
                  value={email}
                  className="block w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9.5 pr-3.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-xs font-semibold text-slate-700">
                Mật khẩu
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Lock className="size-4" />
                </div>
                <input
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  placeholder="••••••••"
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  className="block w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9.5 pr-10 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 transition-colors focus:outline-none"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Remember Me & Forgot Password Row */}
            <div className="flex items-center justify-between pt-0.5">
              <label
                htmlFor="remember-me"
                className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-600"
              >
                <input
                  id="remember-me"
                  name="rememberMe"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Ghi nhớ đăng nhập</span>
              </label>

              <Link
                href="/reset-password"
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
              >
                Quên mật khẩu?
              </Link>
            </div>

            {/* Error Banner */}
            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700"
              >
                <AlertCircle className="size-4 shrink-0 text-red-500 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </div>
            ) : null}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={busy}
              className="group relative flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 text-sm font-semibold text-white shadow-md shadow-blue-500/20 transition-all hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg hover:shadow-blue-500/30 active:scale-[0.99] disabled:opacity-60 disabled:pointer-events-none focus:outline-none focus:ring-4 focus:ring-blue-500/20"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>Đang xác minh…</span>
                </>
              ) : (
                <>
                  <span>Đăng nhập</span>
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          {/* Quick Portal Switcher Note */}
          <div className="mt-6 text-center text-xs text-slate-500">
            {isPlatform ? (
              <p>
                Người dùng doanh nghiệp?{' '}
                <Link
                  href="/tenant/login"
                  className="font-semibold text-blue-600 hover:underline hover:text-blue-700 ml-1"
                >
                  Vào Cổng Doanh nghiệp
                </Link>
              </p>
            ) : (
              <p>
                Quản trị viên hệ thống?{' '}
                <Link
                  href="/admin"
                  className="font-semibold text-blue-600 hover:underline hover:text-blue-700 ml-1"
                >
                  Vào Cổng Superadmin
                </Link>
              </p>
            )}
          </div>
        </div>

        {/* Bottom Footer Notice */}
        <footer className="pt-4 border-t border-slate-100 text-center">
          <p className="text-xs text-slate-500 leading-relaxed">
            {isPlatform
              ? 'Chỉ dành cho người quản trị nền tảng. Dữ liệu vận hành được bảo vệ và kiểm toán tập trung.'
              : 'Tài khoản do doanh nghiệp của bạn cấp. Nếu chưa có tài khoản, vui lòng liên hệ Quản trị viên nội bộ.'}
          </p>
          <div className="mt-2 text-[11px] text-slate-400">
            Enterprise Platform · Multi-tenant SaaS Platform · TLS 1.3
          </div>
        </footer>
      </section>
    </main>
  );
}
