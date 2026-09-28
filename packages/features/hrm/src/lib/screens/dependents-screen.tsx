'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import {
  Users,
  Plus,
  Search,
  Pencil,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { hrmFetch, hrmEmployeeOptions } from '../hrm-api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';

type Dependent = {
  updated_at: string;
  id: string;
  employee_name: string;
  employee_code: string;
  full_name: string;
  reference_code: string;
  relationship: string;
  birth_date: string;
  tax_code: string | null;
  evidence_reference: string;
  effective_from: string;
  effective_to: string | null;
};

export default function DependentsScreen() {
  const [rows, setRows] = useState<Dependent[]>([]);
  const [employees, setEmployees] = useState<{ value: string; label: string }[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null);

  const load = useCallback(async () => {
    const [r, e] = await Promise.all([
      hrmFetch<{ data: Dependent[] }>('/dependents'),
      hrmEmployeeOptions(),
    ]);
    setRows(r.data);
    setEmployees(e);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);

  async function command(path: string, body: unknown, method = 'POST') {
    await hrmFetch(path, { method, body: JSON.stringify(body) });
    await load();
  }

  const filtered = rows.filter((r) =>
    `${r.employee_code} ${r.employee_name} ${r.full_name} ${r.reference_code}`
      .toLocaleLowerCase('vi')
      .includes(search.toLocaleLowerCase('vi')),
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Page Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Users className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Hồ sơ Người phụ thuộc
            </h1>
            <p className="text-xs text-slate-500 max-w-[85ch]">
              HR xác minh căn cứ pháp lý và thời gian đăng ký. Số người phụ thuộc tại ngày cuối kỳ được đưa vào tính giảm trừ gia cảnh thuế TNCN.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            permission="hrm.dependent.manage"
            onClick={() =>
              setAction({
                title: 'Ghi nhận đăng ký người phụ thuộc',
                fields: [
                  { key: 'employeeId', label: 'Nhân viên', options: employees },
                  {
                    key: 'referenceCode',
                    label: 'Mã định danh hồ sơ',
                  },
                  { key: 'fullName', label: 'Họ tên người phụ thuộc' },
                  { key: 'relationship', label: 'Quan hệ với nhân viên' },
                  { key: 'birthDate', label: 'Ngày sinh', type: 'date' },
                  { key: 'taxCode', label: 'Mã số thuế', optional: true },
                  {
                    key: 'evidenceReference',
                    label: 'Số hồ sơ / Căn cứ HR đã xác minh',
                  },
                  {
                    key: 'effectiveFrom',
                    label: 'Đăng ký từ ngày',
                    type: 'date',
                  },
                  {
                    key: 'effectiveTo',
                    label: 'Đăng ký đến ngày',
                    type: 'date',
                    optional: true,
                  },
                ],
                submit: (v) => command('/dependents', v),
              })
            }
            className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 shadow-xs text-xs"
          >
            <Plus className="size-4" />
            <span>Thêm đăng ký</span>
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

      {/* 2. Filter Bar */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <Input
            className="pl-9 text-xs h-9"
            aria-label="Tìm hồ sơ người phụ thuộc"
            placeholder="Tìm theo mã NV, tên NV, tên người phụ thuộc, mã hồ sơ…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* 3. Table Card */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-xs p-5 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Danh sách hồ sơ người phụ thuộc ({filtered.length})
          </span>
        </div>
        <Table<Dependent>
          size="small"
          rowKey="id"
          dataSource={filtered}
          pagination={{
            pageSize: 15,
            showSizeChanger: true,
            showTotal: (total, range) => `Hiển thị ${range[0]}–${range[1]} / ${total} hồ sơ`,
          }}
          scroll={{ x: 1400, y: 520 }}
          columns={[
            {
              title: 'Nhân viên',
              fixed: 'left',
              width: 200,
              render: (_, r) => (
                <div>
                  <span className="font-semibold text-slate-900 block">{r.employee_name}</span>
                  <span className="text-[11px] font-mono text-slate-500">{r.employee_code}</span>
                </div>
              ),
            },
            {
              title: 'Người phụ thuộc',
              render: (_, r) => (
                <div>
                  <span className="font-semibold text-slate-900 block">{r.full_name}</span>
                  <span className="text-[11px] text-slate-500">Quan hệ: {r.relationship}</span>
                </div>
              ),
            },
            {
              title: 'Mã hồ sơ',
              dataIndex: 'reference_code',
              width: 140,
              render: (v) => <span className="font-mono text-xs text-slate-700">{v}</span>,
            },
            {
              title: 'Ngày sinh',
              dataIndex: 'birth_date',
              width: 110,
              render: (v) => <span className="text-xs text-slate-700">{v}</span>,
            },
            {
              title: 'MST người PT',
              dataIndex: 'tax_code',
              width: 130,
              render: (v) => <span className="font-mono text-xs text-slate-700">{v || '—'}</span>,
            },
            {
              title: 'Hiệu lực giảm trừ',
              render: (_, r) => {
                const isExpired = r.effective_to && r.effective_to < today;
                return (
                  <div>
                    <span className="text-xs text-slate-800 block">
                      {r.effective_from} → {r.effective_to || 'Đến nay'}
                    </span>
                    {isExpired ? (
                      <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px] mt-0.5">Hết hiệu lực</Badge>
                    ) : (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] mt-0.5">Đang áp dụng</Badge>
                    )}
                  </div>
                );
              },
            },
            {
              title: 'Căn cứ xác minh HR',
              dataIndex: 'evidence_reference',
              render: (v) => <span className="text-xs text-slate-600">{v}</span>,
            },
            {
              title: 'Thao tác',
              width: 150,
              fixed: 'right',
              render: (_, r) => (
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    permission="hrm.dependent.manage"
                    onClick={() =>
                      setAction({
                        title: `Điều chỉnh đăng ký · ${r.full_name}`,
                        columns: 2,
                        description:
                          'Điều chỉnh cần căn cứ xác minh; không được tác động kỳ lương đã chốt.',
                        fields: [
                          {
                            key: 'fullName',
                            label: 'Họ tên',
                            value: r.full_name,
                          },
                          {
                            key: 'relationship',
                            label: 'Quan hệ',
                            value: r.relationship,
                          },
                          {
                            key: 'birthDate',
                            label: 'Ngày sinh',
                            type: 'date',
                            value: r.birth_date,
                          },
                          {
                            key: 'taxCode',
                            label: 'Mã số thuế',
                            optional: true,
                            value: r.tax_code || '',
                          },
                          {
                            key: 'effectiveFrom',
                            label: 'Từ ngày',
                            type: 'date',
                            value: r.effective_from,
                          },
                          {
                            key: 'effectiveTo',
                            label: 'Đến ngày',
                            type: 'date',
                            optional: true,
                            value: r.effective_to || '',
                          },
                          {
                            key: 'evidenceReference',
                            label: 'Căn cứ xác minh',
                            value: r.evidence_reference,
                          },
                          { key: 'reason', label: 'Lý do điều chỉnh' },
                        ],
                        submit: (v) =>
                          command(
                            `/dependents/${r.id}`,
                            {
                              ...v,
                              taxCode: v.taxCode || null,
                              effectiveTo: v.effectiveTo || null,
                              expectedUpdatedAt: r.updated_at,
                            },
                            'PATCH',
                          ),
                      })
                    }
                    className="h-7 text-xs px-2"
                  >
                    <Pencil className="size-3 mr-1" />
                    Sửa
                  </Button>
                  <Button
                    variant="outline"
                    permission="hrm.dependent.manage"
                    onClick={() =>
                      setAction({
                        title: `Kết thúc đăng ký — ${r.full_name}`,
                        confirmTitle:
                          'Kết thúc đăng ký theo chứng từ đã xác minh?',
                        fields: [
                          {
                            key: 'effectiveTo',
                            label: 'Ngày cuối còn hiệu lực',
                            type: 'date',
                            value: r.effective_to || '',
                          },
                          { key: 'reason', label: 'Lý do' },
                          {
                            key: 'evidenceReference',
                            label: 'Căn cứ xác minh',
                            value: r.evidence_reference,
                          },
                        ],
                        submit: (v) =>
                          command(`/dependents/${r.id}/end`, {
                            ...v,
                            expectedUpdatedAt: r.updated_at,
                          }),
                      })
                    }
                    className="h-7 text-xs px-2 text-amber-700 hover:bg-amber-50 border-amber-200"
                  >
                    <XCircle className="size-3 mr-1" />
                    Kết thúc
                  </Button>
                </div>
              ),
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
