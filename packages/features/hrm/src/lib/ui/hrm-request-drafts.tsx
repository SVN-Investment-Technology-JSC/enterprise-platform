'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Button } from './button';
import { Input } from './input';

export interface RequestDraft {
  id: string;
  employeeId: string;
  kind: HrmRequestKind;
  status: 'DRAFT';
  payload: Record<string, unknown>;
  updatedAt: string;
  revision: number;
}
export const requestDraftNames: Record<HrmRequestKind, string> = {
  leave: 'Nghỉ phép',
  ot: 'Làm thêm giờ',
  business_trip: 'Công tác',
  shift_change: 'Đổi ca',
  correction: 'Bổ sung công',
  advance: 'Tạm ứng lương',
  profile_correction: 'Điều chỉnh hồ sơ',
};
const endpoints: Record<HrmRequestKind, string> = {
  leave: 'leave-requests',
  ot: 'ot-requests',
  business_trip: 'business-trip-requests',
  shift_change: 'shift-change-requests',
  correction: 'attendance-corrections',
  advance: 'salary-advance-requests',
  profile_correction: 'profile-corrections',
};
export function HrmRequestDrafts({
  employeeId,
  onEdit,
  onSubmitted,
}: {
  employeeId: string;
  onEdit: (draft: RequestDraft) => Promise<void>;
  onSubmitted: () => Promise<unknown>;
}) {
  const [rows, setRows] = useState<RequestDraft[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  const [query, setQuery] = useState(''),
    [kind, setKind] = useState('');
  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    setError('');
    try {
      const result = await hrmFetch<{ data: RequestDraft[] }>(
        `/request-drafts?employee_id=${encodeURIComponent(employeeId)}`,
      );
      setRows(result.data);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'Không tải được bản nháp');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (row: RequestDraft, submit: boolean) => {
    setBusy(row.id);
    setError('');
    try {
      await hrmFetch(
        submit
          ? `/${endpoints[row.kind]}`
          : `/request-drafts/${row.kind}/${row.id}`,
        {
          method: submit ? 'POST' : 'DELETE',
          body: JSON.stringify(
            submit
              ? {
                  employeeId: row.employeeId,
                  draftId: row.id,
                  expectedUpdatedAt: row.updatedAt,
                }
              : { expectedUpdatedAt: row.updatedAt },
          ),
        },
      );
      await load();
      if (submit) await onSubmitted();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Không xử lý được bản nháp',
      );
    } finally {
      setBusy('');
    }
  };
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd');
  const filtered = rows.filter(
    (r) =>
      (!kind || r.kind === kind) &&
      normalize(
        `${requestDraftNames[r.kind]} ${r.payload.reason ?? ''}`,
      ).includes(normalize(query)),
  );
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Tìm loại đơn, lý do…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="w-48">
          <SearchableSelect
            value={kind}
            onChange={(v) => setKind(v || '')}
            options={Object.entries(requestDraftNames).map(
              ([value, label]) => ({ value, label }),
            )}
            placeholder="Tất cả loại đơn"
            clearable
          />
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          Tải lại
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Nháp chưa giữ phép, tính OT hay khởi tạo quy trình. Khi gửi, hệ thống
        kiểm tra lại chính sách và kỳ công hiện hành.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <Table<RequestDraft>
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={filtered}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        scroll={{ x: 960, y: 440 }}
        columns={[
          {
            title: 'Loại đơn',
            dataIndex: 'kind',
            width: 160,
            render: (v: HrmRequestKind) => requestDraftNames[v],
          },
          {
            title: 'Lý do',
            render: (_, r) => String(r.payload.reason || 'Chưa nhập'),
          },
          {
            title: 'Ngày đề nghị',
            width: 125,
            render: (_, r) =>
              String(
                r.payload.fromDate ||
                  r.payload.workDate ||
                  r.payload.requestDate ||
                  '—',
              ),
          },
          {
            title: 'Cập nhật',
            dataIndex: 'updatedAt',
            width: 165,
            render: (v: string) => new Date(v).toLocaleString('vi-VN'),
          },
          {
            title: 'Thao tác',
            fixed: 'right',
            width: 220,
            render: (_, r) => (
              <div className="flex gap-1">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => void onEdit(r)}
                >
                  Sửa
                </Button>
                <Button
                  size="xs"
                  disabled={!!busy}
                  onClick={() => void act(r, true)}
                >
                  Gửi duyệt
                </Button>
                <Popconfirm
                  title="Xóa bản nháp này?"
                  onConfirm={() => act(r, false)}
                >
                  <Button size="xs" variant="destructive" disabled={!!busy}>
                    Xóa
                  </Button>
                </Popconfirm>
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}
