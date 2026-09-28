'use client';
import { useEffect, useState } from 'react';
import type { HrmPayslip } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Button } from '../ui/button';
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
  const [rows, setRows] = useState<HrmPayslip[]>([]),
    [selected, setSelected] = useState(''),
    [error, setError] = useState('');
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
  const current = rows.find((r) => r.id === selected),
    snapshot = current?.snapshotJson as unknown as Snapshot | undefined;
  return (
    <main className="space-y-5 p-6">
      <h1 className="text-2xl font-semibold">Phiếu lương cá nhân</h1>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-2 print:hidden">
          {rows.length === 0 && <p>Chưa có phiếu lương được phát hành.</p>}
          {rows.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelected(r.id)}
              className={`block w-full rounded border p-3 text-left text-sm ${r.id === selected ? 'border-blue-500 bg-blue-50' : ''}`}
            >
              {new Date(r.issuedAt).toLocaleDateString('vi-VN')} · {r.payslipNo}
            </button>
          ))}
        </aside>
        {snapshot && (!snapshot.total || !Array.isArray(snapshot.items)) && (
          <p>
            Phiếu lương cũ chưa có chi tiết chuẩn hóa. Vui lòng liên hệ kế toán
            để đối chiếu.
          </p>
        )}
        {snapshot?.total && Array.isArray(snapshot.items) && (
          <article className="rounded-xl border bg-white p-6">
            <div className="mb-6 flex justify-between">
              <div>
                <h2 className="text-xl font-semibold">
                  {snapshot.total.full_name}
                </h2>
                <p>{snapshot.total.employee_code}</p>
              </div>
              <Button className="print:hidden" onClick={() => window.print()}>
                In / lưu PDF
              </Button>
            </div>
            {snapshot.items.map((item, i) => (
              <div key={i} className="flex justify-between gap-5 border-b py-3">
                <span>{item.description}</span>
                <strong>{Number(item.amount).toLocaleString('vi-VN')} đ</strong>
              </div>
            ))}
            <p className="mt-5 text-right text-xl font-semibold">
              Thực lĩnh:{' '}
              {Number(snapshot.total.net_salary).toLocaleString('vi-VN')} đ
            </p>
          </article>
        )}
      </div>
    </main>
  );
}
