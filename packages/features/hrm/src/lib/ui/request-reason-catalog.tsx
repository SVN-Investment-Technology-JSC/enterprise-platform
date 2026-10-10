'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import { CheckCircle2, Pencil, Plus, Trash2, XCircle } from 'lucide-react';
import type {
  HrmRequestReason,
  HrmRequestReasonKind,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from './badge';
import { Button } from './button';
import { HrmActionDialog, type HrmAction } from './hrm-action-dialog';

const yesNo = [
  { value: 'true', label: 'Có' },
  { value: 'false', label: 'Không' },
];

/** Danh mục lý do của một loại đơn (tab): thêm/sửa/ngừng/xoá động. */
export function RequestReasonCatalog({
  kind,
  title,
  fixedItems = false,
}: {
  kind: HrmRequestReasonKind;
  title: string;
  /** true: hệ thống tính toán theo mã nên chỉ bật/tắt và đổi tên mục, không thêm/xoá/đổi ký hiệu. */
  fixedItems?: boolean;
}) {
  const noun = title.toLowerCase();
  const { can } = useHrmPermissions();
  const canManage = can('hrm.leave.manage');
  const [reasons, setReasons] = useState<HrmRequestReason[]>([]);
  const [error, setError] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null);

  const load = useCallback(async () => {
    const result = await hrmFetch<{ data: HrmRequestReason[] }>(
      `/request-reasons?kind=${encodeURIComponent(kind)}`,
    );
    setReasons(result.data);
  }, [kind]);

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);

  function fields(row?: HrmRequestReason): HrmAction['fields'] {
    return [
      {
        key: 'name',
        label: 'Tên lý do',
        value: row?.name ?? '',
        colSpan: fixedItems ? 2 : 1,
        required: true,
      },
      ...(fixedItems
        ? []
        : [
            {
              key: 'code',
              label: 'Ký hiệu',
              value: row?.code ?? '',
            },
          ]),
      {
        key: 'description',
        label: 'Mô tả',
        value: row?.description ?? '',
        colSpan: 2,
      },
      {
        key: 'sortOrder',
        label: 'Thứ tự hiển thị',
        type: 'number',
        min: 0,
        value: row?.sortOrder ?? '',
      },
      {
        key: 'active',
        label: 'Đang sử dụng',
        options: yesNo,
        value: String(row?.active ?? true),
        required: true,
      },
    ];
  }

  function payload(v: Record<string, string>) {
    return {
      name: v.name,
      ...(fixedItems ? {} : { code: v.code || null }),
      description: v.description || null,
      active: v.active === 'true',
      ...(v.sortOrder !== '' && v.sortOrder !== undefined
        ? { sortOrder: Number(v.sortOrder) }
        : {}),
    };
  }

  function create() {
    setAction({
      title: `Thêm ${noun}`,
      columns: 2,
      fields: fields(),
      submit: async (v) => {
        await hrmFetch('/request-reasons', {
          method: 'POST',
          body: JSON.stringify({ kind, ...payload(v) }),
        });
        await load();
      },
    });
  }

  function edit(row: HrmRequestReason) {
    setAction({
      title: `Cập nhật "${row.name}"`,
      description:
        'Đơn đã gửi giữ nguyên lý do cũ; thay đổi chỉ áp dụng cho đơn mới.',
      columns: 2,
      fields: fields(row),
      submit: async (v) => {
        await hrmFetch(`/request-reasons/${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload(v)),
        });
        await load();
      },
    });
  }

  async function setActive(row: HrmRequestReason, active: boolean) {
    await hrmFetch(`/request-reasons/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    });
    await load();
  }

  function deactivate(row: HrmRequestReason) {
    setAction({
      title: `Ngừng sử dụng "${row.name}"`,
      confirmTitle: 'Ngừng lý do này cho các đơn mới?',
      description:
        'Lý do ẩn khỏi form tạo đơn mới và có thể kích hoạt lại bất cứ lúc nào. Đơn đã gửi không bị ảnh hưởng.',
      columns: 1,
      fields: [],
      submit: () => setActive(row, false),
    });
  }

  function remove(row: HrmRequestReason) {
    setAction({
      title: `Xoá "${row.name}"`,
      confirmTitle: 'Xoá lý do này khỏi danh mục?',
      description:
        'Lý do biến mất khỏi form tạo đơn mới. Đơn đã gửi không bị ảnh hưởng.',
      columns: 1,
      fields: [],
      submit: async () => {
        await hrmFetch(`/request-reasons/${row.id}`, { method: 'DELETE' });
        await load();
      },
    });
  }

  return (
    <>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700"
        >
          {error}
        </div>
      )}
      {(() => {
        const rows = reasons;
        return (
          <section
            className="rounded-xl border border-slate-200 bg-white shadow-xs p-5 space-y-3"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {title} ({rows.length})
              </span>
              {canManage && !fixedItems && (
                <Button
                  size="xs"
                  onClick={() => create()}
                  className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 text-xs"
                >
                  <Plus className="size-3.5" />
                  <span>Thêm lý do</span>
                </Button>
              )}
            </div>
            <Table<HrmRequestReason>
              size="small"
              rowKey="id"
              dataSource={rows}
              pagination={false}
              scroll={{ y: 320 }}
              columns={[
                {
                  title: 'Lý do',
                  dataIndex: 'name',
                  render: (v) => (
                    <span className="font-semibold text-slate-900">{v}</span>
                  ),
                },
                {
                  title: 'Ký hiệu',
                  dataIndex: 'code',
                  width: 130,
                  render: (v) => (
                    <span className="text-xs font-mono text-slate-600">
                      {v || '--'}
                    </span>
                  ),
                },
                {
                  title: 'Mô tả',
                  dataIndex: 'description',
                  render: (v) => (
                    <span className="text-xs text-slate-600">{v || '--'}</span>
                  ),
                },
                {
                  title: 'Thứ tự',
                  dataIndex: 'sortOrder',
                  width: 90,
                },
                {
                  title: 'Trạng thái',
                  width: 130,
                  render: (_, r) =>
                    r.active ? (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                        Đang áp dụng
                      </Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs">
                        Đã ngừng
                      </Badge>
                    ),
                },
                {
                  title: 'Thao tác',
                  width: 270,
                  render: (_, r) =>
                    canManage ? (
                      <div className="flex gap-1.5">
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => edit(r)}
                          className="h-7 text-xs px-2"
                        >
                          <Pencil className="size-3 mr-1" />
                          Sửa
                        </Button>
                        {r.active ? (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => deactivate(r)}
                            className="h-7 text-xs px-2"
                          >
                            <XCircle className="size-3 mr-1" />
                            Ngừng
                          </Button>
                        ) : (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() =>
                              void setActive(r, true).catch((e) =>
                                setError(e.message),
                              )
                            }
                            className="h-7 text-xs px-2"
                          >
                            <CheckCircle2 className="size-3 mr-1" />
                            Kích hoạt
                          </Button>
                        )}
                        {!fixedItems && (
                          <Button
                            size="xs"
                            variant="destructive"
                            onClick={() => remove(r)}
                            className="h-7 text-xs px-2"
                          >
                            <Trash2 className="size-3 mr-1" />
                            Xoá
                          </Button>
                        )}
                      </div>
                    ) : null,
                },
              ]}
            />
          </section>
        );
      })()}
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </>
  );
}
