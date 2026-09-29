import { Loader2 } from 'lucide-react';

export default function TenantLoading() {
  return (
    <div
      className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-3 p-8 text-slate-500"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2 className="size-7 animate-spin text-blue-600" />
      <p className="text-xs font-medium tracking-wide">Đang tải không gian làm việc…</p>
    </div>
  );
}
