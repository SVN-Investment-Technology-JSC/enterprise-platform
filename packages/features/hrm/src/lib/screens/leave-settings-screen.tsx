'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Table, type TableColumnsType } from 'antd';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Hourglass,
  Info,
  Pencil,
  Plus,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import type {
  AnnualLeavePolicyResponse,
  HrmLeaveType,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { AnnualLeavePolicyCard } from '../ui/annual-leave-policy-card';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { LeaveReasonDialog } from '../ui/leave-reason-dialog';

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/** Tháng liền trước (YYYY-MM): mặc định khi chạy cộng phép tháng đã kết thúc. */
function previousMonth() {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  return date.toLocaleDateString('en-CA').slice(0, 7);
}

function Notice({
  tone,
  children,
}: {
  tone: 'error' | 'success';
  children: React.ReactNode;
}) {
  const error = tone === 'error';
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`flex items-center gap-2 rounded-lg border p-3 text-xs font-semibold ${
        error
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
      }`}
    >
      {error ? (
        <AlertTriangle className="size-4 shrink-0 text-red-600" />
      ) : (
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
      )}
      <span>{children}</span>
    </div>
  );
}

/**
 * Phép năm và lý do nghỉ: một cột cuộn gồm chính sách phép năm (một biểu mẫu), bảng lý do nghỉ
 * (danh mục cấu hình, có lương / không lương) và các tác vụ định kỳ (thu gọn).
 */
export default function LeaveSettingsScreen() {
  const { can, loading: permissionsLoading } = useHrmPermissions();
  const canManage = can('hrm.leave.manage');
  const canRead = canManage || can('hrm.leave.read');

  const [policy, setPolicy] = useState<AnnualLeavePolicyResponse | null>(null);
  const [policyError, setPolicyError] = useState('');
  const [types, setTypes] = useState<HrmLeaveType[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [typesError, setTypesError] = useState('');
  const [reasonsMessage, setReasonsMessage] = useState('');
  const [reasonDialog, setReasonDialog] = useState<{
    row?: HrmLeaveType;
  } | null>(null);
  const [periodicOpen, setPeriodicOpen] = useState(false);
  const [periodicMessage, setPeriodicMessage] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null);

  const loadPolicy = useCallback(async () => {
    setPolicyError('');
    try {
      const result = await hrmFetch<{ data: AnnualLeavePolicyResponse }>(
        '/annual-leave-policy',
      );
      setPolicy(result.data);
    } catch (error) {
      setPolicyError(errorText(error, 'Không tải được chính sách phép năm'));
    }
  }, []);
  const loadTypes = useCallback(async () => {
    setTypesLoading(true);
    setTypesError('');
    try {
      const result = await hrmFetch<{ data: HrmLeaveType[] }>('/leave-types');
      setTypes(result.data);
    } catch (error) {
      setTypesError(errorText(error, 'Không tải được danh sách lý do nghỉ'));
    } finally {
      setTypesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canRead) return;
    void loadPolicy();
    void loadTypes();
  }, [canRead, loadPolicy, loadTypes]);

  /** Lý do nghỉ đổi thì danh sách lý do chọn làm phép năm (ở chính sách) cũng đổi theo. */
  const reloadReasons = useCallback(
    () => Promise.all([loadTypes(), loadPolicy()]),
    [loadTypes, loadPolicy],
  );

  const rows = useMemo(
    () =>
      [...types].sort(
        (a, b) =>
          Number(Boolean(b.isAnnual)) - Number(Boolean(a.isAnnual)) ||
          Number(b.active) - Number(a.active),
      ),
    [types],
  );

  async function setActive(row: HrmLeaveType, active: boolean, note?: string) {
    setTypesError('');
    setReasonsMessage('');
    try {
      await hrmFetch(`/leave-types/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          active,
          expectedUpdatedAt: row.updatedAt,
          reason:
            note ||
            (active ? 'Dùng lại lý do nghỉ' : 'Ngừng sử dụng lý do nghỉ'),
        }),
      });
      setReasonsMessage(
        active
          ? `Đã cho dùng lại lý do nghỉ "${row.name}".`
          : `Đã ngừng lý do nghỉ "${row.name}" cho các đơn mới.`,
      );
      await reloadReasons();
    } catch (error) {
      setTypesError(errorText(error, 'Không cập nhật được lý do nghỉ'));
    }
  }

  async function runPeriodic(path: string, body: unknown) {
    const result = await hrmFetch<{
      data: {
        credited?: number;
        count?: number;
        reset?: number;
        missingContract?: string[];
        blocked?: unknown[];
      };
    }>(path, { method: 'POST', body: JSON.stringify(body) });
    const { credited, count, reset, missingContract, blocked } = result.data;
    setPeriodicMessage(
      credited !== undefined
        ? `Đã cộng phép cho ${credited} dòng; lượt đã xử lý được bỏ qua.${
            missingContract?.length
              ? ` ${missingContract.length} nhân viên chưa có HĐLĐ chính thức đã ký nên chưa được cộng phép theo HĐ.`
              : ''
          }`
        : reset !== undefined
          ? `Đã chuyển phép ${count ?? 0} quỹ và reset ${reset} quỹ cuối năm.${
              blocked?.length
                ? ` ${blocked.length} quỹ chưa chốt vì còn đơn nghỉ chờ duyệt; xử lý đơn rồi chạy lại.`
                : ''
            }`
          : count !== undefined
            ? `Đã xử lý ${count} dòng.`
            : 'Đã ghi nhận dữ liệu.',
    );
  }

  if (!permissionsLoading && !canRead) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-[1200px] rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500"
      >
        Bạn không có quyền xem phép năm và lý do nghỉ.
      </div>
    );
  }

  const columns: TableColumnsType<HrmLeaveType> = [
    {
      title: 'Tên',
      dataIndex: 'name',
      render: (value: string, r) => (
        <span
          className={`font-semibold ${r.active ? 'text-slate-900' : 'text-slate-500'}`}
        >
          {value}
        </span>
      ),
    },
    {
      title: 'Mã',
      dataIndex: 'code',
      width: 140,
      render: (value: string) => (
        <span className="font-mono text-[11px] text-slate-600">{value}</span>
      ),
    },
    {
      title: 'Hưởng lương',
      width: 130,
      render: (_, r) =>
        r.paid ? (
          <Badge className="border-emerald-200 bg-emerald-50 text-xs text-emerald-700">
            Có lương
          </Badge>
        ) : (
          <Badge className="border-slate-200 bg-slate-100 text-xs text-slate-600">
            Không lương
          </Badge>
        ),
    },
    {
      title: 'Trừ quỹ phép năm',
      width: 170,
      render: (_, r) =>
        r.isAnnual ? (
          <span className="flex items-center gap-1.5 text-xs text-slate-700">
            Có
            <Badge className="border-blue-200 bg-blue-50 text-xs text-blue-700">
              Phép năm
            </Badge>
          </span>
        ) : (
          <span className="text-xs text-slate-500">Không</span>
        ),
    },
    {
      title: 'Cần chứng từ',
      width: 120,
      render: (_, r) => (
        <span className="text-xs text-slate-700">
          {r.requiresAttachment ? 'Có' : 'Không'}
        </span>
      ),
    },
    {
      title: 'Trạng thái',
      width: 130,
      render: (_, r) =>
        r.mergedIntoId ? (
          <Badge className="border-slate-200 bg-slate-100 text-xs text-slate-600">
            Đã gộp
          </Badge>
        ) : r.active ? (
          <Badge className="border-emerald-200 bg-emerald-50 text-xs text-emerald-700">
            Đang dùng
          </Badge>
        ) : (
          <Badge className="border-slate-200 bg-slate-100 text-xs text-slate-600">
            Đã ngừng
          </Badge>
        ),
    },
    ...(canManage
      ? [
          {
            title: 'Thao tác',
            width: 190,
            render: (_: unknown, r: HrmLeaveType) => (
              <div className="flex gap-1.5">
                <Button
                  size="xs"
                  variant="outline"
                  aria-label={`Sửa ${r.name}`}
                  onClick={() => setReasonDialog({ row: r })}
                  className="h-7 px-2 text-xs"
                >
                  <Pencil className="mr-1 size-3" />
                  Sửa
                </Button>
                {r.isAnnual || r.mergedIntoId ? null : r.active ? (
                  <Popconfirm
                    title="Ngừng lý do nghỉ này cho các đơn mới?"
                    description="Đơn đã tạo và sổ phép hiện có được giữ nguyên."
                    okText="Xác nhận"
                    cancelText="Quay lại"
                    reasonRequired
                    reasonLabel="Ghi chú thay đổi"
                    reasonPlaceholder="Ví dụ: không còn áp dụng"
                    onConfirm={(note) => setActive(r, false, note)}
                  >
                    <Button
                      size="xs"
                      variant="destructive"
                      aria-label={`Ngừng ${r.name}`}
                      className="h-7 px-2 text-xs"
                    >
                      <XCircle className="mr-1 size-3" />
                      Ngừng
                    </Button>
                  </Popconfirm>
                ) : (
                  <Popconfirm
                    title="Cho dùng lại lý do nghỉ này?"
                    okText="Xác nhận"
                    cancelText="Quay lại"
                    okType="primary"
                    reasonRequired
                    reasonLabel="Ghi chú thay đổi"
                    reasonPlaceholder="Ví dụ: áp dụng lại từ tháng này"
                    onConfirm={(note) => setActive(r, true, note)}
                  >
                    <Button
                      size="xs"
                      variant="outline"
                      aria-label={`Dùng lại ${r.name}`}
                      className="h-7 px-2 text-xs"
                    >
                      <RotateCcw className="mr-1 size-3" />
                      Dùng lại
                    </Button>
                  </Popconfirm>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <CalendarDays className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Phép năm và lý do nghỉ
          </h1>
          <p className="max-w-[90ch] text-xs text-slate-500">
            Cấu hình một chính sách phép năm cho toàn bộ nhân viên và danh mục
            lý do nghỉ. Quỹ phép và sổ giao dịch xem tại Quỹ phép.
          </p>
        </div>
      </div>

      <AnnualLeavePolicyCard
        data={policy}
        loadError={policyError}
        canManage={canManage}
        onSaved={async (next) => {
          setPolicy(next);
          await loadTypes();
        }}
        onReload={() => void loadPolicy()}
      />

      <section
        aria-labelledby="leave-reasons-heading"
        className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h2
              id="leave-reasons-heading"
              className="text-base font-bold tracking-tight text-slate-900"
            >
              Lý do nghỉ
            </h2>
            <p className="mt-1 max-w-[90ch] text-xs text-slate-500">
              Lý do nghỉ do quản trị cấu hình tại đây; người làm đơn chọn một
              lý do rồi nhập thêm Mô tả nếu cần.
            </p>
          </div>
          <Button
            permission="hrm.leave.manage"
            onClick={() => setReasonDialog({})}
            className="flex items-center gap-1.5 bg-blue-600 text-xs text-white shadow-xs hover:bg-blue-700"
          >
            <Plus className="size-4" />
            <span>Thêm lý do nghỉ</span>
          </Button>
        </div>
        <p
          role="note"
          className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"
        >
          <Info className="mt-0.5 size-3.5 shrink-0 text-slate-500" />
          <span>
            <strong className="font-semibold text-slate-700">Lý do nghỉ</strong>{' '}
            là danh mục cấu hình ở bảng này (có lương hay không lương).{' '}
            <strong className="font-semibold text-slate-700">Mô tả</strong> là
            văn bản tự do người làm đơn nhập thêm ở màn tạo đơn, không cấu hình
            ở đây. Chỉ lý do Phép năm trừ quỹ phép; các lý do còn lại không bao
            giờ trừ quỹ.
          </span>
        </p>
        {typesError ? <Notice tone="error">{typesError}</Notice> : null}
        {reasonsMessage ? (
          <Notice tone="success">{reasonsMessage}</Notice>
        ) : null}
        <Table<HrmLeaveType>
          size="small"
          rowKey="id"
          loading={typesLoading}
          dataSource={rows}
          columns={columns}
          scroll={{ x: 'max-content' }}
          locale={{
            emptyText: 'Chưa có lý do nghỉ nào. Bấm Thêm lý do nghỉ để tạo.',
          }}
          pagination={{
            pageSize: 20,
            hideOnSinglePage: true,
            showTotal: (total, range) =>
              `Hiển thị ${range[0]}–${range[1]} / ${total} lý do nghỉ`,
          }}
        />
      </section>

      {canManage ? (
        <section
          aria-labelledby="leave-periodic-heading"
          className="rounded-xl border border-slate-200 bg-white shadow-xs"
        >
          <h2 id="leave-periodic-heading" className="m-0">
            <button
              type="button"
              aria-expanded={periodicOpen}
              aria-controls="leave-periodic-panel"
              onClick={() => setPeriodicOpen((open) => !open)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-xl p-5 text-left text-base font-bold tracking-tight text-slate-900 hover:bg-slate-50"
            >
              {periodicOpen ? (
                <ChevronDown className="size-4 text-slate-500" />
              ) : (
                <ChevronRight className="size-4 text-slate-500" />
              )}
              Tác vụ định kỳ
              <span className="text-xs font-normal text-slate-500">
                Chạy thủ công khi cần
              </span>
            </button>
          </h2>
          {periodicOpen ? (
            <div
              id="leave-periodic-panel"
              className="space-y-3 border-t border-slate-100 p-5"
            >
              {periodicMessage ? (
                <Notice tone="success">{periodicMessage}</Notice>
              ) : null}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    className="flex items-center gap-1.5 text-xs"
                    onClick={() => {
                      setPeriodicMessage('');
                      setAction({
                        title: 'Cộng phép tháng',
                        description:
                          'Cộng phép cho một tháng đã kết thúc theo Chính sách phép năm. Lượt đã xử lý được bỏ qua nên chạy lại không bị cộng trùng.',
                        fields: [
                          {
                            key: 'month',
                            label: 'Tháng đã kết thúc',
                            type: 'month',
                            value: previousMonth(),
                          },
                        ],
                        submit: (v) =>
                          runPeriodic('/leave-accruals/run', { month: v.month }),
                      });
                    }}
                  >
                    <Clock className="size-3.5" />
                    <span>Cộng phép tháng</span>
                  </Button>
                  <p className="text-[11px] leading-snug text-slate-500">
                    Cộng phép của một tháng đã kết thúc cho mọi nhân viên đủ
                    điều kiện.
                  </p>
                </div>
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    className="flex items-center gap-1.5 text-xs"
                    onClick={() => {
                      setPeriodicMessage('');
                      setAction({
                        title: 'Chuyển phép sang năm sau',
                        description:
                          'Chuyển tối đa số ngày đã cấu hình ở Chính sách phép năm (kèm hạn dùng), phần vượt bị reset. Nếu chính sách không cho chuyển (0 ngày), reset toàn bộ phần còn lại. Mọi bút toán được ghi vào sổ giao dịch.',
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
                          runPeriodic('/leave-carryovers/run', {
                            year: Number(v.year),
                          }),
                      });
                    }}
                  >
                    <ArrowRightLeft className="size-3.5" />
                    <span>Chuyển phép sang năm sau</span>
                  </Button>
                  <p className="text-[11px] leading-snug text-slate-500">
                    Chốt phép cuối năm: chuyển phần còn lại theo chính sách,
                    reset phần vượt.
                  </p>
                </div>
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    className="flex items-center gap-1.5 text-xs"
                    onClick={() => {
                      setPeriodicMessage('');
                      setAction({
                        title: 'Hết hạn phép chuyển',
                        description:
                          'Xử lý phần phép chuyển đã quá hạn dùng tính đến ngày đối soát.',
                        fields: [
                          {
                            key: 'date',
                            label: 'Đối soát đến ngày',
                            type: 'date',
                            value: new Date().toLocaleDateString('en-CA'),
                          },
                        ],
                        submit: (v) =>
                          runPeriodic('/leave-carryovers/expire', {
                            date: v.date,
                          }),
                      });
                    }}
                  >
                    <Hourglass className="size-3.5" />
                    <span>Hết hạn phép chuyển</span>
                  </Button>
                  <p className="text-[11px] leading-snug text-slate-500">
                    Xử lý phép chuyển đã quá hạn dùng.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {reasonDialog ? (
        <LeaveReasonDialog
          row={reasonDialog.row}
          onClose={() => setReasonDialog(null)}
          onSaved={async (text) => {
            setReasonsMessage(text);
            await reloadReasons();
          }}
        />
      ) : null}
      {action ? (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      ) : null}
    </div>
  );
}
