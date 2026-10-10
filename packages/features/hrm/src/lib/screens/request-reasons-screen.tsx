'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Table, Tooltip, type TableColumnsType } from 'antd';
import {
  CheckCircle2,
  ClipboardList,
  Info,
  Pencil,
  Plus,
  Trash2,
  WandSparkles,
  XCircle,
} from 'lucide-react';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import type {
  HrmRequestReason,
  HrmRequestReasonKind,
  SaveRequestReasonRequest,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  HrmActionDialog,
  type ActionField,
  type HrmAction,
} from '../ui/hrm-action-dialog';
import { toast } from '../ui/toast';

/** Bốn loại đơn có danh mục lý do cấu hình. Đơn nghỉ không ở đây: lý do nghỉ là loại nghỉ (tab Phép năm và lý do nghỉ). */
export const REQUEST_REASON_KINDS: readonly {
  kind: HrmRequestReasonKind;
  label: string;
}[] = [
  { kind: 'OVERTIME', label: 'Làm thêm giờ' },
  { kind: 'BUSINESS_TRIP', label: 'Công tác' },
  { kind: 'ATTENDANCE_CORRECTION', label: 'Giải trình công' },
  { kind: 'SHIFT_CHANGE', label: 'Đổi ca' },
];

const YES_NO = [
  { value: 'true', label: 'Có' },
  { value: 'false', label: 'Không' },
];
const PAID_OPTIONS = [
  { value: 'true', label: 'Có lương' },
  { value: 'false', label: 'Không lương' },
];

const UNPAID_OT_HINT =
  'OT không lương được ghi nhận nhưng không tính tiền OT.';
const REQUIRES_DESCRIPTION_HINT =
  'Có: người làm đơn bắt buộc nhập Mô tả khi chọn lý do này (ví dụ lý do Khác).';
const EXPLANATION_HINT =
  'Câu hướng dẫn hiện cạnh lý do trong danh sách chọn. Không phải Mô tả của đơn.';

/** Các trường của form thêm/sửa lý do; `paid` chỉ có với làm thêm giờ, mã chỉ nhập khi thêm mới. */
export function reasonFormFields(
  kind: HrmRequestReasonKind,
  row?: HrmRequestReason,
): ActionField[] {
  return [
    {
      key: 'name',
      label: 'Tên lý do',
      value: row?.name ?? '',
      required: true,
    },
    ...(row
      ? []
      : [
          {
            key: 'code',
            label: 'Mã lý do (bỏ trống để tự sinh)',
            optional: true,
          },
        ]),
    {
      key: 'description',
      label: 'Diễn giải (hướng dẫn cho người chọn lý do, không phải Mô tả của đơn)',
      value: row?.description ?? '',
      colSpan: 2,
      optional: true,
    },
    ...(kind === 'OVERTIME'
      ? [
          {
            key: 'paid',
            label: 'Hưởng lương',
            options: PAID_OPTIONS,
            value: String(row?.paid ?? true),
            required: true,
          },
        ]
      : []),
    {
      key: 'requiresDescription',
      label: 'Bắt buộc nhập mô tả',
      options: YES_NO,
      value: String(row?.requiresDescription ?? false),
      required: true,
    },
    {
      key: 'active',
      label: 'Đang sử dụng',
      options: YES_NO,
      value: String(row?.active ?? true),
      required: true,
    },
    {
      key: 'sortOrder',
      label: 'Thứ tự hiển thị (bỏ trống để xếp cuối)',
      type: 'number',
      min: 0,
      value: row?.sortOrder ?? '',
      optional: true,
    },
  ];
}

/** Body của POST (có `kind`) và PATCH /request-reasons; PATCH không gửi `kind` và `code`. */
export function reasonPayload(
  kind: HrmRequestReasonKind,
  values: Record<string, string>,
  creating: boolean,
): SaveRequestReasonRequest {
  const code = values.code?.trim();
  const sortOrder = values.sortOrder?.trim();
  return {
    ...(creating ? { kind } : {}),
    ...(creating && code ? { code } : {}),
    name: values.name.trim(),
    description: values.description?.trim() || null,
    ...(kind === 'OVERTIME' ? { paid: values.paid === 'true' } : {}),
    requiresDescription: values.requiresDescription === 'true',
    active: values.active === 'true',
    ...(sortOrder ? { sortOrder: Number(sortOrder) } : {}),
  };
}

type Notice = { tone: 'success' | 'warning'; text: string };

const errorText = (e: unknown, fallback = 'Thao tác thất bại') =>
  e instanceof Error ? e.message : fallback;

/**
 * Cấu hình danh mục LÝ DO của bốn loại đơn (làm thêm giờ, công tác, giải trình công, đổi ca).
 * Lý do là danh mục do quản trị cấu hình, người làm đơn chỉ chọn; khác với Mô tả là văn bản tự do.
 */
export default function RequestReasonsScreen() {
  const { can, loading: permissionsLoading } = useHrmPermissions();
  const canManage = can('hrm.leave.manage');
  const [reasons, setReasons] = useState<HrmRequestReason[] | null>(null);
  const [kind, setKind] = useState<HrmRequestReasonKind>('OVERTIME');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [action, setAction] = useState<HrmAction | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await hrmFetch<{ data: HrmRequestReason[] }>(
      '/request-reasons',
    );
    setReasons(result.data);
  }, []);

  // Phụ thuộc giá trị boolean: hàm can() đổi danh tính mỗi lần render sẽ gây tải lặp vô hạn.
  useEffect(() => {
    if (!canManage) return;
    void load().catch((e) => setError(errorText(e, 'Không tải được danh mục lý do')));
  }, [canManage, load]);

  const byKind = useMemo(() => {
    const groups = new Map<HrmRequestReasonKind, HrmRequestReason[]>();
    for (const item of reasons ?? []) {
      const list = groups.get(item.kind) ?? [];
      list.push(item);
      groups.set(item.kind, list);
    }
    return groups;
  }, [reasons]);

  const current = REQUEST_REASON_KINDS.find((k) => k.kind === kind);
  const rows = byKind.get(kind) ?? [];

  /** Chạy một thao tác ghi: lỗi hiện ở hộp cảnh báo đầu trang, không ném tiếp (Popconfirm chờ promise này). */
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice(null);
    try {
      await task();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    const label = current?.label ?? '';
    setAction({
      title: `Thêm lý do cho đơn ${label}`,
      description:
        'Lý do là mục trong danh mục; người làm đơn chọn một lý do rồi có thể nhập thêm Mô tả (văn bản tự do).',
      columns: 2,
      fields: reasonFormFields(kind),
      submit: async (values) => {
        await hrmFetch('/request-reasons', {
          method: 'POST',
          body: JSON.stringify(reasonPayload(kind, values, true)),
        });
        await load();
        toast.success('Đã thêm lý do');
      },
    });
  }

  function openEdit(row: HrmRequestReason) {
    setAction({
      title: `Sửa lý do "${row.name}"`,
      description: `Mã ${row.code} và loại đơn không đổi được. Đơn đã gửi giữ nguyên lý do cũ; thay đổi chỉ áp dụng cho đơn mới.`,
      columns: 2,
      fields: reasonFormFields(row.kind, row),
      submit: async (values) => {
        await hrmFetch(`/request-reasons/${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify(reasonPayload(row.kind, values, false)),
        });
        await load();
        toast.success('Đã lưu lý do');
      },
    });
  }

  function setActive(row: HrmRequestReason, active: boolean) {
    return run(async () => {
      await hrmFetch(`/request-reasons/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      });
      await load();
      toast.success(active ? 'Đã dùng lại lý do' : 'Đã ngừng sử dụng lý do');
    });
  }

  function remove(row: HrmRequestReason) {
    return run(async () => {
      const result = await hrmFetch<{
        data: { id: string; deleted: boolean; active: boolean; usageCount: number };
        message?: string;
      }>(`/request-reasons/${row.id}`, { method: 'DELETE' });
      // Lý do đã có đơn dùng thì server chỉ ngừng sử dụng: hiển thị đúng thông báo của server.
      setNotice({
        tone: result.data.deleted ? 'success' : 'warning',
        text:
          result.message ??
          (result.data.deleted
            ? `Đã xóa lý do "${row.name}".`
            : `Lý do "${row.name}" đã có đơn dùng nên chỉ được ngừng sử dụng.`),
      });
      await load();
    });
  }

  function createDefaults() {
    return run(async () => {
      const result = await hrmFetch<{ data: { created: number } }>(
        '/request-reasons/defaults',
        { method: 'POST', body: JSON.stringify({}) },
      );
      await load();
      toast.success(
        result.data.created > 0
          ? `Đã tạo ${result.data.created} lý do mặc định`
          : 'Không có lý do nào cần tạo: các loại đơn đều đã có lý do',
      );
    });
  }

  if (!permissionsLoading && !canManage) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-[1600px] rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500"
      >
        Bạn không có quyền cấu hình lý do đơn từ.
      </div>
    );
  }

  const columns: TableColumnsType<HrmRequestReason> = [
    {
      title: 'Tên lý do',
      dataIndex: 'name',
      render: (v: string) => (
        <span className="font-semibold text-slate-900">{v}</span>
      ),
    },
    {
      title: 'Mã',
      dataIndex: 'code',
      width: 150,
      render: (v: string) => (
        <span className="font-mono text-xs text-slate-600">{v}</span>
      ),
    },
    {
      title: (
        <Tooltip title={EXPLANATION_HINT}>
          <span className="inline-flex items-center gap-1">
            Diễn giải
            <Info className="size-3 text-slate-400" aria-hidden="true" />
          </span>
        </Tooltip>
      ),
      dataIndex: 'description',
      render: (v: string | null) => (
        <span className="text-xs text-slate-600">{v || '--'}</span>
      ),
    },
    ...(kind === 'OVERTIME'
      ? [
          {
            title: (
              <Tooltip title={UNPAID_OT_HINT}>
                <span className="inline-flex items-center gap-1">
                  Hưởng lương
                  <Info className="size-3 text-slate-400" aria-hidden="true" />
                </span>
              </Tooltip>
            ),
            width: 140,
            render: (_: unknown, r: HrmRequestReason) => (
              <Tooltip title={r.paid ? undefined : UNPAID_OT_HINT}>
                <span>
                  {r.paid ? (
                    <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                      Có lương
                    </Badge>
                  ) : (
                    <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                      Không lương
                    </Badge>
                  )}
                </span>
              </Tooltip>
            ),
          },
        ]
      : []),
    {
      title: (
        <Tooltip title={REQUIRES_DESCRIPTION_HINT}>
          <span className="inline-flex items-center gap-1">
            Cần mô tả
            <Info className="size-3 text-slate-400" aria-hidden="true" />
          </span>
        </Tooltip>
      ),
      width: 110,
      render: (_: unknown, r: HrmRequestReason) => (
        <span className="text-xs text-slate-700">
          {r.requiresDescription ? 'Có' : 'Không'}
        </span>
      ),
    },
    {
      title: 'Số đơn đã dùng',
      width: 120,
      align: 'right',
      render: (_: unknown, r: HrmRequestReason) => (
        <span className="text-xs tabular-nums text-slate-700">
          {r.usageCount ?? 0}
        </span>
      ),
    },
    {
      title: 'Trạng thái',
      width: 140,
      render: (_: unknown, r: HrmRequestReason) =>
        r.active ? (
          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
            Đang sử dụng
          </Badge>
        ) : (
          <Badge className="border-slate-200 bg-slate-100 text-slate-600">
            Ngừng sử dụng
          </Badge>
        ),
    },
    {
      title: 'Thao tác',
      width: 300,
      render: (_: unknown, r: HrmRequestReason) => (
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => openEdit(r)}
            aria-label={`Sửa lý do ${r.name}`}
            className="h-7 px-2 text-xs"
          >
            <Pencil className="mr-1 size-3" />
            Sửa
          </Button>
          {r.active ? (
            <Popconfirm
              title={`Ngừng sử dụng lý do "${r.name}"?`}
              description="Lý do ẩn khỏi danh sách chọn của đơn mới; có thể dùng lại bất cứ lúc nào. Đơn đã gửi không bị ảnh hưởng."
              okText="Ngừng sử dụng"
              cancelText="Quay lại"
              okType="warning"
              onConfirm={() => setActive(r, false)}
            >
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                aria-label={`Ngừng lý do ${r.name}`}
                className="h-7 px-2 text-xs"
              >
                <XCircle className="mr-1 size-3" />
                Ngừng
              </Button>
            </Popconfirm>
          ) : (
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => void setActive(r, true)}
              aria-label={`Dùng lại lý do ${r.name}`}
              className="h-7 px-2 text-xs"
            >
              <CheckCircle2 className="mr-1 size-3" />
              Dùng lại
            </Button>
          )}
          <Popconfirm
            title={`Xóa lý do "${r.name}"?`}
            description={
              (r.usageCount ?? 0) > 0
                ? `Lý do đã được dùng trong ${r.usageCount} đơn nên không xóa được; hệ thống chỉ ngừng sử dụng lý do này.`
                : 'Lý do biến mất khỏi danh mục. Đơn đã gửi không bị ảnh hưởng.'
            }
            okText="Xóa lý do"
            cancelText="Quay lại"
            okType="danger"
            onConfirm={() => remove(r)}
          >
            <Button
              size="xs"
              variant="destructive"
              disabled={busy}
              aria-label={`Xóa lý do ${r.name}`}
              className="h-7 px-2 text-xs"
            >
              <Trash2 className="mr-1 size-3" />
              Xóa
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs xl:flex-row xl:items-center">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <ClipboardList className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Lý do đơn từ
            </h1>
            <p className="max-w-[85ch] text-xs text-slate-500">
              Danh mục lý do của đơn làm thêm giờ, công tác, giải trình công và
              đổi ca. Đơn nghỉ không cấu hình ở đây: lý do nghỉ do tab Phép năm
              và lý do nghỉ quản lý.
            </p>
          </div>
        </div>
      </div>

      <div
        role="note"
        className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-xs text-slate-700"
      >
        <Info className="mt-0.5 size-4 shrink-0 text-blue-600" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-semibold text-slate-900">
            Lý do là danh mục do quản trị cấu hình; người làm đơn chọn một lý do
            rồi có thể nhập thêm Mô tả. Mô tả là văn bản tự do, không phải lý
            do.
          </p>
          <p>
            Diễn giải là câu hướng dẫn hiện cạnh lý do trong danh sách chọn.
            Lý do đặt Cần mô tả là Có thì người làm đơn bắt buộc nhập Mô tả khi
            chọn lý do đó (ví dụ lý do Khác).
          </p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className={`rounded-xl border p-3 text-xs font-medium ${
            notice.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          {notice.text}
        </div>
      )}

      <div
        role="tablist"
        aria-label="Loại đơn"
        className="flex flex-wrap gap-5 border-b border-slate-200"
      >
        {REQUEST_REASON_KINDS.map((item) => {
          const selected = item.kind === kind;
          return (
            <button
              key={item.kind}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setKind(item.kind)}
              className={`-mb-px border-b-2 px-3 py-3 text-sm font-medium ${
                selected
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {item.label}
              {reasons && (
                <span className="ml-1.5 text-xs font-normal text-slate-400">
                  {byKind.get(item.kind)?.length ?? 0}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Lý do của đơn {current?.label.toLowerCase()} ({rows.length})
          </span>
          <Button
            permission="hrm.leave.manage"
            size="xs"
            disabled={busy}
            onClick={openCreate}
            className="flex items-center gap-1.5 bg-blue-600 text-xs text-white hover:bg-blue-700"
          >
            <Plus className="size-3.5" />
            <span>Thêm lý do</span>
          </Button>
        </div>

        {kind === 'OVERTIME' && (
          <p className="text-xs text-slate-500">{UNPAID_OT_HINT}</p>
        )}

        {reasons === null ? (
          <p className="py-8 text-center text-xs text-slate-500">
            {error ? 'Không tải được danh mục lý do.' : 'Đang tải danh mục lý do...'}
          </p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
            <p className="text-sm font-semibold text-slate-800">
              Đơn {current?.label.toLowerCase()} chưa có lý do nào
            </p>
            <p className="max-w-[70ch] text-xs text-slate-500">
              Người làm đơn phải chọn một lý do trong danh mục nên cần có ít
              nhất một lý do. Tạo bộ lý do mặc định cho các loại đơn đang trống,
              hoặc thêm lý do riêng.
            </p>
            <Button
              permission="hrm.leave.manage"
              disabled={busy}
              onClick={() => void createDefaults()}
              className="flex items-center gap-1.5 bg-blue-600 text-xs text-white hover:bg-blue-700"
            >
              <WandSparkles className="size-3.5" />
              <span>Tạo lý do mặc định</span>
            </Button>
          </div>
        ) : (
          <Table<HrmRequestReason>
            size="small"
            rowKey="id"
            dataSource={rows}
            columns={columns}
            pagination={false}
            scroll={{ y: 'max(280px, calc(100vh - 520px))' }}
          />
        )}
      </section>

      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </div>
  );
}
