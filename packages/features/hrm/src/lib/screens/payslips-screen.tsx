'use client';
import { useEffect, useState } from 'react';
import { Receipt, Printer, Calendar, AlertTriangle, UserCheck } from 'lucide-react';
import type { HrmPayslip } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

type Snapshot = {
  total: {
    full_name: string;
    employee_code: string;
    gross_salary: string;
    net_salary: string;
  };
  items: { description: string; amount: string }[];
};

export default function PayslipsScreen() {
  const [rows, setRows] = useState<HrmPayslip[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    hrmFetch<{ data: HrmPayslip[] }>('/my-payslips')
      .then((r) => {
        if (active) {
          setRows(r.data);
          setSelected(r.data[0]?.id || '');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);

  const current = rows.find((r) => r.id === selected);
  const snapshot = current?.snapshotJson as unknown as Snapshot | undefined;

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Page Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs print:hidden">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Receipt className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Phiếu lương Cá nhân
            </h1>
            <p className="text-xs text-slate-500 max-w-[85ch]">
              Xem chi tiết cấu thành thu nhập, các khoản khấu trừ bảo hiểm, thuế TNCN và thực lĩnh theo từng kỳ đã phát hành.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            onClick={() => window.print()}
            className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 shadow-xs text-xs"
          >
            <Printer className="size-3.5" />
            <span>In / Lưu PDF</span>
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 shadow-xs flex items-center gap-2 print:hidden"
        >
          <AlertTriangle className="size-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {/* 2. Master-Detail Layout */}
      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Left Aside: Payslips list */}
        <aside className="rounded-xl border border-slate-200 bg-white shadow-xs p-3 flex flex-col print:hidden max-h-[calc(100vh-220px)]">
          <div className="px-2 py-1.5 mb-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Kỳ nhận lương ({rows.length})
            </span>
          </div>
          <div className="space-y-1.5 overflow-y-auto pr-1">
            {rows.length === 0 ? (
              <p className="text-xs text-slate-400 p-2 text-center">Chưa có phiếu lương được phát hành.</p>
            ) : (
              rows.map((r) => {
                const isActive = r.id === selected;
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelected(r.id)}
                    className={`w-full text-left rounded-lg p-2.5 transition-all text-xs border ${
                      isActive
                        ? 'bg-blue-50/80 border-blue-200 text-blue-900 shadow-xs font-medium'
                        : 'border-transparent hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-semibold">{r.payslipNo}</span>
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                        Đã phát hành
                      </Badge>
                    </div>
                    <span className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Calendar className="size-3 text-slate-400" />
                      {new Date(r.issuedAt).toLocaleDateString('vi-VN')}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Section: Payslip Sheet */}
        <div>
          {snapshot && (!snapshot.total || !Array.isArray(snapshot.items)) && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-xs text-slate-500 text-center">
              Phiếu lương cũ chưa có chi tiết chuẩn hóa. Vui lòng liên hệ kế toán để đối chiếu.
            </div>
          )}

          {snapshot?.total && Array.isArray(snapshot.items) && (
            <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
              {/* Header Info */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-200">
                <div className="flex items-center gap-3">
                  <div className="size-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                    <UserCheck className="size-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      {snapshot.total.full_name}
                    </h2>
                    <p className="text-xs font-mono text-slate-500">
                      Mã NV: {snapshot.total.employee_code}
                    </p>
                  </div>
                </div>
                {current && (
                  <div className="text-right">
                    <span className="text-xs font-bold text-slate-900 block">{current.payslipNo}</span>
                    <span className="text-[11px] text-slate-500">
                      Ngày phát hành: {new Date(current.issuedAt).toLocaleDateString('vi-VN')}
                    </span>
                  </div>
                )}
              </div>

              {/* Items Table / Breakdown */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-xs font-bold uppercase tracking-wider text-slate-400 px-3 py-1">
                  <span>Khoản mục lương & phụ cấp</span>
                  <span>Số tiền (VND)</span>
                </div>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                  {snapshot.items.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-xs px-3.5 py-2.5 hover:bg-slate-50/50 transition-colors"
                    >
                      <span className="text-slate-700">{item.description}</span>
                      <strong className="text-slate-900 font-mono">
                        {Number(item.amount).toLocaleString('vi-VN')} đ
                      </strong>
                    </div>
                  ))}
                </div>
              </div>

              {/* Net salary card */}
              <div className="bg-emerald-50/70 border border-emerald-200 p-4 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider block">
                    Thực lĩnh chuyển khoản (Net)
                  </span>
                  <span className="text-[11px] text-emerald-600">
                    Đã bao gồm đầy đủ các khoản giảm trừ và thuế TNCN
                  </span>
                </div>
                <span className="text-2xl font-extrabold text-emerald-700 font-mono">
                  {Number(snapshot.total.net_salary).toLocaleString('vi-VN')} đ
                </span>
              </div>
            </article>
          )}

          {!snapshot && rows.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-xs text-slate-400 text-center">
              Chọn một phiếu lương ở danh sách bên trái để xem chi tiết.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
