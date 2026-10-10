'use client';

import {
  AlertTriangle,
  Briefcase,
  Check,
  CreditCard,
  Download,
  FileText,
  HeartHandshake,
  Layers,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import type {
  HrmCorePerson,
  HrmEmployeeProfile,
  HrmSalaryGrade,
  HrmJobDescriptionItem,
  HrmResponsibilityItem,
  HrmRequirementItem,
} from '@enterprise-platform/contracts-hrm';
import { useCallback, useEffect, useState, useMemo } from 'react';
import { EmployeeLifecycleActions, PositionLifecycleActions, employmentLabels } from '../ui/hrm-lifecycle-actions';
import { HrmFamilyPanel } from '../ui/hrm-family-panel';
import { HrmProfileDocumentsPanel } from '../ui/hrm-profile-documents-panel';
import { HrmContractPanel } from '../ui/hrm-contract-panel';
import { BulkInitializeEmployeesDialog } from '../ui/bulk-initialize-employees-dialog';
import { PersonnelDecisionDialog } from '../ui/personnel-decision-dialog';
import { CurrentManagerLine, EmployeeReportingDrawer } from '../ui/employee-reporting-drawer';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { hrmFetch } from '../hrm-api';
import {
  SENSITIVE_HINT,
  buildEmployeesCsv,
  downloadCsv,
  employeeCompleteness,
  normalizeSearchText,
  sensitiveDisplay,
} from '../hrm-employee-view';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../ui/sheet';
import { toast } from '../ui/toast';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';

type SubTabKey = 'employees' | 'job_titles';

/** Hiển thị trường nhạy cảm: "Ẩn" (kèm gợi ý) khi API trả null cho người thiếu quyền. */
function SensitiveValue({
  value,
  canSee,
  emptyLabel,
}: {
  value: string | null | undefined;
  canSee: boolean;
  emptyLabel?: string;
}) {
  const view = sensitiveDisplay(value, canSee, emptyLabel);
  return (
    <span
      title={view.hidden ? (view.title ?? SENSITIVE_HINT) : undefined}
      className={view.hidden ? 'italic text-slate-400' : undefined}
    >
      {view.text}
    </span>
  );
}

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
  const [activeTab, setActiveTab] = useState<SubTabKey>('employees');

  // Master States từ Database
  const [employeesList, setEmployeesList] = useState<HrmEmployeeProfile[]>([]);
  const [selectedEmployee, setSelectedEmployee] =
    useState<HrmEmployeeProfile | null>(null);
  const [isEmployeeDrawerOpen, setIsEmployeeDrawerOpen] = useState(false);
  const [decisionEmployeeId, setDecisionEmployeeId] = useState<string | null>(null);
  const [reportingOpen, setReportingOpen] = useState(false);

  // Chức danh & JD (PLAN § 7 - § 25)
  const [positionsList, setPositionsList] = useState<HrmJobDescriptionItem[]>(
    [],
  );
  const [selectedPosition, setSelectedPosition] =
    useState<HrmJobDescriptionItem | null>(null);
  const [isJdDrawerOpen, setIsJdDrawerOpen] = useState(false);

  // Form Fields trong JD Drawer
  const [jdSalaryGradeId, setJdSalaryGradeId] = useState<string>('');
  const [jdJobPurpose, setJdJobPurpose] = useState<string>('');
  const [jdResponsibilities, setJdResponsibilities] = useState<
    HrmResponsibilityItem[]
  >([]);
  const [jdRequirements, setJdRequirements] = useState<HrmRequirementItem[]>(
    [],
  );
  const [jdAuthorities, setJdAuthorities] = useState<string[]>([]);
  const [newRespTitle, setNewRespTitle] = useState('');
  const [newRespWeight, setNewRespWeight] = useState('');
  const [newReqTitle, setNewReqTitle] = useState('');
  const [newReqType, setNewReqType] =
    useState<HrmRequirementItem['type']>('SKILL');
  const [newAuthTitle, setNewAuthTitle] = useState('');

  // Search & Filter (Tab 2: Job Titles)
  const [jdSearchTerm, setJdSearchTerm] = useState('');
  const [jdUnitFilter, setJdUnitFilter] = useState('ALL');
  const [jdStatusFilter, setJdStatusFilter] = useState<
    'ALL' | 'CONFIGURED' | 'NOT_CONFIGURED'
  >('ALL');
  const [jdGradeFilter, setJdGradeFilter] = useState('ALL');

  // Danh mục ngạch lương (chỉ để gắn ngạch cho chức danh; quản trị ngạch bậc ở trang Lương)
  const [salaryGrades, setSalaryGrades] = useState<HrmSalaryGrade[]>([]);

  // Số người ở Core chưa có hồ sơ HRM (chỉ tải khi có quyền manage; lỗi thì bỏ qua)
  const [pendingCoreCount, setPendingCoreCount] = useState(0);

  // Search & Filter (Tab 1: Employees)
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Loading States
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

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

  // 2. Tải danh mục Chức danh & JD từ Database API (PLAN § 19)
  const fetchPositionsFromDb = useCallback(async () => {
    try {
      const payload = await hrmFetch<{ data: HrmJobDescriptionItem[] }>('/positions');
      setPositionsList(payload.data || []);
    } catch (err) {
      console.error('Không thể tải danh sách chức danh & JD:', err);
    }
  }, []);

  // 3. Tải danh mục ngạch lương (cần hrm.salary.read) để gắn ngạch cho chức danh
  const canReadSalary = can('hrm.salary.read');
  const fetchSalaryGradesFromDb = useCallback(async () => {
    if (!canReadSalary) {
      setSalaryGrades([]);
      return;
    }
    try {
      const payload = await hrmFetch<{ data: HrmSalaryGrade[] }>('/salary-grades');
      setSalaryGrades(payload.data || []);
    } catch (err) {
      console.error('Không thể tải ngạch lương:', err);
    }
  }, [canReadSalary]);

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
    void fetchPositionsFromDb();
    void fetchSalaryGradesFromDb();
    void fetchPendingCoreCount();
  }, [
    fetchEmployeesFromDb,
    fetchPositionsFromDb,
    fetchSalaryGradesFromDb,
    fetchPendingCoreCount,
  ]);

  // Người xem không có hrm.employee.sensitive không thấy CCCD/MST/ngân hàng: chỉ tính trên trường nhìn thấy
  const canSensitive = can('hrm.employee.sensitive');
  const computeCompleteness = (emp: HrmEmployeeProfile): number =>
    employeeCompleteness(emp, canSensitive);

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
      return matchesSearch && matchesStatus;
    });
  }, [employeesList, searchTerm, statusFilter]);

  // Xuất CSV phía trình duyệt: danh sách đang lọc, chỉ các cột không nhạy cảm đang hiển thị
  const handleExportCsv = () => {
    try {
      const csv = buildEmployeesCsv(filteredEmployees, employmentLabels);
      downloadCsv(
        `danh-sach-nhan-vien-${new Date().toISOString().slice(0, 10)}.csv`,
        csv,
      );
      toast.success(`Đã xuất ${filteredEmployees.length} nhân viên`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Không xuất được tệp CSV',
      );
    }
  };

  // Nhân sự thử việc (HR Alert)
  const probationCount = useMemo(() => {
    return employeesList.filter((e) => e.employmentStatus === 'PROBATION')
      .length;
  }, [employeesList]);

  // Lọc danh sách Chức danh & JD (PLAN § 10)
  const filteredPositions = useMemo(() => {
    return positionsList.filter((pos) => {
      const term = jdSearchTerm.toLowerCase();
      const matchesSearch =
        !term ||
        pos.positionCode.toLowerCase().includes(term) ||
        pos.positionName.toLowerCase().includes(term);
      const matchesUnit =
        jdUnitFilter === 'ALL' || pos.unit?.id === jdUnitFilter;
      const matchesStatus =
        jdStatusFilter === 'ALL' || pos.jdStatus === jdStatusFilter;
      let matchesGrade = true;
      if (jdGradeFilter === 'ASSIGNED') {
        matchesGrade = Boolean(pos.salaryGrade);
      } else if (jdGradeFilter === 'UNASSIGNED') {
        matchesGrade = !pos.salaryGrade;
      } else if (jdGradeFilter !== 'ALL') {
        matchesGrade = pos.salaryGrade?.id === jdGradeFilter;
      }
      return matchesSearch && matchesUnit && matchesStatus && matchesGrade;
    });
  }, [
    positionsList,
    jdSearchTerm,
    jdUnitFilter,
    jdStatusFilter,
    jdGradeFilter,
  ]);

  // Danh sách phòng ban duy nhất để lọc (PLAN § 10)
  const unitOptions: SearchableSelectOption[] = useMemo(() => {
    const map = new Map<string, string>();
    positionsList.forEach((pos) => {
      if (pos.unit?.id && pos.unit?.name) {
        map.set(pos.unit.id, pos.unit.name);
      }
    });
    const opts: SearchableSelectOption[] = [
      { value: 'ALL', label: 'Tất cả đơn vị / phòng ban' },
    ];
    map.forEach((name, id) => {
      opts.push({ value: id, label: name });
    });
    return opts;
  }, [positionsList]);

  // Mở Drawer cấu hình JD (PLAN § 11 - § 17)
  const handleOpenJdDrawer = (pos: HrmJobDescriptionItem) => {
    setSelectedPosition(pos);
    setJdSalaryGradeId(pos.salaryGrade?.id || '');
    setJdJobPurpose(pos.jobPurpose || '');

    // Map responsibilities
    const resps: HrmResponsibilityItem[] = (pos.responsibilities || []).map(
      (r) => {
        if (typeof r === 'string') {
          return { title: r, weight: undefined, sortOrder: 0 };
        }
        return r;
      },
    );
    setJdResponsibilities(resps);

    // Map requirements
    const reqs: HrmRequirementItem[] = (pos.requirements || []).map((rq) => {
      if (typeof rq === 'string') {
        return { title: rq, type: 'SKILL', required: true };
      }
      return rq;
    });
    setJdRequirements(reqs);

    // Map authorities
    setJdAuthorities(pos.authorities ? [...pos.authorities] : []);

    setNewRespTitle('');
    setNewRespWeight('');
    setNewReqTitle('');
    setNewAuthTitle('');
    setIsJdDrawerOpen(true);
  };

  // Lưu JD (CREATE / UPDATE - PLAN § 18 & § 21)
  const handleSaveJd = async () => {
    if (!selectedPosition) return;
    try {
      setIsSaving(true);
      await hrmFetch(`/positions/${selectedPosition.positionId}/profile`, {
        method: selectedPosition.updatedAt ? 'PATCH' : 'POST',
        body: JSON.stringify({
          expectedUpdatedAt: selectedPosition.updatedAt,
          salaryGradeId: jdSalaryGradeId || null,
          defaultPolicyId: selectedPosition.defaultPolicyId || null,
          description: jdJobPurpose.trim() || null,
          responsibilities: jdResponsibilities,
          requirements: jdRequirements,
          authorities: jdAuthorities,
          active: selectedPosition.active,
        }),
      });
      toast.success({
        title: 'Lưu JD thành công',
        description: `Đã cập nhật bản mô tả công việc cho chức danh: ${selectedPosition.positionName}.`,
      });
      setIsJdDrawerOpen(false);
      await fetchPositionsFromDb();
    } catch (err) {
      toast.error({
        title: 'Không lưu được JD',
        description:
          err instanceof Error
            ? err.message
            : 'Tải lại bản ghi để kiểm tra phiên bản.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Ngạch có thể chọn; luôn giữ ngạch hiện tại của chức danh dù người xem không đọc được danh mục ngạch
  const gradeOptions: SearchableSelectOption[] = useMemo(() => {
    const options = salaryGrades.map((g) => ({
      value: g.id,
      label: `${g.name} (${g.code})`,
      badge: g.code,
    }));
    const current = selectedPosition?.salaryGrade;
    if (current && !options.some((o) => o.value === current.id))
      options.push({
        value: current.id,
        label: `${current.name} (${current.code})`,
        badge: current.code,
      });
    return options;
  }, [salaryGrades, selectedPosition]);

  // Đếm JD đã cấu hình
  const configuredJdCount = useMemo(() => {
    return positionsList.filter((p) => p.jdStatus === 'CONFIGURED').length;
  }, [positionsList]);

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
      {/* 1. Page Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight mb-1">
            Nhân viên
          </h1>
          <p className="text-xs text-slate-500">
            Hồ sơ nghiệp vụ HRM và tiêu chuẩn chức danh. Ngạch bậc và hồ sơ lương được quản lý ở trang Lương.
          </p>
          <p
            data-testid="core-owned-note"
            className="text-[11px] text-slate-400 mt-1"
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

        <div className="flex items-center flex-wrap gap-2.5">
          <Button
            size="sm"
            variant="outline"
            disabled={isLoading}
            className="text-xs h-9 border-slate-200 text-slate-700 hover:bg-slate-50 font-medium gap-1.5"
            onClick={async () => {
              await Promise.all([
                fetchEmployeesFromDb(),
                fetchPositionsFromDb(),
                fetchSalaryGradesFromDb(),
              ]);
              toast.success({
                title: 'Đã tải lại',
                description: 'Danh sách nhân viên và chức danh đã được cập nhật.',
              });
            }}
          >
            <RefreshCw
              className={`size-3.5 text-blue-700 ${isLoading ? 'animate-spin' : ''}`}
            />
            <span>{isLoading ? 'Đang tải...' : 'Tải lại'}</span>
          </Button>

          {activeTab === 'employees' && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={filteredEmployees.length === 0}
                className="text-xs h-9 border-slate-200 text-slate-700 hover:bg-slate-50 font-medium gap-1.5"
                onClick={handleExportCsv}
              >
                <Download className="size-3.5 text-emerald-600" />
                <span>Xuất Excel</span>
              </Button>

              <Button
                permission="hrm.employee.manage"
                size="sm"
                variant="outline"
                disabled={refreshingCore}
                title="Đồng bộ họ tên và email của nhân sự có tài khoản theo Core"
                className="text-xs h-9 border-slate-200 text-slate-700 hover:bg-slate-50 font-medium gap-1.5"
                onClick={handleRefreshFromCore}
              >
                <RefreshCw
                  className={`size-3.5 text-blue-700 ${refreshingCore ? 'animate-spin' : ''}`}
                />
                <span>{refreshingCore ? 'Đang cập nhật...' : 'Cập nhật từ Core'}</span>
              </Button>

              {pendingCoreCount >= 1 && (
                <Button
                  permission="hrm.employee.manage"
                  size="sm"
                  className="text-xs h-9 bg-[#021E73] hover:bg-blue-900 text-white font-semibold gap-1.5 shadow-xs"
                  onClick={() => setBulkInitializeOpen(true)}
                >
                  <ListChecks className="size-3.5" />
                  <span>Nạp nhân sự từ Core</span>
                  <span
                    title="Số người ở Core chưa có hồ sơ HRM"
                    className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800"
                  >
                    {pendingCoreCount} chờ
                  </span>
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 2. Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Tổng nhân sự
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-900 font-mono">
                {employeesList.length}
              </span>
              <span className="text-xs text-blue-700 font-semibold">
                Nhân viên
              </span>
            </div>
          </div>
          <div className="size-11 rounded-xl bg-blue-50 text-[#021E73] flex items-center justify-center border border-blue-100">
            <Users className="size-5" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Cảnh báo thử việc
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-amber-700 font-mono">
                {probationCount}
              </span>
              <span className="text-xs text-slate-500 font-medium">
                Thử việc
              </span>
            </div>
            <span className="text-[11px] text-amber-700 font-medium block">
              {probationCount > 0
                ? 'Cần đánh giá hợp đồng'
                : 'Không có cảnh báo'}
            </span>
          </div>
          <div className="size-11 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-100">
            <AlertTriangle className="size-5" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Chức danh và JD
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-[#021E73] font-mono">
                {positionsList.length}
              </span>
              <span className="text-xs text-slate-500 font-medium">Vị trí</span>
            </div>
            <span className="text-[11px] text-emerald-700 font-medium block">
              {configuredJdCount} vị trí đã có JD (
              {Math.round(
                (configuredJdCount / (positionsList.length || 1)) * 100,
              )}
              %)
            </span>
          </div>
          <div className="size-11 rounded-xl bg-blue-50 text-[#021E73] flex items-center justify-center border border-blue-100">
            <Briefcase className="size-5" />
          </div>
        </div>
      </div>

      {/* 3. Tab: Nhân viên | Chức danh */}
      <div className="border-b border-slate-200">
        <div
          role="tablist"
          aria-label="Nhân viên và chức danh"
          className="flex space-x-8 text-xs font-medium"
        >
          {(
            [
              ['employees', 'Nhân viên', Users, employeesList.length],
              ['job_titles', 'Chức danh', Briefcase, positionsList.length],
            ] as const
          ).map(([id, label, Icon, count]) => (
            <button
              key={id}
              id={`employees-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
              className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
                activeTab === id
                  ? 'border-blue-600 text-blue-600 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <Icon className="size-4" />
              <span>{label}</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                {count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* SUB-TAB 1: QUẢN LÝ NHÂN SỰ */}
      {activeTab === 'employees' && (
        <div className="space-y-4">
          {/* Zone 1: Filter Bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="relative flex-1">
                <Search className="size-4 text-slate-400 absolute left-3 top-2.5" />
                <Input
                  placeholder="Tìm theo Họ tên, Mã nhân viên, Chức danh, Email..."
                  className="pl-9 h-9 text-xs border-slate-200"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="w-48">
                <SearchableSelect
                  options={[
                    { value: 'ALL', label: 'Tất cả trạng thái' },
                    { value: 'OFFICIAL', label: 'Chính thức' },
                    { value: 'PROBATION', label: 'Thử việc' },
                    { value: 'ON_LEAVE', label: 'Tạm nghỉ' },
                    { value: 'RESIGNED', label: 'Đã nghỉ việc' },
                    { value: 'TERMINATED', label: 'Chấm dứt hợp đồng' },
                  ]}
                  value={statusFilter}
                  onChange={(val) => setStatusFilter((val || 'ALL') as typeof statusFilter)}
                  clearable={false}
                />
              </div>
            </div>
          </div>

          {/* Zone 2: Table Data */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="py-3.5 px-4">Mã NV</th>
                    <th className="py-3.5 px-4">Họ và tên</th>
                    <th className="py-3.5 px-4">Phòng ban / Chức danh</th>
                    <th className="py-3.5 px-4">Ngày vào</th>
                    <th className="py-3.5 px-4 text-center">
                      Hoàn thiện hồ sơ
                    </th>
                    <th className="py-3.5 px-4 text-center">Trạng thái</th>
                    <th className="py-3.5 px-4 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {isLoading ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="p-8 text-center text-slate-400"
                      >
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
                      <td colSpan={7} className="p-10 text-center">
                        <div
                          role="status"
                          className="flex flex-col items-center gap-3"
                        >
                          <p className="text-sm font-semibold text-slate-700">
                            Chưa có hồ sơ HRM. {pendingCoreCount} người đã khai
                            báo ở Core đang chờ nạp.
                          </p>
                          <Button
                            size="sm"
                            className="text-xs h-9 bg-[#021E73] hover:bg-blue-900 text-white font-semibold gap-1.5 shadow-xs"
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
                      <td
                        colSpan={7}
                        className="p-8 text-center text-slate-400"
                      >
                        Không có hồ sơ nhân viên phù hợp với bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    filteredEmployees.map((emp) => {
                      const completeness = computeCompleteness(emp);
                      return (
                        <tr
                          key={emp.employeeId}
                          className="hover:bg-slate-50/80 transition-colors"
                        >
                          <td className="py-3.5 px-4 font-mono font-bold text-blue-700">
                            {emp.employeeCode}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="font-bold text-slate-900 block text-xs">
                              {emp.fullName || 'Chưa cập nhật tên'}
                            </span>
                            <span className="text-[11px] text-slate-500 font-mono">
                              {emp.email || emp.personalEmail || '----'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="font-semibold text-slate-800 block">
                              {emp.position || 'Chưa phân chức danh'}
                            </span>
                            <span className="text-[11px] text-slate-500 block">
                              {emp.department || 'Chưa phân phòng ban'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-mono text-slate-600">
                            <span>
                              {emp.joinDate
                                ? String(emp.joinDate).slice(0, 10)
                                : '----'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <div className="inline-flex items-center gap-1.5">
                              <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                                <div
                                  className={`h-full ${completeness === 100
                                      ? 'bg-emerald-500'
                                      : completeness >= 70
                                        ? 'bg-blue-500'
                                        : 'bg-amber-500'
                                    }`}
                                  style={{ width: `${completeness}%` }}
                                />
                              </div>
                              <span className="font-mono text-[10px] font-bold text-slate-600">
                                {completeness}%
                              </span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            {emp.employmentStatus === 'OFFICIAL' ? (
                              <Badge className="bg-emerald-100 text-emerald-800 text-[10px] font-bold border border-emerald-200">
                                CHÍNH THỨC
                              </Badge>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-200">
                                {employmentLabels[emp.employmentStatus] || emp.employmentStatus}
                              </Badge>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-blue-700 hover:bg-blue-50 font-semibold border-slate-200"
                              onClick={() => {
                                setSelectedEmployee(emp);
                                setIsEmployeeDrawerOpen(true);
                              }}
                            >
                              Xem hồ sơ
                            </Button>
                            <Button
                              permission="hrm.appointment.manage"
                              size="sm"
                              variant="outline"
                              className="ml-2 h-7 text-xs font-semibold"
                              onClick={() => setDecisionEmployeeId(emp.employeeId)}
                            >
                              Tạo quyết định
                            </Button>
                            <EmployeeLifecycleActions employee={emp} onChanged={fetchEmployeesFromDb} />
                            {!emp.userId && !['RESIGNED', 'TERMINATED'].includes(emp.employmentStatus) && (
                              <Button
                                permission="hrm.employee.link-account"
                                size="sm"
                                variant="outline"
                                className="ml-2 h-7 text-xs"
                                onClick={async () => {
                                  try {
                                    const accounts = await hrmFetch<{
                                      data: {
                                        id: string;
                                        fullName: string;
                                        email: string;
                                      }[];
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
                                        {
                                          key: 'reason',
                                          label: 'Lý do liên kết',
                                        },
                                      ],
                                      submit: async (values) => {
                                        await hrmFetch(
                                          `/employees/${emp.employeeId}/link-account`,
                                          {
                                            method: 'POST',
                                            body: JSON.stringify(values),
                                          },
                                        );
                                        await fetchEmployeesFromDb();
                                      },
                                    });
                                  } catch (error) {
                                    setEmployeeError(
                                      error instanceof Error
                                        ? error.message
                                        : 'Không tải được tài khoản',
                                    );
                                  }
                                }}
                              >
                                Liên kết tài khoản
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Zone 3: Footer */}
            <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <span>
                Hiển thị <strong>{filteredEmployees.length}</strong> /{' '}
                {employeesList.length} nhân sự
              </span>
              <span className="text-[11px] text-slate-400">
                Kết nối cơ sở dữ liệu hrm_schema
              </span>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: CHỨC DANH & QUẢN LÝ TIÊU CHUẨN JD (PLAN § 7 - § 10) */}
      {activeTab === 'job_titles' && (
        <div className="space-y-4">
          {/* Zone 1: Filter Bar theo PLAN § 10 */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <div className="relative flex-1">
                <Search className="size-4 text-slate-400 absolute left-3 top-2.5" />
                <Input
                  placeholder="Tìm theo Mã chức danh, Tên chức danh..."
                  className="pl-9 h-9 text-xs border-slate-200"
                  value={jdSearchTerm}
                  onChange={(e) => setJdSearchTerm(e.target.value)}
                />
              </div>

              {/* Filter Phòng ban */}
              <div className="w-full md:w-56">
                <SearchableSelect
                  options={unitOptions}
                  value={jdUnitFilter}
                  onChange={(val) => setJdUnitFilter(val || 'ALL')}
                  placeholder="Chọn đơn vị..."
                  clearable={false}
                />
              </div>

              {/* Filter Tình trạng JD */}
              <div className="w-full md:w-44">
                <SearchableSelect
                  options={[
                    { value: 'ALL', label: 'Tất cả trạng thái JD' },
                    { value: 'CONFIGURED', label: 'Đã có JD' },
                    { value: 'NOT_CONFIGURED', label: 'Chưa thiết lập JD' },
                  ]}
                  value={jdStatusFilter}
                  onChange={(val) => setJdStatusFilter((val || 'ALL') as typeof jdStatusFilter)}
                  clearable={false}
                />
              </div>

              {/* Filter Ngạch lương */}
              <div className="w-full md:w-44">
                <SearchableSelect
                  options={[
                    { value: 'ALL', label: 'Tất cả ngạch lương' },
                    { value: 'ASSIGNED', label: 'Đã gán ngạch' },
                    { value: 'UNASSIGNED', label: 'Chưa gán ngạch' },
                  ]}
                  value={jdGradeFilter}
                  onChange={(val) => setJdGradeFilter(val || 'ALL')}
                  clearable={false}
                />
              </div>
            </div>
          </div>

          {/* Zone 2: Position & JD Master Table (PLAN § 8 & § 9) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  Danh mục Vị trí Chức danh & Tiêu chuẩn Mô tả công việc (Job
                  Descriptions)
                </h3>
                <p className="text-xs text-slate-500">
                  Kế thừa định danh từ Core Organization, quản lý tiêu chuẩn JD
                  và ngạch lương mở rộng của HRM.
                </p>
              </div>
              <Badge className="bg-blue-50 text-blue-800 border-blue-200 text-xs font-semibold">
                Hiển thị {filteredPositions.length} / {positionsList.length}{' '}
                chức danh
              </Badge>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="py-3.5 px-4">Mã chức danh</th>
                    <th className="py-3.5 px-4">Tên chức danh</th>
                    <th className="py-3.5 px-4">Đơn vị / Phòng ban</th>
                    <th className="py-3.5 px-4">Ngạch lương liên kết</th>
                    <th className="py-3.5 px-4 text-center">Tình trạng JD</th>
                    <th className="py-3.5 px-4 text-center">Nhân sự</th>
                    <th className="py-3.5 px-4 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredPositions.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="p-8 text-center text-slate-400"
                      >
                        Không tìm thấy vị trí chức danh nào phù hợp với bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    filteredPositions.map((pos) => {
                      const isConfigured = pos.jdStatus === 'CONFIGURED';
                      return (
                        <tr
                          key={pos.positionId}
                          className="hover:bg-slate-50/80 transition-colors"
                        >
                          <td className="py-3.5 px-4 font-mono font-bold text-blue-700">
                            {pos.positionCode}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="font-bold text-slate-900 block text-xs">
                              {pos.positionName}
                            </span>
                            {pos.jobPurpose && (
                              <span className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                                {pos.jobPurpose}
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-slate-700">
                            {pos.unit?.name || '----'}
                          </td>
                          <td className="py-3.5 px-4">
                            {pos.salaryGrade ? (
                              <Badge className="bg-blue-100 text-blue-800 text-[10px] font-bold border border-blue-200">
                                {pos.salaryGrade.code} - {pos.salaryGrade.name}
                              </Badge>
                            ) : (
                              <Badge className="bg-slate-100 text-slate-600 text-[10px] font-normal border border-slate-200">
                                Chưa gán ngạch
                              </Badge>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            {isConfigured ? (
                              <Badge className="bg-emerald-100 text-emerald-800 text-[10px] font-bold border border-emerald-200">
                                Đã có JD
                              </Badge>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-200">
                                Chưa thiết lập JD
                              </Badge>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono font-semibold text-slate-700">
                            {pos.activeEmployeeCount} nhân sự
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <Button
                              size="sm"
                              variant="outline"
                              className={`h-7 text-xs font-semibold ${isConfigured
                                  ? 'border-blue-200 text-blue-700 hover:bg-blue-50'
                                  : 'border-amber-200 text-amber-800 hover:bg-amber-50'
                                }`}
                              onClick={() => handleOpenJdDrawer(pos)}
                            >
                              {can('hrm.employee.manage') ? (isConfigured ? 'Chỉnh sửa JD' : 'Cấu hình JD') : 'Xem JD'}
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* DRAWER 1: XEM CHI TIẾT HỒ SƠ NHÂN VIÊN 5 KHỐI THEO PLAN */}
      <Sheet open={isEmployeeDrawerOpen} onOpenChange={setIsEmployeeDrawerOpen}>
        <SheetContent className="w-full sm:max-w-xl p-0 h-full max-h-screen overflow-hidden bg-white flex flex-col">
          <SheetHeader className="shrink-0 p-5 border-b border-slate-200 bg-slate-50/80">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-blue-700">
                {selectedEmployee?.employeeCode}
              </span>
              <Badge
                className={
                  selectedEmployee?.employmentStatus === 'OFFICIAL'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]'
                    : 'bg-amber-50 text-amber-700 border-amber-200 text-[10px]'
                }
              >
                {selectedEmployee?.employmentStatus}
              </Badge>
            </div>
            <SheetTitle className="text-base font-bold text-slate-900 mt-1">
              {selectedEmployee?.fullName || 'Hồ sơ nhân sự'}
            </SheetTitle>
            <SheetDescription className="text-xs text-slate-500">
              {selectedEmployee?.position || 'Chức danh'} •{' '}
              {selectedEmployee?.department || 'Phòng ban'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5 text-xs">
            {/* KHỐI 1: HỒ SƠ CÁ NHÂN */}
            <div className="space-y-2.5">
              <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] flex items-center gap-1.5 text-blue-900">
                <FileText className="size-3.5 text-blue-600" />
                1. Hồ sơ cá nhân
              </h4>
              <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 space-y-2">
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Số điện thoại:</span>
                  <span className="font-semibold text-slate-900">
                    {selectedEmployee?.phone || '----'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Email:</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {selectedEmployee?.email ||
                      selectedEmployee?.personalEmail ||
                      '----'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">
                    Ngày sinh & Giới tính:
                  </span>
                  <span className="font-semibold text-slate-900">
                    {formatVnDate(selectedEmployee?.dateOfBirth)} (
                    {selectedEmployee?.gender === 'FEMALE' ? 'Nữ' : 'Nam'})
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Số CCCD / Hộ chiếu:</span>
                  <span className="font-mono font-bold text-slate-900">
                    <SensitiveValue
                      value={selectedEmployee?.identityCardNumber}
                      canSee={canSensitive}
                    />
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Tình trạng hôn nhân:</span>
                  <span className="font-semibold text-slate-900">
                    {selectedEmployee?.maritalStatus === 'MARRIED' ? 'Đã kết hôn' : selectedEmployee?.maritalStatus === 'DIVORCED' ? 'Ly hôn' : 'Độc thân'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Quốc tịch & Dân tộc:</span>
                  <span className="font-semibold text-slate-900">
                    {selectedEmployee?.nationality || 'Việt Nam'} / {selectedEmployee?.ethnicity || 'Kinh'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Nơi sinh & Quê quán:</span>
                  <span className="font-semibold text-slate-900 text-right">
                    {selectedEmployee?.placeOfBirth || '----'} (Quê quán: {selectedEmployee?.hometown || '----'})
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">Địa chỉ thường trú:</span>
                  <span className="font-semibold text-slate-900 text-right">
                    {selectedEmployee?.permanentAddress ||
                      selectedEmployee?.currentAddress ||
                      '----'}
                  </span>
                </div>
              </div>
            </div>

            {/* KHỐI 2: LIÊN HỆ KHẨN CẤP */}
            <div className="space-y-2.5">
              <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] flex items-center gap-1.5 text-blue-900">
                <HeartHandshake className="size-3.5 text-blue-600" />
                2. Liên hệ khẩn cấp
              </h4>
              <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 space-y-2">
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Người liên hệ:</span>
                  <span className="font-semibold text-slate-900">
                    {selectedEmployee?.emergencyContactName ||
                      'Chưa thiết lập'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Mối quan hệ:</span>
                  <span className="font-semibold text-slate-900">
                    {selectedEmployee?.emergencyContactRelationship || '----'}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">
                    Số điện thoại liên hệ:
                  </span>
                  <span className="font-mono font-bold text-slate-900">
                    {selectedEmployee?.emergencyContactPhone || '----'}
                  </span>
                </div>
              </div>
            </div>

            {/* KHỐI 3: QUAN HỆ LAO ĐỘNG */}
            <div className="space-y-2.5">
              <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] flex items-center gap-1.5 text-blue-900">
                <Briefcase className="size-3.5 text-blue-600" />
                3. Quan hệ lao động
              </h4>
              <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 space-y-2">
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Ngày gia nhập:</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {selectedEmployee?.joinDate
                      ? String(selectedEmployee.joinDate).slice(0, 10)
                      : '----'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Ngày chính thức:</span>
                  <span className="font-mono font-semibold text-emerald-700">
                    {selectedEmployee?.officialDate
                      ? String(selectedEmployee.officialDate).slice(0, 10)
                      : 'Đang thử việc'}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">Trạng thái hiện tại:</span>
                  <Badge className="bg-blue-100 text-blue-800 text-[10px]">
                    {selectedEmployee?.employmentStatus}
                  </Badge>
                </div>
              </div>
            </div>

            {/* KHỐI 4: TÀI KHOẢN CHI LƯƠNG & THUẾ */}
            <div className="space-y-2.5">
              <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] flex items-center gap-1.5 text-blue-900">
                <CreditCard className="size-3.5 text-blue-600" />
                4. Tài chính nhân sự & Thuế
              </h4>
              <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 space-y-2">
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Mã số thuế TNCN:</span>
                  <span className="font-mono font-bold text-slate-900">
                    <SensitiveValue
                      value={selectedEmployee?.taxCode}
                      canSee={canSensitive}
                    />
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Số sổ BHXH:</span>
                  <span className="font-mono font-bold text-slate-900">
                    <SensitiveValue
                      value={selectedEmployee?.socialInsuranceNumber}
                      canSee={canSensitive}
                    />
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">
                    Số tài khoản nhận lương:
                  </span>
                  <span className="font-mono font-bold text-blue-700">
                    <SensitiveValue
                      value={selectedEmployee?.bankAccountNumber}
                      canSee={canSensitive}
                      emptyLabel="Chưa liên kết"
                    />
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Ngân hàng thụ hưởng:</span>
                  <span className="font-semibold text-slate-900">
                    <SensitiveValue
                      value={
                        selectedEmployee?.bankName
                          ? `${selectedEmployee.bankName} ${selectedEmployee.bankBranch || ''}`.trim()
                          : null
                      }
                      canSee={canSensitive}
                      emptyLabel="----"
                    />
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-slate-200/60">
                  <span className="text-slate-500">Quản lý trực tiếp:</span>
                  <span className="flex items-center gap-2">
                    <CurrentManagerLine employeeId={isEmployeeDrawerOpen ? selectedEmployee?.employeeId : null} />
                    <Button size="xs" variant="outline" onClick={() => setReportingOpen(true)}>
                      Lịch sử báo cáo
                    </Button>
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">Người thân đã khai báo:</span>
                  <span className="font-semibold text-blue-700">
                    {selectedEmployee?.dependents?.length || 0} người (HR xác minh giảm trừ riêng)
                  </span>
                </div>
              </div>
            </div>

            {selectedEmployee && <>
              <HrmProfileDocumentsPanel employeeId={selectedEmployee.employeeId} mode="hr" />
              <HrmFamilyPanel employeeId={selectedEmployee.employeeId} rows={selectedEmployee.dependents || []} onChanged={dependents => setSelectedEmployee({ ...selectedEmployee, dependents })} />
              <HrmContractPanel employeeId={selectedEmployee.employeeId} rows={selectedEmployee.contracts || []} onChanged={contracts => setSelectedEmployee({ ...selectedEmployee, contracts })} />
            </>}
          </div>

          <div className="shrink-0 p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-8"
              onClick={() => setIsEmployeeDrawerOpen(false)}
            >
              Đóng hồ sơ
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <EmployeeReportingDrawer
        employeeId={selectedEmployee?.employeeId}
        employeeName={selectedEmployee?.fullName}
        open={reportingOpen}
        onOpenChange={setReportingOpen}
      />
      <PersonnelDecisionDialog
        open={Boolean(decisionEmployeeId)}
        onOpenChange={(o) => { if (!o) setDecisionEmployeeId(null); }}
        initialEmployeeId={decisionEmployeeId ?? undefined}
        onSaved={() => { void fetchEmployeesFromDb(); }}
      />

      {/* DRAWER 2: CẤU HÌNH & QUẢN LÝ TIÊU CHUẨN JD (PLAN § 11 - § 17) */}
      <Sheet open={isJdDrawerOpen} onOpenChange={setIsJdDrawerOpen}>
        <SheetContent className="w-full sm:max-w-[760px] p-0 h-full max-h-screen overflow-hidden bg-white flex flex-col">
          <SheetHeader className="shrink-0 p-5 border-b border-slate-200 bg-slate-50/80">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-blue-700">
                {selectedPosition?.positionCode}
              </span>
              <Badge
                className={
                  selectedPosition?.jdStatus === 'CONFIGURED'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-bold'
                    : 'bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-bold'
                }
              >
                {selectedPosition?.jdStatus === 'CONFIGURED'
                  ? 'Đã có JD'
                  : 'Chưa thiết lập JD'}
              </Badge>
            </div>
            <SheetTitle className="text-base font-bold text-slate-900 mt-1">
              {selectedPosition?.positionName}
            </SheetTitle>
            <SheetDescription className="text-xs text-slate-500">
              Đơn vị / Phòng ban:{' '}
              <strong className="text-slate-700">
                {selectedPosition?.unit?.name || '----'}
              </strong>{' '}
              — Đang có{' '}
              <strong className="text-blue-700 font-mono">
                {selectedPosition?.activeEmployeeCount} nhân sự
              </strong>
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 text-xs">
            {/* SECTION 1: THÔNG TIN ĐỊNH DANH (Chỉ đọc từ Core - PLAN § 12) */}
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  1. Định danh từ Core Organization (Read-Only)
                </span>
                <Badge className="bg-slate-200/80 text-slate-700 text-[10px]">
                  SaaS Core Source
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                <div>
                  <span className="text-slate-400 block text-[11px]">
                    Mã chức danh
                  </span>
                  <span className="font-mono font-bold text-slate-800">
                    {selectedPosition?.positionCode}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">
                    Tên chức danh
                  </span>
                  <span className="font-semibold text-slate-800">
                    {selectedPosition?.positionName}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">
                    Đơn vị trực thuộc
                  </span>
                  <span className="font-medium text-slate-800">
                    {selectedPosition?.unit?.name || '----'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">
                    Số nhân sự đảm nhiệm
                  </span>
                  <span className="font-mono font-bold text-blue-700">
                    {selectedPosition?.activeEmployeeCount} người
                  </span>
                </div>
              </div>
            </div>

            {/* SECTION 2: QUẢN TRỊ NGẠCH LƯƠNG & CHÍNH SÁCH (PLAN § 13) */}
            <div className="space-y-3">
              <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wide flex items-center gap-1.5 border-b pb-1.5">
                <Layers className="size-3.5 text-blue-700" />
                <span>
                  2. Ngạch lương & Đãi ngộ liên kết (Compensation Mapping)
                </span>
              </h4>
              <div>
                <label className="text-slate-700 block mb-1 font-semibold">
                  Ngạch lương gắn với chức danh:
                </label>
                <SearchableSelect
                  options={[
                    { value: '', label: 'Chưa gán ngạch lương' },
                    ...gradeOptions,
                  ]}
                  value={jdSalaryGradeId}
                  onChange={(val) => setJdSalaryGradeId(val)}
                  placeholder="Chọn ngạch lương liên kết..."
                  clearable={true}
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Nhân sự khi được bổ nhiệm vị trí này sẽ kế thừa dải lương
                  Min - Mid - Max của ngạch đã chọn.
                </span>
              </div>
            </div>

            {/* SECTION 3: MỤC TIÊU VỊ TRÍ (Job Purpose - PLAN § 14) */}
            <div className="space-y-2">
              <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wide flex items-center gap-1.5 border-b pb-1.5">
                <FileText className="size-3.5 text-blue-700" />
                <span>3. Mục tiêu chức danh (Job Purpose) *</span>
              </h4>
              <textarea
                rows={3}
                value={jdJobPurpose}
                onChange={(e) => setJdJobPurpose(e.target.value)}
                placeholder="Mô tả tóm tắt vai trò, mục tiêu chính và sứ mệnh của chức danh trong bộ máy doanh nghiệp..."
                className="w-full rounded-lg border border-slate-200 p-3 text-xs leading-relaxed focus:border-blue-600 focus:outline-none"
              />
            </div>

            {/* SECTION 4: TRÁCH NHIỆM & NHIỆM VỤ CHÍNH (Key Responsibilities - PLAN § 15) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b pb-1.5">
                <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wide flex items-center gap-1.5">
                  <Briefcase className="size-3.5 text-blue-700" />
                  <span>
                    4. Trách nhiệm & Nhiệm vụ chính (
                    {jdResponsibilities.length})
                  </span>
                </h4>
                <span className="text-[11px] text-slate-500">
                  Tổng tỷ trọng:{' '}
                  <strong className="font-mono text-blue-700">
                    {jdResponsibilities.reduce(
                      (acc, r) => acc + (Number(r.weight) || 0),
                      0,
                    )}
                    %
                  </strong>
                </span>
              </div>

              {/* Danh sách nhiệm vụ */}
              <div className="space-y-2">
                {jdResponsibilities.length === 0 ? (
                  <div className="text-center p-4 border border-dashed rounded-lg text-slate-400 text-xs">
                    Chưa có nhiệm vụ nào được cấu hình cho vị trí này.
                  </div>
                ) : (
                  jdResponsibilities.map((resp, idx) => (
                    <div
                      key={idx}
                      className="flex items-start justify-between gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200"
                    >
                      <div className="flex-1 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800 text-xs">
                            {idx + 1}. {resp.title}
                          </span>
                          {resp.weight && (
                            <Badge className="bg-blue-100 text-blue-800 text-[10px] font-mono">
                              {resp.weight}% KPI
                            </Badge>
                          )}
                        </div>
                        {resp.description && (
                          <p className="text-[11px] text-slate-500">
                            {resp.description}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setJdResponsibilities(
                            jdResponsibilities.filter((_, i) => i !== idx),
                          );
                        }}
                        className="text-slate-400 hover:text-red-600 transition-colors p-1"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Form thêm nhiệm vụ mới */}
              <div className="flex items-center gap-2 pt-1">
                <Input
                  placeholder="Nhập tên nhiệm vụ chính (VD: Lập kế hoạch bảo trì thiết bị định kỳ)..."
                  value={newRespTitle}
                  onChange={(e) => setNewRespTitle(e.target.value)}
                  className="h-8 text-xs flex-1 border-slate-200"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newRespTitle.trim()) {
                      e.preventDefault();
                      setJdResponsibilities([
                        ...jdResponsibilities,
                        {
                          title: newRespTitle.trim(),
                          weight: parseFloat(newRespWeight) || undefined,
                          sortOrder: jdResponsibilities.length + 1,
                        },
                      ]);
                      setNewRespTitle('');
                      setNewRespWeight('');
                    }
                  }}
                />
                <div className="w-24">
                  <Input
                    type="number"
                    placeholder="Tỷ trọng %"
                    value={newRespWeight}
                    onChange={(e) => setNewRespWeight(e.target.value)}
                    className="h-8 text-xs font-mono border-slate-200"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs border-blue-200 text-blue-700 hover:bg-blue-50 font-semibold gap-1"
                  onClick={() => {
                    if (!newRespTitle.trim()) return;
                    setJdResponsibilities([
                      ...jdResponsibilities,
                      {
                        title: newRespTitle.trim(),
                        weight: parseFloat(newRespWeight) || undefined,
                        sortOrder: jdResponsibilities.length + 1,
                      },
                    ]);
                    setNewRespTitle('');
                    setNewRespWeight('');
                  }}
                >
                  <Plus className="size-3.5" />
                  Thêm
                </Button>
              </div>
            </div>

            {/* SECTION 5: TIÊU CHUẨN NĂNG LỰC & YÊU CẦU (Requirements - PLAN § 16) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b pb-1.5">
                <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wide flex items-center gap-1.5">
                  <Check className="size-3.5 text-blue-700" />
                  <span>
                    5. Tiêu chuẩn năng lực & Yêu cầu ({jdRequirements.length})
                  </span>
                </h4>
              </div>

              <div className="space-y-2">
                {jdRequirements.length === 0 ? (
                  <div className="text-center p-4 border border-dashed rounded-lg text-slate-400 text-xs">
                    Chưa có tiêu chuẩn năng lực nào được cấu hình.
                  </div>
                ) : (
                  jdRequirements.map((req, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-3 p-2.5 bg-slate-50 rounded-lg border border-slate-200"
                    >
                      <div className="flex items-center gap-2 flex-1">
                        <Badge className="bg-slate-200 text-slate-700 text-[10px]">
                          {req.type || 'SKILL'}
                        </Badge>
                        <span className="font-medium text-slate-800 text-xs">
                          {req.title}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setJdRequirements(
                            jdRequirements.filter((_, i) => i !== idx),
                          );
                        }}
                        className="text-slate-400 hover:text-red-600 transition-colors p-1"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <div className="w-36">
                  <SearchableSelect
                    options={[
                      { value: 'SKILL', label: 'Kỹ năng chuyên môn' },
                      { value: 'EDUCATION', label: 'Trình độ học vấn' },
                      { value: 'EXPERIENCE', label: 'Kinh nghiệm' },
                      { value: 'CERTIFICATE', label: 'Chứng chỉ bắt buộc' },
                      { value: 'OTHER', label: 'Yêu cầu khác' },
                    ]}
                    value={newReqType}
                    onChange={(val) => setNewReqType((val || 'SKILL') as HrmRequirementItem['type'])}
                    clearable={false}
                  />
                </div>
                <Input
                  placeholder="Nhập tiêu chuẩn (VD: Tốt nghiệp Đại học Chuyên ngành Điện lực)..."
                  value={newReqTitle}
                  onChange={(e) => setNewReqTitle(e.target.value)}
                  className="h-8 text-xs flex-1 border-slate-200"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newReqTitle.trim()) {
                      e.preventDefault();
                      setJdRequirements([
                        ...jdRequirements,
                        {
                          title: newReqTitle.trim(),
                          type: newReqType,
                          required: true,
                        },
                      ]);
                      setNewReqTitle('');
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs border-blue-200 text-blue-700 hover:bg-blue-50 font-semibold gap-1"
                  onClick={() => {
                    if (!newReqTitle.trim()) return;
                    setJdRequirements([
                      ...jdRequirements,
                      {
                        title: newReqTitle.trim(),
                        type: newReqType,
                        required: true,
                      },
                    ]);
                    setNewReqTitle('');
                  }}
                >
                  <Plus className="size-3.5" />
                  Thêm
                </Button>
              </div>
            </div>

            {/* SECTION 6: QUYỀN HẠN CHỨC DANH (Authorities - PLAN § 17) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b pb-1.5">
                <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wide flex items-center gap-1.5">
                  <Briefcase className="size-3.5 text-blue-700" />
                  <span>6. Quyền hạn chức danh ({jdAuthorities.length})</span>
                </h4>
              </div>

              <div className="space-y-2">
                {jdAuthorities.length === 0 ? (
                  <div className="text-center p-3 border border-dashed rounded-lg text-slate-400 text-xs">
                    Chưa cấu hình quyền hạn nghiệp vụ cho vị trí này.
                  </div>
                ) : (
                  jdAuthorities.map((auth, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-3 p-2 bg-slate-50 rounded-lg border border-slate-200 text-xs"
                    >
                      <span className="text-slate-800">• {auth}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setJdAuthorities(
                            jdAuthorities.filter((_, i) => i !== idx),
                          );
                        }}
                        className="text-slate-400 hover:text-red-600 transition-colors p-1"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Input
                  placeholder="Nhập quyền hạn (VD: Đề xuất phê duyệt báo giá kỹ thuật trong phạm vi 50 triệu)..."
                  value={newAuthTitle}
                  onChange={(e) => setNewAuthTitle(e.target.value)}
                  className="h-8 text-xs flex-1 border-slate-200"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newAuthTitle.trim()) {
                      e.preventDefault();
                      setJdAuthorities([
                        ...jdAuthorities,
                        newAuthTitle.trim(),
                      ]);
                      setNewAuthTitle('');
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs border-blue-200 text-blue-700 hover:bg-blue-50 font-semibold gap-1"
                  onClick={() => {
                    if (!newAuthTitle.trim()) return;
                    setJdAuthorities([...jdAuthorities, newAuthTitle.trim()]);
                    setNewAuthTitle('');
                  }}
                >
                  <Plus className="size-3.5" />
                  Thêm
                </Button>
              </div>
            </div>
          </div>

          {/* Footer Actions theo PLAN § 21 & § 22 */}
          <div className="shrink-0 p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
            <div>
              {selectedPosition && <PositionLifecycleActions position={selectedPosition} onChanged={async () => { setIsJdDrawerOpen(false); await fetchPositionsFromDb(); }} />}
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8"
                onClick={() => setIsJdDrawerOpen(false)}
                disabled={isSaving}
              >
                Đóng
              </Button>
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 font-semibold shadow-xs px-3"
                permission="hrm.employee.manage"
                onClick={handleSaveJd}
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2 className="size-3.5 animate-spin mr-1" />
                ) : null}
                Lưu cấu hình JD
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
