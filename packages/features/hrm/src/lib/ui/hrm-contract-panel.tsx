'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Table } from 'antd';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import type { HrmEmploymentContract } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { Button } from './button';
import {
  HrmActionDialog,
  type HrmAction,
  type ActionField,
} from './hrm-action-dialog';
import { toast } from './toast';
import { Plus, FileText } from 'lucide-react';

const statusLabels: Record<string, { label: string; className: string }> = {
  DRAFT: {
    label: 'Nháp',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  ACTIVE: {
    label: 'Đang hiệu lực',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  EXPIRED: {
    label: 'Hết hạn',
    className: 'bg-slate-100 text-slate-600 border-slate-200',
  },
  TERMINATED: {
    label: 'Đã chấm dứt',
    className: 'bg-rose-50 text-rose-700 border-rose-200',
  },
};

const contractTypeLabels: Record<string, string> = {
  PROBATION: 'Thử việc',
  DEFINITE: 'Xác định thời hạn',
  INDEFINITE: 'Không xác định thời hạn',
  AMENDMENT: 'Phụ lục / Gia hạn',
};

function formatVnDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const clean = dateStr.slice(0, 10);
  const parts = clean.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return clean;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fields(row?: HrmEmploymentContract): ActionField[] {
  return [
    {
      key: 'contractCode',
      label: 'Số hợp đồng / phụ lục',
      value: row?.contractCode || '',
    },
    {
      key: 'contractType',
      label: 'Loại hợp đồng',
      value: row?.contractType || 'DEFINITE',
      options: [
        { value: 'PROBATION', label: 'Thử việc' },
        { value: 'DEFINITE', label: 'Xác định thời hạn (Chính thức)' },
        { value: 'INDEFINITE', label: 'Không xác định thời hạn' },
        { value: 'AMENDMENT', label: 'Phụ lục / gia hạn' },
      ],
    },
    {
      key: 'signDate',
      label: 'Ngày ký HĐ',
      type: 'date',
      value: row?.signDate || todayIso(),
    },
    {
      key: 'effectiveFrom',
      label: 'Hiệu lực từ ngày',
      type: 'date',
      value: row?.effectiveFrom || todayIso(),
    },
    {
      key: 'effectiveTo',
      label: 'Hiệu lực đến ngày',
      type: 'date',
      optional: true,
      value: row?.effectiveTo || '',
    },
    {
      key: 'baseSalary',
      label: 'Mức lương thỏa thuận (VNĐ)',
      type: 'number',
      min: 0,
      optional: true,
      value: row?.baseSalary ?? '',
    },
    {
      key: 'fileUrl',
      label: 'Đường dẫn tệp chứng từ (nếu có)',
      optional: true,
      value: row?.fileUrl || '',
    },
    {
      key: 'note',
      label: 'Ghi chú điều khoản',
      optional: true,
      value: row?.note || '',
    },
  ];
}

function payload(v: Record<string, string>) {
  return {
    ...Object.fromEntries(
      Object.entries(v).map(([k, value]) => [k, value.trim() || null]),
    ),
    baseSalary: v.baseSalary ? Number(v.baseSalary) : null,
  };
}

export function HrmContractPanel({
  employeeId,
  rows,
  onChanged,
  readOnly = false,
}: {
  employeeId: string;
  rows: HrmEmploymentContract[];
  onChanged: (rows: HrmEmploymentContract[]) => void;
  readOnly?: boolean;
}) {
  const [action, setAction] = useState<HrmAction | null>(null);
  const [loading, setLoading] = useState(false);
  const [contracts, setContracts] = useState<HrmEmploymentContract[]>(rows || []);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    if (rows && rows.length > 0) {
      setContracts(rows);
    }
  }, [rows]);

  const refresh = useCallback(async () => {
    if (!employeeId) return;
    try {
      setLoading(true);
      const res = await hrmFetch<{ data: HrmEmploymentContract[] }>(
        `/employees/${employeeId}/contracts`,
      );
      const data = res.data || [];
      setContracts(data);
      onChangedRef.current?.(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const command = async (path: string, method: string, body: unknown) => {
    await hrmFetch(path, { method, body: JSON.stringify(body) });
    await refresh();
  };

  const createContract = (row?: HrmEmploymentContract) =>
    setAction({
      title: row ? 'Cập nhật hợp đồng' : 'Thêm hợp đồng lao động',
      columns: 2,
      fields: fields(row),
      submit: async (v) => {
        await command(
          row ? `/contracts/${row.id}` : `/employees/${employeeId}/contracts`,
          row ? 'PATCH' : 'POST',
          {
            ...payload(v),
            status: 'ACTIVE',
            ...(row ? { expectedUpdatedAt: row.updatedAt } : {}),
          },
        );
        toast.success(row ? 'Đã cập nhật hợp đồng' : 'Đã tạo hợp đồng lao động mới');
      },
    });

  const amend = (row: HrmEmploymentContract) =>
    setAction({
      title: `Lập phụ lục hợp đồng · ${row.contractCode}`,
      columns: 2,
      fields: [
        {
          key: 'contractCode',
          label: 'Số phụ lục HĐ',
          value: `PL-${row.contractCode}`,
        },
        {
          key: 'signDate',
          label: 'Ngày ký phụ lục',
          type: 'date',
          value: todayIso(),
        },
        {
          key: 'effectiveFrom',
          label: 'Hiệu lực từ',
          type: 'date',
          value: row.effectiveFrom || todayIso(),
        },
        {
          key: 'effectiveTo',
          label: 'Hiệu lực đến',
          type: 'date',
          optional: true,
          value: row.effectiveTo || '',
        },
        {
          key: 'baseSalary',
          label: 'Mức lương mới (nếu điều chỉnh)',
          type: 'number',
          min: 0,
          optional: true,
          value: row.baseSalary ?? '',
        },
        {
          key: 'reason',
          label: 'Lý do & Nội dung thay đổi',
          value: '',
        },
        {
          key: 'fileUrl',
          label: 'Chứng từ phụ lục (tùy chọn)',
          optional: true,
          value: '',
        },
      ],
      submit: async (v) => {
        await command(`/contracts/${row.id}/amendments`, 'POST', {
          ...payload(v),
          contractType: 'AMENDMENT',
          expectedUpdatedAt: row.updatedAt,
        });
        toast.success('Đã tạo phụ lục hợp đồng thành công');
      },
    });

  const terminate = (row: HrmEmploymentContract) =>
    setAction({
      title: `Ghi nhận chấm dứt hợp đồng · ${row.contractCode}`,
      confirmTitle: 'Xác nhận chấm dứt hợp đồng lao động này?',
      fields: [
        { key: 'effectiveDate', label: 'Ngày chấm dứt hiệu lực', type: 'date', value: todayIso() },
        { key: 'reason', label: 'Lý do chấm dứt' },
        { key: 'evidenceReference', label: 'Số / đường dẫn quyết định chấm dứt' },
      ],
      submit: async (v) => {
        await command(`/contracts/${row.id}/terminate`, 'POST', {
          ...v,
          expectedUpdatedAt: row.updatedAt,
        });
        toast.success('Đã ghi nhận chấm dứt hợp đồng');
      },
    });

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-[14px] font-bold text-slate-900 uppercase tracking-wide flex items-center gap-1.5">
            <FileText className="size-3.5 text-blue-600" />
            <span>Hợp đồng & Phụ lục lao động</span>
          </h3>
          <p className="text-[14px] text-slate-500 mt-0.5">
            Quản lý ngày ký, thời hạn hiệu lực và các văn bản điều chỉnh hợp đồng lao động.
          </p>
        </div>

        {!readOnly && (
          <Button
            permission="hrm.employee.manage"
            size="sm"
            className="text-[14px] h-8 bg-blue-700 hover:bg-blue-800 text-white font-semibold gap-1.5 shadow-xs"
            onClick={() => createContract()}
          >
            <Plus className="size-3.5" />
            <span>Thêm hợp đồng</span>
          </Button>
        )}
      </div>

      <Table<HrmEmploymentContract>
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={contracts}
        pagination={false}
        scroll={{ x: 1050 }}
        locale={{
          emptyText: (
            <div className="py-6 text-center text-slate-400 text-[14px]">
              Chưa có hợp đồng hoặc phụ lục nào được ghi nhận
            </div>
          ),
        }}
        columns={[
          {
            title: 'Số hợp đồng / PL',
            dataIndex: 'contractCode',
            width: 170,
            fixed: 'left',
            render: (code, r) => (
              <div>
                <span className="font-semibold text-slate-900 block font-mono text-[14px]">{code}</span>
                {r.parentContractId && (
                  <span className="text-[14px] text-amber-700 bg-amber-50 px-1 py-0.2 rounded border border-amber-200">
                    Phụ lục của:{' '}
                    {contracts.find((x) => x.id === r.parentContractId)?.contractCode || 'HĐ gốc'}
                  </span>
                )}
              </div>
            ),
          },
          {
            title: 'Loại hợp đồng',
            dataIndex: 'contractType',
            width: 140,
            render: (type) => (
              <span className="font-medium text-slate-700 text-[14px]">
                {contractTypeLabels[type] || type}
              </span>
            ),
          },
          {
            title: 'Ngày ký HĐ',
            dataIndex: 'signDate',
            width: 110,
            render: (date) => (
              <span className="font-mono font-semibold text-blue-700 text-[14px]">
                {formatVnDate(date)}
              </span>
            ),
          },
          {
            title: 'Hiệu lực từ',
            dataIndex: 'effectiveFrom',
            width: 110,
            render: (date) => (
              <span className="font-mono text-slate-700 text-[14px]">
                {formatVnDate(date)}
              </span>
            ),
          },
          {
            title: 'Hiệu lực đến',
            dataIndex: 'effectiveTo',
            width: 110,
            render: (date) => (
              <span className="font-mono text-slate-700 text-[14px]">
                {date ? formatVnDate(date) : <span className="text-slate-400">Vô thời hạn</span>}
              </span>
            ),
          },
          {
            title: 'Mức lương',
            dataIndex: 'baseSalary',
            width: 120,
            render: (salary) => (
              <span className="font-mono text-slate-800 text-[14px] font-medium">
                {salary != null ? `${Number(salary).toLocaleString('vi-VN')} đ` : '—'}
              </span>
            ),
          },
          {
            title: 'Trạng thái',
            width: 125,
            render: (_, r) => {
              const meta = statusLabels[r.status] || {
                label: r.status,
                className: 'bg-slate-100 text-slate-600 border-slate-200',
              };
              return (
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[14px] font-semibold border ${meta.className}`}
                >
                  {meta.label}
                </span>
              );
            },
          },
          {
            title: 'Chứng từ',
            width: 110,
            render: (_, r) =>
              r.fileUrl && /^(\/[^/]|https?:\/\/)/.test(r.fileUrl) ? (
                <a
                  href={r.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-700 underline text-[14px] font-medium"
                >
                  Tệp đính kèm
                </a>
              ) : (
                <span className="text-slate-400 text-[14px]">—</span>
              ),
          },
          ...(!readOnly
            ? [
                {
                  title: 'Thao tác',
                  width: 180,
                  fixed: 'right' as const,
                  render: (_: unknown, r: HrmEmploymentContract) => (
                    <div className="flex flex-wrap items-center gap-1">
                      {r.status === 'ACTIVE' && (
                        <>
                          {!r.parentContractId && (
                            <Button
                              permission="hrm.employee.manage"
                              size="xs"
                              variant="outline"
                              className="h-6 text-[14px] px-2 text-blue-700 border-slate-200 hover:bg-blue-50"
                              onClick={() => amend(r)}
                            >
                              Phụ lục
                            </Button>
                          )}
                          <Button
                            permission="hrm.employee.manage"
                            size="xs"
                            variant="outline"
                            className="h-6 text-[14px] px-2 text-rose-700 border-slate-200 hover:bg-rose-50"
                            onClick={() => terminate(r)}
                          >
                            Chấm dứt
                          </Button>
                        </>
                      )}
                      {r.status === 'DRAFT' && (
                        <>
                          <Button
                            permission="hrm.employee.manage"
                            size="xs"
                            variant="outline"
                            className="h-6 text-[14px] px-2"
                            onClick={() => createContract(r)}
                          >
                            Sửa
                          </Button>
                          <Popconfirm
                            title="Ban hành hợp đồng lao động này?"
                            okText="Ban hành"
                            onConfirm={async () => {
                              try {
                                await command(
                                  `/contracts/${r.id}/activate`,
                                  'POST',
                                  { expectedUpdatedAt: r.updatedAt },
                                );
                                toast.success('Đã ban hành hợp đồng thành công');
                              } catch (e) {
                                toast.error(
                                  e instanceof Error ? e.message : 'Không thể ban hành',
                                );
                              }
                            }}
                          >
                            <Button
                              permission="hrm.employee.manage"
                              size="xs"
                              className="h-6 text-[14px] px-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                              Ban hành
                            </Button>
                          </Popconfirm>
                          <Popconfirm
                            title="Xóa bản ghi hợp đồng nháp này?"
                            okText="Xóa"
                            onConfirm={async () => {
                              try {
                                await command(`/contracts/${r.id}`, 'DELETE', {
                                  expectedUpdatedAt: r.updatedAt,
                                });
                                toast.success('Đã xóa hợp đồng nháp');
                              } catch (e) {
                                toast.error(
                                  e instanceof Error ? e.message : 'Không thể xóa',
                                );
                              }
                            }}
                          >
                            <Button
                              permission="hrm.employee.manage"
                              size="xs"
                              variant="outline"
                              className="h-6 text-[14px] px-2 text-slate-500 hover:text-rose-600"
                            >
                              Xóa
                            </Button>
                          </Popconfirm>
                        </>
                      )}
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />

      {action && <HrmActionDialog action={action} onClose={() => setAction(null)} />}
    </section>
  );
}
