import Link from 'next/link';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  KeyRound,
  Layers,
  LockKeyhole,
  Server,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { SessionRecovery } from './_components/session-recovery';

export default function PortalChooserPage() {
  return (
    <main className="flex min-h-screen w-full flex-col lg:flex-row bg-[#07152c] text-slate-800 antialiased font-sans selection:bg-blue-500/20">
      <SessionRecovery />

      {/* LEFT SECTION: BRAND HERO & ARCHITECTURAL FOUNDATION */}
      <section className="relative flex w-full flex-col justify-between overflow-hidden bg-gradient-to-br from-[#07152c] via-[#091f3d] to-[#040e1f] p-8 sm:p-12 lg:w-[48%] xl:w-[44%] 2xl:w-[40%] lg:p-16 text-white border-b lg:border-b-0 lg:border-r border-white/10 shadow-2xl">
        {/* Ambient Glows & Dot Grid */}
        <div className="pointer-events-none absolute -right-20 -top-20 size-96 rounded-full bg-blue-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-20 size-96 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:24px_24px] opacity-40" />

        {/* Top Brand Logo */}
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/25">
              <Layers className="size-5.5" />
            </div>
            <div>
              <span className="block text-base font-bold tracking-tight text-white leading-none">
                Enterprise Platform
              </span>
              <span className="block text-xs font-medium text-slate-400 mt-1">
                Multi-Tenant Architecture
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-md px-3 py-1 border border-white/15 text-[11px] font-medium text-slate-200">
            <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>99.99% SLA Uptime</span>
          </div>
        </div>

        {/* Center: Hero Heading & Context */}
        <div className="relative z-10 my-auto py-10 max-w-xl">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-300 border border-blue-400/20 mb-4">
            <Sparkles className="size-3.5" />
            <span>Phân vùng Cổng truy cập Độc lập</span>
          </div>

          <h1 className="text-3xl sm:text-4xl xl:text-5xl font-extrabold tracking-tight text-white leading-[1.15]">
            Chọn đúng cổng <br />
            <span className="bg-gradient-to-r from-blue-400 via-indigo-300 to-teal-300 bg-clip-text text-transparent">
              cho đúng vai trò.
            </span>
          </h1>

          <p className="mt-4 text-sm sm:text-base text-slate-300 leading-relaxed font-normal">
            Platform Admin quản trị toàn bộ hạ tầng, thiết lập tenant và kích hoạt module.
            Tenant Admin và nhân sự doanh nghiệp truy cập portal trực tiếp để vận hành quy trình nội bộ.
          </p>

          {/* Three-step architectural flow */}
          <div className="mt-8 rounded-2xl bg-white/[0.05] backdrop-blur-md border border-white/10 p-5">
            <div className="text-[11px] font-bold tracking-wider text-slate-400 uppercase mb-3">
              Mô hình Bảo mật & Cấp phát 3 lớp
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center" aria-label="Luồng truy cập">
              <div className="flex flex-col items-center p-2.5 rounded-xl bg-white/5 border border-white/10">
                <KeyRound className="size-4 text-blue-400 mb-1.5" />
                <span className="text-xs font-bold text-white">Identity</span>
                <span className="text-[10px] text-slate-400 mt-0.5">Xác thực tập trung</span>
              </div>
              <div className="flex flex-col items-center p-2.5 rounded-xl bg-white/5 border border-white/10">
                <ShieldCheck className="size-4 text-indigo-400 mb-1.5" />
                <span className="text-xs font-bold text-white">Authorization</span>
                <span className="text-[10px] text-slate-400 mt-0.5">Phân quyền RBAC</span>
              </div>
              <div className="flex flex-col items-center p-2.5 rounded-xl bg-white/5 border border-white/10">
                <Workflow className="size-4 text-emerald-400 mb-1.5" />
                <span className="text-xs font-bold text-white">Entitlement</span>
                <span className="text-[10px] text-slate-400 mt-0.5">Module nghiệp vụ</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Trust Badges */}
        <div className="relative z-10 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 text-blue-400" />
            <span>Phân lập dữ liệu hoàn toàn</span>
          </div>
          <div className="flex items-center gap-1.5">
            <LockKeyhole className="size-3.5 text-blue-400" />
            <span>Mã hóa TLS 1.3 đầu cuối</span>
          </div>
        </div>
      </section>

      {/* RIGHT SECTION: PORTAL CHOOSER CARDS */}
      <section
        className="flex flex-1 flex-col justify-between bg-[#f6f8fb] p-8 sm:p-12 lg:p-16 overflow-y-auto"
        aria-labelledby="portal-heading"
      >
        <div className="mx-auto w-full max-w-2xl my-auto">
          {/* Header */}
          <div className="mb-8">
            <small className="text-xs font-bold tracking-wider text-blue-600 uppercase">
              Hai vùng truy cập độc lập
            </small>
            <h2
              id="portal-heading"
              className="mt-1.5 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900"
            >
              Bạn muốn đăng nhập ở đâu?
            </h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Mỗi cổng chỉ chấp nhận đúng loại tài khoản được phân quyền. Vui lòng chọn phân vùng phù hợp với nhiệm vụ của bạn.
            </p>
          </div>

          {/* Cards Grid */}
          <div className="grid gap-5">
            {/* CARD 1: PLATFORM CORE (SUPERADMIN) */}
            <Link
              href="/admin"
              prefetch={true}
              className="group relative flex flex-col sm:flex-row items-start sm:items-center gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-xl hover:shadow-blue-500/10 focus:outline-none focus:ring-4 focus:ring-blue-500/20"
            >
              <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
                <Server className="size-7" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] font-bold tracking-wider text-blue-600 uppercase">
                    Platform Core
                  </span>
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 border border-blue-200/60">
                    Vận hành hệ thống
                  </span>
                </div>
                <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                  Superadmin & Quản trị nền tảng
                </h3>
                <p className="mt-1 text-xs sm:text-sm text-slate-500 leading-relaxed">
                  Quản lý danh sách tenant, cấp phát module registry, phân bổ gói tính năng và kiểm soát bảo mật hệ thống.
                </p>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5">Tenant Registry</span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5">Entitlements</span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5">Audit Logs</span>
                </div>
              </div>

              <div className="sm:self-center shrink-0 w-full sm:w-auto pt-2 sm:pt-0">
                <span className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl bg-blue-50 px-4 py-2.5 text-xs font-bold text-blue-700 group-hover:bg-blue-600 group-hover:text-white transition-all">
                  <span>Vào cổng quản trị →</span>
                </span>
              </div>
            </Link>

            {/* CARD 2: TENANT PORTAL (DOANH NGHIỆP & NHÂN SỰ) */}
            <Link
              href="/tenant/login"
              prefetch={true}
              className="group relative flex flex-col sm:flex-row items-start sm:items-center gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-xl hover:shadow-emerald-500/10 focus:outline-none focus:ring-4 focus:ring-emerald-500/20"
            >
              <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform">
                <Building2 className="size-7" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] font-bold tracking-wider text-emerald-600 uppercase">
                    Tenant Portal
                  </span>
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200/60">
                    Người dùng doanh nghiệp
                  </span>
                </div>
                <h3 className="text-lg font-bold text-slate-900 group-hover:text-emerald-600 transition-colors">
                  Không gian làm việc Doanh nghiệp
                </h3>
                <p className="mt-1 text-xs sm:text-sm text-slate-500 leading-relaxed">
                  Truy cập workspace và các module doanh nghiệp đã đăng ký: quản trị HRM, chấm công, ca kíp, phê duyệt và kho vận.
                </p>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5">Quản trị HRM</span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5">Chấm công & Ca kíp</span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5">Kho vận & Tài sản</span>
                </div>
              </div>

              <div className="sm:self-center shrink-0 w-full sm:w-auto pt-2 sm:pt-0">
                <span className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white transition-all">
                  <span>Vào cổng tenant →</span>
                </span>
              </div>
            </Link>
          </div>

          {/* Quick Notice */}
          <div className="mt-8 rounded-xl border border-slate-200/80 bg-white/60 p-4 text-xs text-slate-500 leading-relaxed text-center sm:text-left flex items-start gap-3">
            <ShieldCheck className="size-4 shrink-0 text-slate-400 mt-0.5" />
            <span>
              Tài khoản do doanh nghiệp hoặc tổ chức cấp phát. Nếu bạn chưa rõ vùng truy cập của mình,
              vui lòng liên hệ Bộ phận CNTT nội bộ để được hướng dẫn.
            </span>
          </div>
        </div>

        {/* Footer */}
        <footer className="pt-6 border-t border-slate-200 text-center text-xs text-slate-400">
          Enterprise Platform · Phiên bản 2026 · Kiến trúc Đa người thuê an toàn
        </footer>
      </section>
    </main>
  );
}
