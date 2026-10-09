'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import {
  ListChecks,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  XCircle,
} from 'lucide-react';
import type { HrmLeaveType } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { useHrmPermissions } from '../hrm-permissions';

const yesNo = [
  { value: 'true', label: 'Có' },
  { value: 'false', label: 'Không' },
];

/**
 * Danh mục "Lý do nghỉ phép" (trước đây là "Các loại nghỉ phép" trong màn Quỹ phép).
 * Các trường chuyển phép sang năm đang được ẩn (comment) theo chính sách mới:
 * hết năm reset phép dư về 0, không chuyển sang năm sau.
 */
export default function LeaveReasonsScreen({
  embedded = false,
  onChanged,
}: {
  /** Nhúng trong màn Cấu hình phép: bỏ tiêu đề trang, chỉ giữ mô tả và nút thêm. */
  embedded?: boolean;
  /** Gọi sau khi danh mục thay đổi để màn cha tải lại danh sách lý do. */
  onChanged?: () => void | Promise<void>;
}) {
  const { can } = useHrmPermissions();
  const [types, setTypes] = useState<HrmLeaveType[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null);

  const load = useCallback(async () => {
    const t = await hrmFetch<{ data: HrmLeaveType[] }>('/leave-types');
    setTypes(t.data);
  }, []);
  const reload = useCallback(async () => {
    await load();
    await onChanged?.();
  }, [load, onChanged]);

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);

  async function save(path: string, body: unknown) {
    await hrmFetch(path, { method: 'POST', body: JSON.stringify(body) });
    setMessage('Đã ghi nhận lý do nghỉ phép.');
    await reload();
  }

  function editLeaveType(row: HrmLeaveType, deactivate = false) {
    setAction({
      title: deactivate ? 'Ngừng sử dụng lý do nghỉ' : `Cập nhật ${row.code}`,
      confirmTitle: deactivate ? 'Ngừng lý do nghỉ cho các đơn mới?' : undefined,
      description:
        'Giữ dữ liệu và sổ phép hiện có. Chế độ hưởng lương/trừ quỹ của lý do đã có đơn không được sửa lại.',
      columns: deactivate ? 1 : 3,
      fields: deactivate
        ? [{ key: 'reason', label: 'Lý do', required: true }]
        : [
            {
              key: 'name',
              label: 'Tên lý do nghỉ',
              value: row.name,
              colSpan: 2,
              required: true,
            },
            {
              key: 'active',
              label: 'Đang sử dụng',
              options: yesNo,
              value: String(row.active),
              required: true,
            },
            {
              key: 'paid',
              label: 'Hưởng lương',
              options: yesNo,
              value: String(row.paid),
              required: true,
            },
            {
              key: 'deductBalance',
              label: 'Trừ quỹ phép',
              options: yesNo,
              value: String(row.deductBalance),
              required: true,
            },
            {
              key: 'requiresAttachment',
              label: 'Yêu cầu chứng từ',
              options: yesNo,
              value: String(row.requiresAttachment),
              required: true,
            },
            {
              key: 'negativeLimit',
              label: 'Hạn mức âm phép',
              type: 'number',
              min: 0,
              max: 366,
              step: '0.5',
              value: row.negativeLimit,
              required: true,
            },
            // Ẩn theo yêu cầu: không cho chuyển phép dư sang năm sau (bỏ comment để dùng lại).
            // {
            //   key: 'carryoverAllowed',
            //   label: 'Chuyển phép sang năm',
            //   options: yesNo,
            //   value: String(row.carryoverAllowed),
            //   required: true,
            // },
            // {
            //   key: 'maxCarryoverDays',
            //   label: 'Số ngày chuyển tối đa',
            //   type: 'number',
            //   min: 0,
            //   max: 366,
            //   step: '0.5',
            //   value: row.maxCarryoverDays,
            //   required: true,
            // },
            // {
            //   key: 'carryoverExpiryMonth',
            //   label: 'Tháng hết hạn phép chuyển',
            //   type: 'number',
            //   min: 1,
            //   max: 12,
            //   value: row.carryoverExpiryMonth,
            //   required: true,
            // },
            {
              key: 'reason',
              label: 'Lý do',
              colSpan: 2,
              required: true,
            },
          ],
      submit: async (v) => {
        const payload = deactivate
          ? { active: false }
          : {
              name: v.name,
              paid: v.paid === 'true',
              deductBalance: v.deductBalance === 'true',
              requiresAttachment: v.requiresAttachment === 'true',
              negativeLimit: Number(v.negativeLimit),
              // Không chuyển phép sang năm sau: cố định không chuyển.
              carryoverAllowed: false,
              maxCarryoverDays: 0,
              carryoverExpiryMonth: row.carryoverExpiryMonth,
              // Khi bỏ comment các trường chuyển phép ở trên, dùng lại 3 dòng sau:
              // carryoverAllowed: v.carryoverAllowed === 'true',
              // maxCarryoverDays: Number(v.maxCarryoverDays),
              // carryoverExpiryMonth: Number(v.carryoverExpiryMonth),
              active: v.active === 'true',
            };
        await hrmFetch(`/leave-types/${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...payload,
            expectedUpdatedAt: row.updatedAt,
            reason: v.reason,
          }),
        });
        await reload();
      },
    });
  }

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6 max-w-[1600px] mx-auto'}>
      <div
        className={`flex flex-col xl:flex-row xl:items-center justify-between gap-4 ${
          embedded ? '' : 'bg-white rounded-xl border border-slate-200 p-5 shadow-xs'
        }`}
      >
        <div className="flex items-center gap-3">
          {!embedded && (
            <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <ListChecks className="size-5" />
            </div>
          )}
          <div>
            {embedded ? (
              <h2 className="text-sm font-bold text-slate-900">Lý do nghỉ phép</h2>
            ) : (
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Lý do nghỉ phép
              </h1>
            )}
            <p className="text-xs text-slate-500 max-w-[85ch]">
              Danh mục các lý do nghỉ: đơn vị tính, hưởng lương và có trừ quỹ phép hay không.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          <Button
            permission="hrm.leave.manage"
            onClick={() =>
              setAction({
                title: 'Thêm lý do nghỉ mới',
                columns: 3,
                fields: [
                  { key: 'code', label: 'Mã lý do (VD: AL, SL)', required: true },
                  { key: 'name', label: 'Tên lý do nghỉ', colSpan: 2, required: true },
                  {
                    key: 'unit',
                    label: 'Đơn vị tính',
                    options: [
                      { value: 'DAYS', label: 'Ngày' },
                      { value: 'HOURS', label: 'Giờ' },
                    ],
                    value: 'DAYS',
                    required: true,
                  },
                  {
                    key: 'paid',
                    label: 'Hưởng lương',
                    options: yesNo,
                    value: 'true',
                    required: true,
                  },
                  {
                    key: 'deductBalance',
                    label: 'Trừ quỹ phép',
                    options: yesNo,
                    value: 'true',
                    required: true,
                  },
                  {
                    key: 'requiresAttachment',
                    label: 'Yêu cầu chứng từ kèm theo',
                    options: yesNo,
                    value: 'false',
                    required: true,
                  },
                  {
                    key: 'negativeLimit',
                    label: 'Hạn mức ứng / âm phép',
                    type: 'number',
                    min: 0,
                    value: 0,
                    step: '0.5',
                    required: true,
                  },
                  // Ẩn theo yêu cầu: không cho chuyển phép dư sang năm sau (bỏ comment để dùng lại).
                  // {
                  //   key: 'carryoverAllowed',
                  //   label: 'Cho phép chuyển sang năm sau',
                  //   options: yesNo,
                  //   value: 'false',
                  //   required: true,
                  // },
                  // {
                  //   key: 'maxCarryoverDays',
                  //   label: 'Số lượng chuyển tối đa',
                  //   type: 'number',
                  //   min: 0,
                  //   value: 0,
                  //   step: '0.5',
                  //   required: true,
                  // },
                  // {
                  //   key: 'carryoverExpiryMonth',
                  //   label: 'Hết hạn vào cuối tháng (1-12)',
                  //   type: 'number',
                  //   min: 1,
                  //   max: 12,
                  //   value: 3,
                  //   colSpan: 2,
                  //   required: true,
                  // },
                ],
                submit: (v) =>
                  save('/leave-types', {
                    ...v,
                    paid: v.paid === 'true',
                    deductBalance: v.deductBalance === 'true',
                    requiresAttachment: v.requiresAttachment === 'true',
                    negativeLimit: Number(v.negativeLimit),
                    // Không chuyển phép sang năm sau: cố định không chuyển.
                    carryoverAllowed: false,
                    maxCarryoverDays: 0,
                    carryoverExpiryMonth: 3,
                    // Khi bỏ comment các trường chuyển phép ở trên, dùng lại 3 dòng sau:
                    // carryoverAllowed: v.carryoverAllowed === 'true',
                    // maxCarryoverDays: Number(v.maxCarryoverDays),
                    // carryoverExpiryMonth: Number(v.carryoverExpiryMonth),
                  }),
              })
            }
            className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 shadow-xs text-xs"
          >
            <Plus className="size-4" />
            <span>Thêm lý do nghỉ</span>
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 shadow-xs flex items-center gap-2"
        >
          <AlertTriangle className="size-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {message && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-semibold text-emerald-700 shadow-xs flex items-center gap-2"
        >
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
          <span>{message}</span>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white shadow-xs p-5 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Danh mục lý do nghỉ phép ({types.length})
          </span>
        </div>
        <Table<HrmLeaveType>
          size="small"
          rowKey="id"
          dataSource={types}
          scroll={{ x: 800, y: 480 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total, range) =>
              `Hiển thị ${range[0]}–${range[1]} / ${total} lý do nghỉ`,
          }}
          columns={[
            {
              title: 'Tên lý do',
              dataIndex: 'name',
              render: (v, r) => (
                <div>
                  <span className="font-semibold text-slate-900 block">{v}</span>
                  <span className="text-[11px] font-mono text-slate-500">{r.code}</span>
                </div>
              ),
            },
            {
              title: 'Đơn vị',
              dataIndex: 'unit',
              width: 100,
              render: (v) => <span className="text-xs text-slate-700">{v === 'HOURS' ? 'Giờ' : 'Ngày'}</span>,
            },
            {
              title: 'Hưởng lương',
              render: (_, r) =>
                r.paid ? (
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">Hưởng lương</Badge>
                ) : (
                  <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs">Không hưởng</Badge>
                ),
            },
            {
              title: 'Trừ quỹ phép',
              render: (_, r) =>
                r.deductBalance ? (
                  <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs">Trừ quỹ</Badge>
                ) : (
                  <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs">Không trừ</Badge>
                ),
            },
            // Ẩn theo yêu cầu (bỏ comment để hiển thị lại):
            // {
            //   title: 'Hạn mức âm',
            //   dataIndex: 'negativeLimit',
            //   width: 120,
            //   render: (v) => <span className="text-xs text-slate-700">{v} {v ? 'ngày' : ''}</span>,
            // },
            // {
            //   title: 'Chuyển tối đa',
            //   dataIndex: 'maxCarryoverDays',
            //   width: 120,
            //   render: (v) => <span className="text-xs text-slate-700">{v} {v ? 'ngày' : ''}</span>,
            // },
            // {
            //   title: 'Hết hạn tháng',
            //   dataIndex: 'carryoverExpiryMonth',
            //   width: 120,
            //   render: (v) => <span className="text-xs text-slate-700">{v ? `Tháng ${v}` : '—'}</span>,
            // },
            {
              title: 'Trạng thái',
              width: 130,
              render: (_, r) =>
                r.active ? (
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">Đang áp dụng</Badge>
                ) : (
                  <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs">Đã ngừng</Badge>
                ),
            },
            {
              title: 'Thao tác',
              fixed: 'right',
              width: 140,
              render: (_, r) =>
                can('hrm.leave.manage') ? (
                  <div className="flex gap-1.5">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => editLeaveType(r)}
                      className="h-7 text-xs px-2"
                    >
                      <Pencil className="size-3 mr-1" />
                      Sửa
                    </Button>
                    {r.active && (
                      <Button
                        size="xs"
                        variant="destructive"
                        onClick={() => editLeaveType(r, true)}
                        className="h-7 text-xs px-2"
                      >
                        <XCircle className="size-3 mr-1" />
                        Ngừng
                      </Button>
                    )}
                  </div>
                ) : null,
            },
          ]}
        />
      </section>

      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </div>
  );
}
