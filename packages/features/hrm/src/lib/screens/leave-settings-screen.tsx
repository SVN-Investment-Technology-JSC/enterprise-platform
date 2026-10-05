'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import {
  CalendarOff,
  Plus,
  Calendar,
  Clock,
  ArrowRightLeft,
  Hourglass,
  CheckCircle2,
  AlertTriangle,
  Pencil,
  XCircle,
} from 'lucide-react';
import type { HrmLeaveType } from '@enterprise-platform/contracts-hrm';
import { hrmFetch, hrmEmployeeOptions } from '../hrm-api';
import {
  LEAVE_SETTINGS_TABS,
  resolveLeaveSettingsTab,
  type LeaveSettingsTabId,
} from '../hrm-navigation';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { useHrmPermissions } from '../hrm-permissions';
import { LeaveLedger } from '../ui/leave-ledger';
import { HrmLeaveSchedules } from '../ui/hrm-leave-schedules';

const yesNo = [
  { value: 'true', label: 'Có' },
  { value: 'false', label: 'Không' },
];

export default function LeaveSettingsScreen() {
  const { can } = useHrmPermissions();
  const [types, setTypes] = useState<HrmLeaveType[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null);
  const [employees, setEmployees] = useState<
    { value: string; label: string }[]
  >([]);

  const [similar, setSimilar] = useState<
    { a: { code: string; name: string }; b: { code: string; name: string } }[]
  >([]);

  // Tab navigation & URL Sync
  const allowedTabs = LEAVE_SETTINGS_TABS.filter((tab) => can(tab.permission));
  const allowedTabIds = allowedTabs.map((tab) => tab.id);
  const [requestedTab, setRequestedTab] = useState<string | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const activeTab = resolveLeaveSettingsTab(
    requestedTab,
    allowedTabIds,
  ) as LeaveSettingsTabId | '';

  useEffect(() => {
    const sync = () => {
      setRequestedTab(new URLSearchParams(window.location.search).get('tab'));
      setUrlReady(true);
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const selectTab = useCallback((tab: LeaveSettingsTabId) => {
    setRequestedTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url);
  }, []);

  useEffect(() => {
    if (urlReady && activeTab && requestedTab !== activeTab) {
      selectTab(activeTab);
    }
  }, [activeTab, requestedTab, selectTab, urlReady]);

  const load = useCallback(async () => {
    const [t, e] = await Promise.all([
      hrmFetch<{ data: HrmLeaveType[] }>('/leave-types'),
      hrmEmployeeOptions(),
    ]);
    setTypes(t.data);
    setEmployees(e);
    try {
      const s = await hrmFetch<{ data: typeof similar }>(
        '/leave-types/similar-names',
      );
      setSimilar(s.data);
    } catch {
      setSimilar([]);
    }
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);

  async function save(path: string, body: unknown) {
    const result = await hrmFetch<{
      data: { credited?: number; count?: number };
      meta?: { similarTo?: { code: string; name: string }[] };
    }>(path, { method: 'POST', body: JSON.stringify(body) });
    const near = result.meta?.similarTo ?? [];
    setMessage(
      near.length
        ? `Đã thêm loại nghỉ. Cảnh báo: tên gần giống ${near
            .map((n) => `${n.name} (${n.code})`)
            .join(', ')}; cân nhắc dùng "Gộp loại nghỉ".`
        : result.data.credited !== undefined
        ? `Đã cộng phép cho ${result.data.credited} dòng; lượt đã xử lý được bỏ qua.`
        : result.data.count !== undefined
          ? `Đã xử lý ${result.data.count} dòng.`
          : 'Đã ghi nhận dữ liệu.',
    );
    await load();
  }

  function editLeaveType(row: HrmLeaveType, deactivate = false) {
    setAction({
      title: deactivate ? 'Ngừng sử dụng loại nghỉ' : `Cập nhật ${row.code}`,
      confirmTitle: deactivate ? 'Ngừng loại nghỉ cho các đơn mới?' : undefined,
      description:
        'Giữ dữ liệu và sổ phép hiện có. Chế độ hưởng lương/trừ quỹ của loại đã có đơn không được sửa lại.',
      fields: deactivate
        ? [{ key: 'reason', label: 'Lý do' }]
        : [
            { key: 'name', label: 'Tên loại nghỉ', value: row.name },
            {
              key: 'paid',
              label: 'Hưởng lương',
              options: yesNo,
              value: String(row.paid),
            },
            {
              key: 'deductBalance',
              label: 'Trừ quỹ phép',
              options: yesNo,
              value: String(row.deductBalance),
            },
            {
              key: 'requiresAttachment',
              label: 'Yêu cầu chứng từ',
              options: yesNo,
              value: String(row.requiresAttachment),
            },
            {
              key: 'negativeLimit',
              label: 'Hạn mức âm phép',
              type: 'number',
              min: 0,
              max: 366,
              step: '0.5',
              value: row.negativeLimit,
            },
            {
              key: 'carryoverAllowed',
              label: 'Chuyển phép sang năm',
              options: yesNo,
              value: String(row.carryoverAllowed),
            },
            {
              key: 'maxCarryoverDays',
              label: 'Số ngày chuyển tối đa',
              type: 'number',
              min: 0,
              max: 366,
              step: '0.5',
              value: row.maxCarryoverDays,
            },
            {
              key: 'carryoverExpiryMonth',
              label: 'Tháng hết hạn phép chuyển',
              type: 'number',
              min: 1,
              max: 12,
              value: row.carryoverExpiryMonth,
            },
            {
              key: 'active',
              label: 'Đang sử dụng',
              options: yesNo,
              value: String(row.active),
            },
            { key: 'reason', label: 'Lý do' },
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
              carryoverAllowed: v.carryoverAllowed === 'true',
              maxCarryoverDays: Number(v.maxCarryoverDays),
              carryoverExpiryMonth: Number(v.carryoverExpiryMonth),
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
        await load();
      },
    });
  }

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Page Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <CalendarOff className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Quản lý Quỹ phép & Loại nghỉ
            </h1>
            <p className="text-xs text-slate-500 max-w-[85ch]">
              Định mức ngày nghỉ, chế độ thâm niên, hạn mức ứng âm phép và chính sách kết chuyển phép cuối năm.
            </p>
          </div>
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

      {similar.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold text-amber-800 shadow-xs flex items-start gap-2"
        >
          <AlertTriangle className="size-4 shrink-0 text-amber-600" />
          <span>
            Có loại nghỉ tên gần giống nhau:{' '}
            {similar
              .map((p) => `${p.a.name} (${p.a.code}) và ${p.b.name} (${p.b.code})`)
              .join('; ')}
            . Cân nhắc dùng nút "Gộp loại nghỉ".
          </span>
        </div>
      )}

      {/* 2. Page-level Tabs Navigation (Đồng bộ với layout của policies) */}
      {allowedTabs.length === 0 ? (
        <div
          role="alert"
          className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 text-center"
        >
          Bạn không có quyền xem cấu hình quỹ phép.
        </div>
      ) : (
        <div
          role="tablist"
          aria-label="Cấu hình quỹ phép và loại nghỉ"
          className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3"
        >
          {allowedTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`leave-settings-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`leave-settings-panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => selectTab(tab.id)}
                className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-xs font-semibold'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="min-h-0">
        {/* TAB 1: Danh mục loại nghỉ */}
        <section
          id="leave-settings-panel-types"
          role="tabpanel"
          aria-labelledby="leave-settings-tab-types"
          hidden={activeTab !== 'types'}
          className="rounded-xl border border-slate-200 bg-white shadow-xs p-5 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
                Danh mục các loại nghỉ phép ({types.length})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Quản lý các hình thức nghỉ phép, chế độ tính lương và hạn mức ứng phép.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                permission="hrm.leave.manage"
                onClick={() =>
                  setAction({
                    title: 'Thêm loại nghỉ mới',
                    fields: [
                      { key: 'code', label: 'Mã loại (VD: AL, SL)' },
                      { key: 'name', label: 'Tên loại nghỉ' },
                      {
                        key: 'unit',
                        label: 'Đơn vị tính',
                        options: [
                          { value: 'DAYS', label: 'Ngày' },
                          { value: 'HOURS', label: 'Giờ' },
                        ],
                        value: 'DAYS',
                      },
                      {
                        key: 'paid',
                        label: 'Hưởng lương',
                        options: yesNo,
                        value: 'true',
                      },
                      {
                        key: 'deductBalance',
                        label: 'Trừ quỹ phép',
                        options: yesNo,
                        value: 'true',
                      },
                      {
                        key: 'requiresAttachment',
                        label: 'Yêu cầu chứng từ kèm theo',
                        options: yesNo,
                        value: 'false',
                      },
                      {
                        key: 'negativeLimit',
                        label: 'Hạn mức ứng / âm phép',
                        type: 'number',
                        min: 0,
                        value: 0,
                        step: '0.5',
                      },
                      {
                        key: 'carryoverAllowed',
                        label: 'Cho phép chuyển sang năm sau',
                        options: yesNo,
                        value: 'false',
                      },
                      {
                        key: 'maxCarryoverDays',
                        label: 'Số lượng chuyển tối đa',
                        type: 'number',
                        min: 0,
                        value: 0,
                        step: '0.5',
                      },
                      {
                        key: 'carryoverExpiryMonth',
                        label: 'Hết hạn vào cuối tháng (1-12)',
                        type: 'number',
                        min: 1,
                        max: 12,
                        value: 3,
                      },
                    ],
                    submit: (v) =>
                      save('/leave-types', {
                        ...v,
                        paid: v.paid === 'true',
                        deductBalance: v.deductBalance === 'true',
                        requiresAttachment: v.requiresAttachment === 'true',
                        carryoverAllowed: v.carryoverAllowed === 'true',
                        negativeLimit: Number(v.negativeLimit),
                        maxCarryoverDays: Number(v.maxCarryoverDays),
                        carryoverExpiryMonth: Number(v.carryoverExpiryMonth),
                      }),
                  })
                }
                className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 shadow-xs text-xs"
              >
                <Plus className="size-4" />
                <span>Thêm loại nghỉ</span>
              </Button>
              <Button
                permission="hrm.leave.manage"
                variant="outline"
                onClick={() => {
                  const options = types
                    .filter((t) => t.active && !t.mergedIntoId)
                    .map((t) => ({
                      value: t.id,
                      label: `${t.name} (${t.code}, ${t.unit === 'HOURS' ? 'giờ' : 'ngày'})`,
                    }));
                  setAction({
                    title: 'Gộp loại nghỉ',
                    description:
                      'Chuyển toàn bộ quỹ, sổ giao dịch, đơn nghỉ, phép chuyển và lịch cộng phép (không trùng kỳ) từ loại nguồn sang loại đích trong một giao dịch có ghi kiểm toán. Loại nguồn sẽ ngừng sử dụng. Chỉ gộp được hai loại cùng đơn vị tính, cùng chế độ hưởng lương và trừ quỹ.',
                    confirmTitle: 'Gộp loại nguồn vào loại đích? Không hoàn tác được.',
                    fields: [
                      { key: 'sourceId', label: 'Loại nguồn (sẽ ngừng dùng)', options },
                      { key: 'targetId', label: 'Loại đích (giữ lại)', options },
                      { key: 'reason', label: 'Lý do gộp' },
                    ],
                    submit: async (v) => {
                      const r = await hrmFetch<{
                        data: {
                          balances: number;
                          transactions: number;
                          requests: number;
                          schedulesMoved: number;
                        };
                      }>('/leave-types/merge', {
                        method: 'POST',
                        body: JSON.stringify(v),
                      });
                      setMessage(
                        `Đã gộp: ${r.data.balances} quỹ, ${r.data.transactions} giao dịch, ${r.data.requests} đơn, ${r.data.schedulesMoved} lịch cộng phép.`,
                      );
                      await load();
                    },
                  });
                }}
                className="text-xs"
              >
                Gộp loại nghỉ
              </Button>
            </div>
          </div>

          <Table<HrmLeaveType>
            size="small"
            rowKey="id"
            dataSource={types}
            scroll={{ x: 1100, y: 460 }}
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showTotal: (total, range) => `Hiển thị ${range[0]}–${range[1]} / ${total} loại nghỉ`,
            }}
            columns={[
              {
                title: 'Loại nghỉ',
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
                title: 'Trừ quỹ',
                render: (_, r) =>
                  r.deductBalance ? (
                    <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs">Trừ quỹ</Badge>
                  ) : (
                    <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs">Không trừ</Badge>
                  ),
              },
              {
                title: 'Hạn mức âm',
                dataIndex: 'negativeLimit',
                width: 120,
                render: (v) => <span className="text-xs text-slate-700">{v} {v ? 'ngày' : ''}</span>,
              },
              {
                title: 'Chuyển tối đa',
                dataIndex: 'maxCarryoverDays',
                width: 120,
                render: (v) => <span className="text-xs text-slate-700">{v} {v ? 'ngày' : ''}</span>,
              },
              {
                title: 'Hết hạn tháng',
                dataIndex: 'carryoverExpiryMonth',
                width: 120,
                render: (v) => <span className="text-xs text-slate-700">{v ? `Tháng ${v}` : '—'}</span>,
              },
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

        {/* TAB 2: Quỹ và sổ giao dịch phép */}
        <section
          id="leave-settings-panel-ledger"
          role="tabpanel"
          aria-labelledby="leave-settings-tab-ledger"
          hidden={activeTab !== 'ledger'}
          className="space-y-4"
        >
          {can('hrm.leave.read') && (
            <LeaveLedger employees={employees} types={types} />
          )}
        </section>

        {/* TAB 3: Lịch cộng phép & Thao tác kết chuyển */}
        <section
          id="leave-settings-panel-schedules"
          role="tabpanel"
          aria-labelledby="leave-settings-tab-schedules"
          hidden={activeTab !== 'schedules'}
          className="space-y-4"
        >
          {/* Action Toolbar for schedules & period-end batch runs */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Vận hành Cộng phép & Kết chuyển</h3>
              <p className="text-xs text-slate-500">Chốt cộng dồn ngày phép định kỳ và xử lý hạn mức phép tồn chuyển năm.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                permission="hrm.leave.manage"
                onClick={() =>
                  setAction({
                    title: 'Lập lịch cộng phép',
                    fields: [
                      {
                        key: 'leaveTypeId',
                        label: 'Loại nghỉ',
                        options: types.map((t) => {
                          const isInactive = !t.active || Boolean(t.mergedIntoId);
                          return {
                            value: t.id,
                            label: `${t.name}${isInactive ? ' [Ngừng sử dụng]' : ''}`,
                          };
                        }),
                      },
                      { key: 'effectiveFrom', label: 'Hiệu lực từ', type: 'date' },
                      {
                        key: 'effectiveTo',
                        label: 'Hiệu lực đến',
                        type: 'date',
                        optional: true,
                      },
                      {
                        key: 'accrualFrequency',
                        label: 'Chu kỳ',
                        options: [
                          { value: 'MONTHLY', label: 'Cuối tháng' },
                          { value: 'QUARTERLY', label: 'Cuối quý' },
                          { value: 'YEARLY', label: 'Cuối năm' },
                        ],
                      },
                      {
                        key: 'accrualAmount',
                        label: 'Số lượng mỗi chu kỳ',
                        type: 'number',
                        min: 0,
                        step: '0.01',
                      },
                      {
                        key: 'prorationRule',
                        label: 'Phân bổ theo thời gian làm việc',
                        options: [
                          { value: 'BY_JOIN_DATE', label: 'Theo ngày vào làm' },
                          { value: 'NONE', label: 'Đủ định mức kỳ' },
                        ],
                        value: 'BY_JOIN_DATE',
                      },
                      {
                        key: 'seniorityBonusYears',
                        label: 'Mỗi số năm thâm niên',
                        type: 'number',
                        min: 0,
                        value: 0,
                      },
                      {
                        key: 'seniorityBonusDays',
                        label: 'Số lượng phép tăng thêm',
                        type: 'number',
                        min: 0,
                        value: 0,
                        step: '0.5',
                      },
                    ],
                    submit: (v) =>
                      save(`/leave-types/${v.leaveTypeId}/accrual-schedules`, {
                        ...v,
                        effectiveTo: v.effectiveTo || null,
                        accrualAmount: Number(v.accrualAmount),
                        seniorityBonusYears: Number(v.seniorityBonusYears),
                        seniorityBonusDays: Number(v.seniorityBonusDays),
                      }),
                  })
                }
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs flex items-center gap-1.5 shadow-xs"
              >
                <Calendar className="size-3.5" />
                <span>Lập lịch cộng phép</span>
              </Button>
              <Button
                permission="hrm.leave.manage"
                variant="outline"
                onClick={() =>
                  setAction({
                    title: 'Chốt cộng phép tháng',
                    fields: [
                      { key: 'month', label: 'Tháng đã kết thúc', type: 'month' },
                    ],
                    submit: (v) => save('/leave-accruals/run', v),
                  })
                }
                className="text-xs flex items-center gap-1.5"
              >
                <Clock className="size-3.5" />
                <span>Cộng phép tháng</span>
              </Button>
              <Button
                permission="hrm.leave.manage"
                variant="outline"
                onClick={() =>
                  setAction({
                    title: 'Chuyển phép năm',
                    fields: [
                      {
                        key: 'year',
                        label: 'Năm nhận phép chuyển',
                        type: 'number',
                        min: 2000,
                        max: new Date().getFullYear(),
                        value: new Date().getFullYear(),
                      },
                    ],
                    submit: (v) =>
                      save('/leave-carryovers/run', { year: Number(v.year) }),
                  })
                }
                className="text-xs flex items-center gap-1.5"
              >
                <ArrowRightLeft className="size-3.5" />
                <span>Chuyển phép năm</span>
              </Button>
              <Button
                permission="hrm.leave.manage"
                variant="outline"
                onClick={() =>
                  setAction({
                    title: 'Xử lý phép hết hạn',
                    fields: [
                      {
                        key: 'date',
                        label: 'Đối soát đến ngày',
                        type: 'date',
                        value: new Date().toLocaleDateString('en-CA'),
                      },
                    ],
                    submit: (v) => save('/leave-carryovers/expire', v),
                  })
                }
                className="text-xs flex items-center gap-1.5"
              >
                <Hourglass className="size-3.5" />
                <span>Hết hạn phép chuyển</span>
              </Button>
            </div>
          </div>

          {can('hrm.leave.read') && <HrmLeaveSchedules types={types} />}
        </section>
      </div>

      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </div>
  );
}
