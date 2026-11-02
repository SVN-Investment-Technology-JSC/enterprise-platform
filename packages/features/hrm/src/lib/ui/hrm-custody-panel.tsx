'use client';

import { Package } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getCsrfToken } from '../hrm-api';
import { ProfileCard } from './profile-cards';

/** Phần của bản ghi tài sản Kho mà thẻ này hiển thị. */
interface CustodyItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly unit?: string;
  readonly serialNumber?: string;
  readonly assetCategory?: string;
  readonly assignedAt?: string;
}

const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  INDUSTRIAL: 'Thiết bị công nghiệp',
  IT_OFFICE: 'Thiết bị CNTT, văn phòng',
  TOOL_PPE: 'Dụng cụ, bảo hộ',
  VEHICLE: 'Phương tiện',
};

function formatDate(value?: string): string {
  if (!value) return '----';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '----' : date.toLocaleDateString('vi-VN');
}

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly items: readonly CustodyItem[] };

/**
 * Thẻ "Vật tư": tài sản công ty đang cấp phát cho nhân viên.
 *
 * Dữ liệu thuộc phân hệ Kho nên chỉ đọc qua API của Kho, không có bản sao trong
 * HRM. Người không có quyền xem Kho nhận 403; thẻ báo rõ thay vì hiện danh sách
 * rỗng, vì "không có quyền" khác hẳn "chưa được cấp gì".
 */
export function HrmCustodyPanel({ employeeId }: { employeeId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetch(`/api/inventory/v1/custody/employees/${encodeURIComponent(employeeId)}`, {
      credentials: 'include',
      signal: controller.signal,
      headers: { 'x-csrf-token': getCsrfToken() },
    })
      .then(async (response) => {
        if (response.status === 403) {
          setState({ status: 'error', message: 'Bạn không có quyền xem vật tư cấp phát (cần quyền đọc Kho).' });
          return;
        }
        if (!response.ok) {
          setState({ status: 'error', message: 'Không tải được danh sách vật tư từ Kho.' });
          return;
        }
        const body = (await response.json()) as CustodyItem[] | { data?: CustodyItem[] };
        const items = Array.isArray(body) ? body : (body.data ?? []);
        setState({ status: 'ready', items });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setState({ status: 'error', message: 'Không kết nối được phân hệ Kho.' });
      });
    return () => controller.abort();
  }, [employeeId]);

  return (
    <ProfileCard
      icon={Package}
      title="Vật tư"
      testId="hrm-custody-card"
      badge={
        state.status === 'ready' ? (
          <span className="text-xs font-semibold text-slate-500">{state.items.length}</span>
        ) : undefined
      }
    >
      {state.status === 'loading' && <p className="text-sm text-slate-500">Đang tải…</p>}
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-amber-700">
          {state.message}
        </p>
      )}
      {state.status === 'ready' && state.items.length === 0 && (
        <p className="py-2 text-sm italic text-slate-500">Chưa được cấp phát vật tư, tài sản nào.</p>
      )}
      {state.status === 'ready' && state.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2 pr-3">Mã</th>
                <th className="py-2 pr-3">Tên tài sản</th>
                <th className="py-2 pr-3">Nhóm</th>
                <th className="py-2 pr-3">Số sê-ri</th>
                <th className="py-2">Ngày cấp</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3 font-mono text-[13px]">{item.code}</td>
                  <td className="py-2 pr-3 font-medium text-slate-900">{item.name}</td>
                  <td className="py-2 pr-3">
                    {(item.assetCategory && CATEGORY_LABEL[item.assetCategory]) || '----'}
                  </td>
                  <td className="py-2 pr-3">{item.serialNumber || '----'}</td>
                  <td className="py-2">{formatDate(item.assignedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ProfileCard>
  );
}
