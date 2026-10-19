'use client';

import {
  Download,
  ListChecks,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import type {
  HrmCorePerson,
  HrmEmployeeProfile,
} from '@enterprise-platform/contracts-hrm';
import { useCallback, useEffect, useState, useMemo } from 'react';
import { EmployeeLifecycleActions, employmentLabels } from '../ui/hrm-lifecycle-actions';
import { EmployeeDetailDialog } from '../ui/employee-detail-dialog';
import { EmployeeAvatar, EmployeePagination, EmployeeStatCards, type EmployeeCardFilter } from '../ui/employee-list-parts';
import { BulkInitializeEmployeesDialog } from '../ui/bulk-initialize-employees-dialog';
import { PersonnelDecisionDialog } from '../ui/personnel-decision-dialog';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { hrmFetch } from '../hrm-api';
import {
  downloadEmployeesXlsx,
  distinctValues,
  employeeCompleteness,
  employeeInitials,
  employeeStats,
  isActiveEmployee,
  normalizeSearchText,
} from '../hrm-employee-view';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { toast } from '../ui/toast';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';

/** Số nhân viên mỗi trang của danh sách. */
const EMPLOYEE_PAGE_SIZE = 12;

function formatVnDate(val?: string | null): string {
  if (!val) return '----';
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split('-');
    return `${d}/${m}/${y}`;
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val).slice(0, 10);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export default function EmployeesManagementPage() {
  const { can } = useHrmPermissions();
  const [refreshingCore, setRefreshingCore] = useState(false);
  const [bulkInitializeOpen, setBulkInitializeOpen] = useState(false);
  const [accountAction, setAccountAction] = useState<HrmAction | null>(null);
  const [employeeError, setEmployeeError] = useState('');

  // Master States từ Database
  const [employeesList, setEmployeesList] = useState<HrmEmployeeProfile[]>([]);
  const [selectedEmployee, setSelectedEmployee] =
    useState<HrmEmployeeProfile | null>(null);
  const [isEmployeeDrawerOpen, setIsEmployeeDrawerOpen] = useState(false);
  const [decisionEmployeeId, setDecisionEmployeeId] = useState<string | null>(null);

  // Số người ở Core chưa có hồ sơ HRM (chỉ tải khi có quyền manage; lỗi thì bỏ qua)
  const [pendingCoreCount, setPendingCoreCount] = useState(0);

  // Search & Filter (Tab 1: Employees)
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  // Lọc theo thẻ tổng quan (đang làm việc, nghỉ việc, chờ hoàn thiện hồ sơ); 'ALL' là không lọc.
  const [cardFilter, setCardFilter] = useState<EmployeeCardFilter>('ALL');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  /** Nhân viên được tick ở cột đầu bảng (dùng để xuất danh sách đã chọn). */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // Loading States
  const [isLoading, setIsLoading] = useState(true);

  // 1. Tải danh sách nhân sự từ Database API
  const fetchEmployeesFromDb = useCallback(async () => {
    try {
      setIsLoading(true);
      setEmployeeError('');
      const records: HrmEmployeeProfile[] = [];
      let page = 1;
      let total = 0;
      do {
        const payload = await hrmFetch<{
          data: HrmEmployeeProfile[];
          meta: { total: number };
        }>(`/employees?page_size=100&page=${page}`);
        records.push(...payload.data);
        total = payload.meta.total;
        if (payload.data.length === 0) break;
        page++;
      } while (records.length < total);
      setEmployeesList(records);
      setSelectedEmployee(
        (previous) =>
          records.find((row) => row.employeeId === previous?.employeeId) ??
          records[0] ??
          null,
      );
    } catch (err) {
      setEmployeeError(
        err instanceof Error
          ? err.message
          : 'Không tải được danh sách nhân viên',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Danh sách /employees không kèm người phụ thuộc và hợp đồng nên số trên tab luôn là 0 cho tới khi tab được mở.
  // Mở hồ sơ thì lấy hồ sơ chi tiết, chỉ nhận hai danh sách này; lỗi thì giữ nguyên, tab tự tải khi được mở.
  const detailEmployeeId = isEmployeeDrawerOpen ? (selectedEmployee?.employeeId ?? null) : null;
  useEffect(() => {
    if (!detailEmployeeId) return;
    let cancelled = false;
    hrmFetch<{ data: HrmEmployeeProfile }>(`/employees/${detailEmployeeId}/profile`)
      .then(({ data }) => {
        if (cancelled) return;
        setSelectedEmployee((current) =>
          current?.employeeId === detailEmployeeId
            ? { ...current, dependents: data.dependents ?? [], contracts: data.contracts ?? [] }
            : current,
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [detailEmployeeId]);

  // 4. Đếm người ở Core chưa có hồ sơ HRM (cần hrm.employee.manage)
  const canManageEmployees = can('hrm.employee.manage');
  const fetchPendingCoreCount = useCallback(async () => {
    if (!canManageEmployees) {
      setPendingCoreCount(0);
      return;
    }
    try {
      const payload = await hrmFetch<{ data: HrmCorePerson[] }>(
        '/employees/core-people',
      );
      setPendingCoreCount(payload.data?.length ?? 0);
    } catch {
      setPendingCoreCount(0);
    }
  }, [canManageEmployees]);

  const handleRefreshFromCore = async () => {
    if (refreshingCore) return;
    setRefreshingCore(true);
    try {
      const result = await hrmFetch<{ data: { updated: number } }>(
        '/employees/refresh-from-core',
        { method: 'POST' },
      );
      const updated = result.data?.updated ?? 0;
      toast.success(
        updated > 0
          ? `Đã cập nhật ${updated} nhân sự theo Core`
          : 'Họ tên và email đã khớp với Core',
      );
      await fetchEmployeesFromDb();
    } catch (err) {
      toast.error({
        title: 'Không cập nhật được từ Core',
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setRefreshingCore(false);
    }
  };

  useEffect(() => {
    void fetchEmployeesFromDb();
    void fetchPendingCoreCount();
  }, [
    fetchEmployeesFromDb,
    fetchPendingCoreCount,
  ]);

  // Người xem không có hrm.employee.sensitive không thấy CCCD/MST/ngân hàng: chỉ tính trên trường nhìn thấy
  const canSensitive = can('hrm.employee.sensitive');
  // Lọc danh sách nhân viên
  const filteredEmployees = useMemo(() => {
    return employeesList.filter((emp) => {
      const normalize = normalizeSearchText;
      const term = normalize(searchTerm);
      const matchesSearch =
        !term ||
        (emp.fullName && normalize(emp.fullName).includes(term)) ||
        normalize(emp.employeeCode).includes(term) ||
        (emp.email && normalize(emp.email).includes(term)) ||
        (emp.position && normalize(emp.position).includes(term));
      const matchesStatus =
        statusFilter === 'ALL' || emp.employmentStatus === statusFilter;
      const matchesDepartment =
        departmentFilter === 'ALL' || (emp.department ?? '').trim() === departmentFilter;
      const matchesPosition =
        positionFilter === 'ALL' || (emp.position ?? '').trim() === positionFilter;
      const matchesCard =
        cardFilter === 'ALL' ||
        (cardFilter === 'ACTIVE' && isActiveEmployee(emp)) ||
        (cardFilter === 'INACTIVE' && !isActiveEmployee(emp)) ||
        (cardFilter === 'INCOMPLETE' && employeeCompleteness(emp, canSensitive) < 100);
      return matchesSearch && matchesStatus && matchesDepartment && matchesPosition && matchesCard;
    });
  }, [employeesList, searchTerm, statusFilter, departmentFilter, positionFilter, cardFilter, canSensitive]);

  // Số liệu tổng quan đếm trên mọi hồ sơ đã tải; phân trang trên danh sách đã lọc.
  const stats = useMemo(
    () => employeeStats(employeesList, canSensitive),
    [employeesList, canSensitive],
  );
  const departmentOptions: SearchableSelectOption[] = useMemo(
    () => distinctValues(employeesList, (e) => e.department).map((v) => ({ value: v, label: v })),
    [employeesList],
  );
  const positionFilterOptions: SearchableSelectOption[] = useMemo(
    () => distinctValues(employeesList, (e) => e.position).map((v) => ({ value: v, label: v })),
    [employeesList],
  );
  const pageCount = Math.max(1, Math.ceil(filteredEmployees.length / EMPLOYEE_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => filteredEmployees.slice((safePage - 1) * EMPLOYEE_PAGE_SIZE, safePage * EMPLOYEE_PAGE_SIZE),
    [filteredEmployees, safePage],
  );
  // Đổi bộ lọc thì về trang đầu.
  useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter, departmentFilter, positionFilter, cardFilter]);
  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const togglePage = (checked: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const row of pageRows) {
        if (checked) next.add(row.employeeId);
        else next.delete(row.employeeId);
      }
      return next;
    });

  // Liên kết tài khoản ERP cho nhân sự chưa có tài khoản (dùng ở menu dòng và chân hộp thoại hồ sơ).
  const openLinkAccount = async (emp: HrmEmployeeProfile) => {
    try {
      const accounts = await hrmFetch<{
        data: { id: string; fullName: string; email: string }[];
      }>('/employees/accounts');
      setAccountAction({
        title: `Liên kết tài khoản · ${emp.fullName || emp.employeeCode}`,
        fields: [
          {
            key: 'userId',
            label: 'Tài khoản',
            options: accounts.data.map((a) => ({
              value: a.id,
              label: `${a.fullName} · ${a.email}`,
            })),
          },
          { key: 'reason', label: 'Lý do liên kết' },
        ],
        submit: async (values) => {
          await hrmFetch(`/employees/${emp.employeeId}/link-account`, {
            method: 'POST',
            body: JSON.stringify(values),
          });
          await fetchEmployeesFromDb();
        },
      });
    } catch (error) {
      setEmployeeError(
        error instanceof Error ? error.message : 'Không tải được tài khoản',
      );
    }
  };


  // Xuất Excel phía trình duyệt: danh sách đang lọc, chỉ các cột không nhạy cảm đang hiển thị
  const handleExportCsv = () => {
    try {
      // Có tick chọn thì xuất đúng những người đã chọn (còn trong danh sách đang lọc); không thì xuất cả danh sách đang lọc.
      const rows =
        selectedIds.size > 0
          ? filteredEmployees.filter((e) => selectedIds.has(e.employeeId))
          : filteredEmployees;
      downloadEmployeesXlsx(
        rows,
        employmentLabels,
        `danh-sach-nhan-vien-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      toast.success(`Đã xuất ${rows.length} nhân viên`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Không xuất được tệp Excel',
      );
    }
  };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {accountAction && (
        <HrmActionDialog
          action={accountAction}
          onClose={() => setAccountAction(null)}
        />
      )}
      <BulkInitializeEmployeesDialog
        open={bulkInitializeOpen}
        onClose={() => setBulkInitializeOpen(false)}
        onDone={async () => {
          await fetchEmployeesFromDb();
          await fetchPendingCoreCount();
        }}
      />
      {employeeError && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-red-700"
        >
          {employeeError}
        </p>
      )}
      {/* 1. Tiêu đề và thao tác */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Nhân sự</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Quản lý danh sách nhân viên, xem và cập nhật hồ sơ theo phân quyền. Ngạch bậc và hồ sơ lương được quản lý ở trang Lương.
          </p>
          <p
            data-testid="core-owned-note"
            className="mt-0.5 text-[12px] text-slate-400"
          >
            Họ tên, email, đơn vị và chức danh được quản lý tại Core (
            <a href="/users" className="text-blue-600 hover:underline">
              Người dùng
            </a>
            ,{' '}
            <a href="/organization" className="text-blue-600 hover:underline">
              Sơ đồ tổ chức
            </a>
            ).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={isLoading}
            aria-label="Tải lại"
            title="Tải lại danh sách nhân viên"
            className="size-9 border-slate-200 p-0 text-slate-600"
            onClick={async () => {
              await fetchEmployeesFromDb();
              toast.success({
                title: 'Đã tải lại',
                description: 'Danh sách nhân viên đã được cập nhật.',
              });
            }}
          >
            <RefreshCw className={`size-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>

              <Button
                size="sm"
                variant="outline"
                disabled={filteredEmployees.length === 0}
                title={
                  selectedIds.size > 0
                    ? `Xuất ${selectedIds.size} nhân viên đã chọn`
                    : 'Xuất danh sách đang lọc'
                }
                className="h-9 gap-1.5 border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                onClick={handleExportCsv}
              >
                <Download className="size-3.5" />
                <span>Xuất Excel{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}</span>
              </Button>

              <Button
                permission="hrm.employee.manage"
                size="sm"
                variant="outline"
                disabled={refreshingCore}
                title="Đồng bộ họ tên và email của nhân sự có tài khoản theo Core"
                className="h-9 gap-1.5 border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                onClick={handleRefreshFromCore}
              >
                <RefreshCw className={`size-3.5 ${refreshingCore ? 'animate-spin' : ''}`} />
                <span>{refreshingCore ? 'Đang cập nhật...' : 'Cập nhật từ Core'}</span>
              </Button>

              {pendingCoreCount >= 1 && (
                <Button
                  permission="hrm.employee.manage"
                  size="sm"
                  className="h-9 gap-1.5 text-xs font-semibold"
                  onClick={() => setBulkInitializeOpen(true)}
                >
                  <ListChecks className="size-3.5" />
                  <span>Nạp nhân sự từ Core</span>
                  <span
                    title="Số người ở Core chưa có hồ sơ HRM"
                    className="ml-1 rounded-full bg-slate-900/10 px-1.5 py-0.5 text-[12px] font-bold"
                  >
                    {pendingCoreCount} chờ
                  </span>
                </Button>
              )}
        </div>
      </div>

      {/* SUB-TAB 1: QUẢN LÝ NHÂN SỰ */}
      <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <EmployeeStatCards
              stats={stats}
              active={cardFilter}
              onSelect={(next) => {
                // Thẻ và bộ lọc không kết hợp: bấm thẻ thì xóa mọi bộ lọc khác; bấm lại thẻ đang chọn thì bỏ lọc. Không cuộn trang.
                setCardFilter((current) => (current === next ? 'ALL' : next));
                setSearchTerm('');
                setStatusFilter('ALL');
                setDepartmentFilter('ALL');
                setPositionFilter('ALL');
              }}
            />
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  aria-label="Tìm nhân viên"
                  placeholder="Tìm theo tên, mã NV, phòng ban, chức danh..."
                  className="h-9 border-slate-200 pl-9 text-xs"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCardFilter('ALL');
                  }}
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <SearchableSelect
                  height={36}
                  options={[{ value: 'ALL', label: 'Phòng ban: Tất cả' }, ...departmentOptions]}
                  value={departmentFilter}
                  onChange={(val) => {
                    setDepartmentFilter(val || 'ALL');
                    setCardFilter('ALL');
                  }}
                  placeholder="Phòng ban"
                  clearable={false}
                />
                <SearchableSelect
                  height={36}
                  options={[{ value: 'ALL', label: 'Chức danh: Tất cả' }, ...positionFilterOptions]}
                  value={positionFilter}
                  onChange={(val) => {
                    setPositionFilter(val || 'ALL');
                    setCardFilter('ALL');
                  }}
                  placeholder="Chức danh"
                  clearable={false}
                />
                <SearchableSelect
                  height={36}
                  options={[
                    { value: 'ALL', label: 'Trạng thái: Tất cả' },
                    { value: 'OFFICIAL', label: 'Chính thức' },
                    { value: 'PROBATION', label: 'Thử việc' },
                    { value: 'ON_LEAVE', label: 'Tạm nghỉ' },
                    { value: 'RESIGNED', label: 'Đã nghỉ việc' },
                    { value: 'TERMINATED', label: 'Chấm dứt hợp đồng' },
                  ]}
                  value={statusFilter}
                  onChange={(val) => {
                    setStatusFilter((val || 'ALL') as typeof statusFilter);
                    setCardFilter('ALL');
                  }}
                  clearable={false}
                />
              </div>
            </div>
          </div>

          {/* Bảng nhân sự */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[12px] font-bold text-slate-600">
                  <tr>
                    <th className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Chọn tất cả nhân viên trong trang"
                        checked={pageRows.length > 0 && pageRows.every((e) => selectedIds.has(e.employeeId))}
                        onChange={(e) => togglePage(e.target.checked)}
                        className="size-3.5 rounded border-slate-300"
                      />
                    </th>
                    <th className="px-3 py-2.5">Mã NV</th>
                    <th className="px-3 py-2.5">Họ và tên</th>
                    <th className="px-3 py-2.5">Đơn vị / Phòng ban</th>
                    <th className="px-3 py-2.5">Chức danh</th>
                    <th className="px-3 py-2.5">Ngày vào làm</th>
                    <th className="px-3 py-2.5">Trạng thái</th>
                    <th className="px-3 py-2.5">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {isLoading ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-400">
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="size-4 animate-spin text-[#021E73]" />
                          <span>Đang tải hồ sơ nhân sự từ Database...</span>
                        </div>
                      </td>
                    </tr>
                  ) : employeesList.length === 0 &&
                    canManageEmployees &&
                    pendingCoreCount >= 1 ? (
                    <tr>
                      <td colSpan={8} className="p-10 text-center">
                        <div role="status" className="flex flex-col items-center gap-3">
                          <p className="text-sm font-semibold text-slate-700">
                            Chưa có hồ sơ HRM. {pendingCoreCount} người đã khai
                            báo ở Core đang chờ nạp.
                          </p>
                          <Button
                            size="sm"
                            className="h-9 gap-1.5 text-xs font-semibold"
                            onClick={() => setBulkInitializeOpen(true)}
                          >
                            <ListChecks className="size-3.5" />
                            <span>Nạp nhân sự từ Core</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ) : filteredEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-400">
                        Không có hồ sơ nhân viên phù hợp với bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((emp) => {
                      const inactive = !isActiveEmployee(emp);
                      return (
                        <tr
                          key={emp.employeeId}
                          data-testid={`employee-row-${emp.employeeId}`}
                          className="transition-colors hover:bg-slate-50/80"
                        >
                          <td className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              aria-label={`Chọn ${emp.fullName || emp.employeeCode}`}
                              checked={selectedIds.has(emp.employeeId)}
                              onChange={() => toggleOne(emp.employeeId)}
                              className="size-3.5 rounded border-slate-300"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedEmployee(emp);
                                setIsEmployeeDrawerOpen(true);
                              }}
                              className="font-mono font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer text-left transition-colors"
                              title="Bấm để xem chi tiết hồ sơ nhân sự"
                            >
                              {emp.employeeCode}
                            </button>
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedEmployee(emp);
                                setIsEmployeeDrawerOpen(true);
                              }}
                              className="group flex items-center gap-2.5 text-left cursor-pointer transition-colors"
                              title="Bấm để xem chi tiết hồ sơ nhân sự"
                            >
                              <EmployeeAvatar initials={employeeInitials(emp)} seed={emp.employeeCode} />
                              <span className="min-w-0">
                                <span className="block truncate font-bold text-slate-900 group-hover:text-blue-600 group-hover:underline transition-colors">
                                  {emp.fullName || 'Chưa cập nhật tên'}
                                </span>
                                <span className="block truncate font-mono text-[12px] font-normal text-slate-500">
                                  {emp.email || emp.personalEmail || '----'}
                                </span>
                              </span>
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">{emp.department || 'Chưa phân phòng ban'}</td>
                          <td className="px-3 py-2.5 text-slate-700">{emp.position || 'Chưa phân chức danh'}</td>
                          <td className="px-3 py-2.5 font-mono text-slate-600">
                            {emp.joinDate ? formatVnDate(String(emp.joinDate)) : '----'}
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge
                              className={`border text-[12px] font-semibold ${
                                inactive
                                  ? 'border-rose-200 bg-rose-50 text-rose-600'
                                  : emp.employmentStatus === 'OFFICIAL'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : 'border-amber-200 bg-amber-50 text-amber-700'
                              }`}
                            >
                              {inactive
                                ? employmentLabels[emp.employmentStatus] || emp.employmentStatus
                                : emp.employmentStatus === 'OFFICIAL'
                                  ? 'Đang làm việc'
                                  : employmentLabels[emp.employmentStatus] || emp.employmentStatus}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 border-blue-200 px-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                              onClick={() => {
                                setSelectedEmployee(emp);
                                setIsEmployeeDrawerOpen(true);
                              }}
                            >
                              Xem chi tiết
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <EmployeePagination
              page={safePage}
              pageCount={pageCount}
              from={filteredEmployees.length === 0 ? 0 : (safePage - 1) * EMPLOYEE_PAGE_SIZE + 1}
              to={Math.min(safePage * EMPLOYEE_PAGE_SIZE, filteredEmployees.length)}
              total={filteredEmployees.length}
              onPage={setPage}
            />
          </div>
        </div>

      {/* HỒ SƠ NHÂN SỰ: ngăn kéo (drawer) trượt phải, chỉnh sửa trực tiếp trên Drawer */}
      <EmployeeDetailDialog
        employee={selectedEmployee}
        open={isEmployeeDrawerOpen}
        onOpenChange={setIsEmployeeDrawerOpen}
        canSensitive={canSensitive}
        onEmployeeUpdated={(updated) => {
          setSelectedEmployee(updated);
          setEmployeesList((list) =>
            list.map((e) =>
              e.employeeId === updated.employeeId ? { ...e, ...updated } : e,
            ),
          );
          void fetchEmployeesFromDb();
        }}
        onDependentsChanged={(dependents) =>
          selectedEmployee && setSelectedEmployee({ ...selectedEmployee, dependents })
        }
        onContractsChanged={(contracts) =>
          selectedEmployee && setSelectedEmployee({ ...selectedEmployee, contracts })
        }
        actions={
          selectedEmployee ? (
            <>
              <Button
                permission="hrm.appointment.manage"
                size="sm"
                variant="outline"
                className="h-8 text-xs font-semibold"
                onClick={() => setDecisionEmployeeId(selectedEmployee.employeeId)}
              >
                Tạo quyết định
              </Button>
              <EmployeeLifecycleActions
                employee={selectedEmployee}
                onChanged={fetchEmployeesFromDb}
                showEdit={false}
              />
              {!selectedEmployee.userId && isActiveEmployee(selectedEmployee) && (
                <Button
                  permission="hrm.employee.link-account"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => void openLinkAccount(selectedEmployee)}
                >
                  Liên kết tài khoản
                </Button>
              )}
            </>
          ) : null
        }
      />

      <PersonnelDecisionDialog
        open={Boolean(decisionEmployeeId)}
        onOpenChange={(o) => { if (!o) setDecisionEmployeeId(null); }}
        initialEmployeeId={decisionEmployeeId ?? undefined}
        onSaved={() => { void fetchEmployeesFromDb(); }}
      />

    </div>
  );
}
