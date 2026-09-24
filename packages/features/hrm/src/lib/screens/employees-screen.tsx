'use client';

import {
  AlertTriangle,
  Briefcase,
  Check,
  CreditCard,
  Download,
  FileSpreadsheet,
  FileText,
  HeartHandshake,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import type {
  HrmEmployeeProfile,
  HrmSalaryGrade,
  HrmSalaryGradeStep,
  HrmJobDescriptionItem,
  HrmResponsibilityItem,
  HrmRequirementItem,
} from '@enterprise-platform/contracts-hrm';
import { useCallback, useEffect, useState, useMemo } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent } from '../ui/dialog';
import { Input } from '../ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../ui/sheet';
import { toast } from '../ui/toast';
import { SearchableSelect, type SearchableSelectOption } from '@enterprise-platform/shared-ui';

type SubTabKey = 'employees' | 'job_titles' | 'salary_grades' | 'salary_config';

function csrfToken() {
  if (typeof document === 'undefined') return '';
  const value = document.cookie
    .split('; ')
    .find((item) => item.startsWith('ep_csrf='))
    ?.split('=')
    .slice(1)
    .join('=');
  return value ? decodeURIComponent(value) : '';
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
  const [activeTab, setActiveTab] = useState<SubTabKey>('employees');

  // Master States từ Database
  const [employeesList, setEmployeesList] = useState<HrmEmployeeProfile[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<HrmEmployeeProfile | null>(null);
  const [isEmployeeDrawerOpen, setIsEmployeeDrawerOpen] = useState(false);

  // Chức danh & JD (PLAN § 7 - § 25)
  const [positionsList, setPositionsList] = useState<HrmJobDescriptionItem[]>([]);
  const [selectedPosition, setSelectedPosition] = useState<HrmJobDescriptionItem | null>(null);
  const [isJdDrawerOpen, setIsJdDrawerOpen] = useState(false);
  const [isDeletingJd, setIsDeletingJd] = useState(false);

  // Form Fields trong JD Drawer
  const [jdSalaryGradeId, setJdSalaryGradeId] = useState<string>('');
  const [jdJobPurpose, setJdJobPurpose] = useState<string>('');
  const [jdResponsibilities, setJdResponsibilities] = useState<HrmResponsibilityItem[]>([]);
  const [jdRequirements, setJdRequirements] = useState<HrmRequirementItem[]>([]);
  const [jdAuthorities, setJdAuthorities] = useState<string[]>([]);
  const [newRespTitle, setNewRespTitle] = useState('');
  const [newRespWeight, setNewRespWeight] = useState('');
  const [newReqTitle, setNewReqTitle] = useState('');
  const [newReqType, setNewReqType] = useState<HrmRequirementItem['type']>('SKILL');
  const [newAuthTitle, setNewAuthTitle] = useState('');

  // Search & Filter (Tab 2: Job Titles)
  const [jdSearchTerm, setJdSearchTerm] = useState('');
  const [jdUnitFilter, setJdUnitFilter] = useState('ALL');
  const [jdStatusFilter, setJdStatusFilter] = useState<'ALL' | 'CONFIGURED' | 'NOT_CONFIGURED'>('ALL');
  const [jdGradeFilter, setJdGradeFilter] = useState('ALL');

  // Thang bảng lương
  const [salaryGrades, setSalaryGrades] = useState<HrmSalaryGrade[]>([]);
  const [selectedGradeId, setSelectedGradeId] = useState<string>('');
  const [gradeSteps, setGradeSteps] = useState<HrmSalaryGradeStep[]>([]);
  const [isAddStepModalOpen, setIsAddStepModalOpen] = useState(false);

  // Form thêm bậc lương mới
  const [stepNo, setStepNo] = useState('1');
  const [minSalary, setMinSalary] = useState('15000000');
  const [baseSalary, setBaseSalary] = useState('18000000');
  const [maxSalary, setMaxSalary] = useState('22000000');
  const [stepEffectiveFrom, setStepEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));

  // Cấu hình lương nhân sự (Tab 4)
  const [isConfigSalaryModalOpen, setIsConfigSalaryModalOpen] = useState(false);
  const [selectedEmpForSalary, setSelectedEmpForSalary] = useState<string>('');
  const [cfgGradeId, setCfgGradeId] = useState<string>('');
  const [cfgStepId, setCfgStepId] = useState<string>('');
  const [cfgBaseSalary, setCfgBaseSalary] = useState<string>('20000000');
  const [cfgSalaryType, setCfgSalaryType] = useState<'GROSS' | 'NET'>('GROSS');
  const [cfgEffectiveFrom, setCfgEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [cfgChangeReason, setCfgChangeReason] = useState('Ký hợp đồng chính thức');

  // Search & Filter (Tab 1: Employees)
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OFFICIAL' | 'PROBATION'>('ALL');

  // Loading States
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // 1. Tải danh sách nhân sự từ Database API
  const fetchEmployeesFromDb = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/hrm/v1/employees?page_size=100', {
        credentials: 'same-origin',
      });
      if (res.ok) {
        const payload = await res.json();
        const records: HrmEmployeeProfile[] = payload.data || [];
        setEmployeesList(records);
        if (records.length > 0 && !selectedEmployee) {
          setSelectedEmployee(records[0]);
        }
      }
    } catch (err) {
      console.error('Không thể tải nhân viên:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedEmployee]);

  // 2. Tải danh mục Chức danh & JD từ Database API (PLAN § 19)
  const fetchPositionsFromDb = useCallback(async () => {
    try {
      const res = await fetch('/api/hrm/v1/positions', { credentials: 'same-origin' });
      if (res.ok) {
        const payload = await res.json();
        setPositionsList(payload.data || []);
      }
    } catch (err) {
      console.error('Không thể tải danh sách chức danh & JD:', err);
    }
  }, []);

  // 3. Tải danh mục Thang bảng lương từ Database API
  const fetchSalaryGradesFromDb = useCallback(async () => {
    try {
      const res = await fetch('/api/hrm/v1/salary-grades', { credentials: 'same-origin' });
      if (res.ok) {
        const payload = await res.json();
        const grades: HrmSalaryGrade[] = payload.data || [];
        setSalaryGrades(grades);
        if (grades.length > 0) {
          setSelectedGradeId(grades[0].id);
        }
      }
    } catch (err) {
      console.error('Không thể tải ngạch lương:', err);
    }
  }, []);

  // 4. Tải các bậc lương khi chọn 1 ngạch
  const fetchGradeSteps = useCallback(async (gradeId: string) => {
    if (!gradeId) return;
    try {
      const res = await fetch(`/api/hrm/v1/salary-grades/${gradeId}/steps`, { credentials: 'same-origin' });
      if (res.ok) {
        const payload = await res.json();
        setGradeSteps(payload.data || []);
      }
    } catch (err) {
      console.error('Không thể tải bậc lương:', err);
    }
  }, []);

  useEffect(() => {
    void fetchEmployeesFromDb();
    void fetchPositionsFromDb();
    void fetchSalaryGradesFromDb();
  }, [fetchEmployeesFromDb, fetchPositionsFromDb, fetchSalaryGradesFromDb]);

  useEffect(() => {
    if (selectedGradeId) {
      void fetchGradeSteps(selectedGradeId);
    }
  }, [selectedGradeId, fetchGradeSteps]);

  // Tính toán mức độ hoàn thiện hồ sơ theo PLAN § 3.1 & § 7
  const computeCompleteness = (emp: HrmEmployeeProfile): number => {
    let score = 0;
    if (emp.fullName) score += 20;
    if (emp.phone) score += 15;
    if (emp.identityCardNumber) score += 20;
    if (emp.taxCode) score += 15;
    if (emp.bankAccountNumber) score += 15;
    if (emp.emergencyContactName) score += 15;
    return score;
  };

  // Lọc danh sách nhân viên
  const filteredEmployees = useMemo(() => {
    return employeesList.filter((emp) => {
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        !term ||
        (emp.fullName && emp.fullName.toLowerCase().includes(term)) ||
        emp.employeeCode.toLowerCase().includes(term) ||
        (emp.email && emp.email.toLowerCase().includes(term)) ||
        (emp.position && emp.position.toLowerCase().includes(term));
      const matchesStatus = statusFilter === 'ALL' || emp.employmentStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [employeesList, searchTerm, statusFilter]);

  // Nhân sự thử việc (HR Alert)
  const probationCount = useMemo(() => {
    return employeesList.filter((e) => e.employmentStatus === 'PROBATION').length;
  }, [employeesList]);

  // Ngạch lương hiện tại được chọn
  const activeGrade = useMemo(() => {
    return salaryGrades.find((g) => g.id === selectedGradeId);
  }, [salaryGrades, selectedGradeId]);

  // Lưu Bậc lương mới (POST /api/hrm/v1/salary-grades/:id/steps)
  const handleCreateStep = async () => {
    const minVal = parseFloat(minSalary);
    const baseVal = parseFloat(baseSalary);
    const maxVal = parseFloat(maxSalary);

    if (minVal > baseVal || baseVal > maxVal) {
      toast.error({
        title: 'Ràng buộc dải lương không hợp lệ',
        description: 'Mức sàn (Min) phải nhỏ hơn hoặc bằng Cơ bản (Base) và Cơ bản phải nhỏ hơn hoặc bằng Mức trần (Max).',
      });
      return;
    }

    const targetGradeId = selectedGradeId || (salaryGrades[0]?.id ?? '');
    if (!targetGradeId) {
      toast.error({
        title: 'Chưa chọn ngạch lương',
        description: 'Vui lòng chọn một ngạch lương hợp lệ trước khi thêm bậc lương.',
      });
      return;
    }

    try {
      setIsSaving(true);
      const res = await fetch(`/api/hrm/v1/salary-grades/${targetGradeId}/steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
        credentials: 'same-origin',
        body: JSON.stringify({
          stepNo: parseInt(stepNo, 10) || 1,
          minSalary: minVal,
          midSalary: (minVal + maxVal) / 2,
          maxSalary: maxVal,
          baseSalary: baseVal,
          effectiveFrom: stepEffectiveFrom,
        }),
      });

      if (res.ok) {
        toast.success({
          title: 'Thêm bậc lương thành công',
          description: `Bậc ${stepNo} đã được cấu hình cho ngạch ${activeGrade?.code}.`,
        });
        setIsAddStepModalOpen(false);
        await fetchGradeSteps(selectedGradeId);
      } else {
        toast.error({
          title: 'Lỗi',
          description: 'Không thể thêm bậc lương mới.',
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  // Gán cấu hình lương cá nhân (POST /api/hrm/v1/employees/:id/salary-profiles)
  const handleAssignSalaryProfile = async () => {
    if (!selectedEmpForSalary) {
      toast.error({
        title: 'Chưa chọn nhân viên',
        description: 'Vui lòng chọn nhân viên cần gán cấu hình lương.',
      });
      return;
    }

    try {
      setIsSaving(true);
      const res = await fetch(`/api/hrm/v1/employees/${selectedEmpForSalary}/salary-profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
        credentials: 'same-origin',
        body: JSON.stringify({
          salaryGradeId: cfgGradeId || null,
          salaryStepId: cfgStepId || null,
          salaryType: cfgSalaryType,
          baseSalary: parseFloat(cfgBaseSalary) || 0,
          currency: 'VND',
          changeReason: cfgChangeReason,
          effectiveFrom: cfgEffectiveFrom,
        }),
      });

      if (res.ok) {
        toast.success({
          title: 'Gán cấu hình lương thành công',
          description: 'Phiên bản lương mới đã có hiệu lực, phiên bản cũ đã được chuyển sang SUPERSEDED.',
        });
        setIsConfigSalaryModalOpen(false);
      } else {
        toast.error({
          title: 'Lỗi',
          description: 'Không thể gán cấu hình lương cho nhân sự.',
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  // Lọc danh sách Chức danh & JD (PLAN § 10)
  const filteredPositions = useMemo(() => {
    return positionsList.filter((pos) => {
      const term = jdSearchTerm.toLowerCase();
      const matchesSearch =
        !term ||
        pos.positionCode.toLowerCase().includes(term) ||
        pos.positionName.toLowerCase().includes(term);
      const matchesUnit = jdUnitFilter === 'ALL' || pos.unit?.id === jdUnitFilter;
      const matchesStatus = jdStatusFilter === 'ALL' || pos.jdStatus === jdStatusFilter;
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
  }, [positionsList, jdSearchTerm, jdUnitFilter, jdStatusFilter, jdGradeFilter]);

  // Danh sách phòng ban duy nhất để lọc (PLAN § 10)
  const unitOptions: SearchableSelectOption[] = useMemo(() => {
    const map = new Map<string, string>();
    positionsList.forEach((pos) => {
      if (pos.unit?.id && pos.unit?.name) {
        map.set(pos.unit.id, pos.unit.name);
      }
    });
    const opts: SearchableSelectOption[] = [{ value: 'ALL', label: 'Tất cả đơn vị / phòng ban' }];
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
    const resps: HrmResponsibilityItem[] = (pos.responsibilities || []).map((r) => {
      if (typeof r === 'string') {
        return { title: r, weight: undefined, sortOrder: 0 };
      }
      return r;
    });
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
      const res = await fetch(`/api/hrm/v1/positions/${selectedPosition.positionId}/profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken(),
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          salaryGradeId: jdSalaryGradeId || null,
          defaultPolicyId: selectedPosition.defaultPolicyId || null,
          description: jdJobPurpose.trim() || null,
          responsibilities: jdResponsibilities,
          requirements: jdRequirements,
          authorities: jdAuthorities,
          active: true,
        }),
      });

      if (res.ok) {
        toast.success({
          title: 'Lưu JD thành công',
          description: `Đã cập nhật bản mô tả công việc cho chức danh: ${selectedPosition.positionName}.`,
        });
        setIsJdDrawerOpen(false);
        await fetchPositionsFromDb();
      } else {
        toast.error({
          title: 'Lỗi',
          description: 'Không thể lưu bản mô tả công việc JD.',
        });
      }
    } catch (err) {
      console.error(err);
      toast.error({
        title: 'Lỗi kết nối',
        description: 'Đã xảy ra lỗi khi lưu JD.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Xóa / Soft Delete JD (PLAN § 22)
  const handleDeleteJd = async () => {
    if (!selectedPosition) return;
    try {
      setIsDeletingJd(true);
      const res = await fetch(`/api/hrm/v1/positions/${selectedPosition.positionId}/profile`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken() },
        credentials: 'same-origin',
      });

      if (res.ok) {
        toast.success({
          title: 'Xóa JD thành công',
          description: `Đã thu hồi bản mô tả công việc của ${selectedPosition.positionName}. Vị trí tại Core được giữ nguyên.`,
        });
        setIsJdDrawerOpen(false);
        await fetchPositionsFromDb();
      } else {
        toast.error({
          title: 'Lỗi',
          description: 'Không thể xóa cấu hình JD.',
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeletingJd(false);
    }
  };

  // Chuẩn bị options SearchableSelect
  const employeeOptions: SearchableSelectOption[] = useMemo(() => {
    return employeesList.map((e) => ({
      value: e.employeeId,
      label: `${e.fullName || 'Nhân sự'} (${e.employeeCode})`,
      badge: e.department || 'Nhân sự',
      description: e.position || undefined,
    }));
  }, [employeesList]);

  const gradeOptions: SearchableSelectOption[] = useMemo(() => {
    return salaryGrades.map((g) => ({
      value: g.id,
      label: `${g.name} (${g.code})`,
      badge: g.code,
    }));
  }, [salaryGrades]);

  const stepOptions: SearchableSelectOption[] = useMemo(() => {
    return gradeSteps.map((s) => ({
      value: s.id,
      label: `Bậc ${s.stepNo} - Cơ bản: ${Number(s.baseSalary).toLocaleString('vi-VN')} đ`,
      badge: `Bậc ${s.stepNo}`,
    }));
  }, [gradeSteps]);

  // Đếm JD đã cấu hình
  const configuredJdCount = useMemo(() => {
    return positionsList.filter((p) => p.jdStatus === 'CONFIGURED').length;
  }, [positionsList]);

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Page Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Quản lý Nhân sự & Tiêu chuẩn Chức danh
            </h1>
            <Badge className="bg-blue-50 text-blue-800 border-blue-200 text-xs font-semibold">
              Live Database Connected
            </Badge>
          </div>
          <p className="text-xs text-slate-500">
            Hồ sơ nhân sự toàn hệ thống, tiêu chuẩn vị trí & JD, ngạch bậc lương và cấu hình lương cá nhân.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2.5">
          <Button
            size="sm"
            variant="outline"
            disabled={isLoading}
            className="text-xs h-9 border-slate-200 text-slate-700 hover:bg-slate-50 font-medium gap-1.5"
            onClick={async () => {
              await fetchEmployeesFromDb();
              await fetchSalaryGradesFromDb();
              toast.success({
                title: 'Đồng bộ hoàn tất',
                description: 'Đã tải mới nhất danh sách nhân sự và ngạch lương từ Database.',
              });
            }}
          >
            <RefreshCw className={`size-3.5 text-blue-700 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? 'Đang đồng bộ...' : 'Đồng bộ từ Database'}</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="text-xs h-9 border-slate-200 text-slate-700 hover:bg-slate-50 font-medium gap-1.5"
            onClick={() => {
              toast.success({
                title: 'Xuất dữ liệu Excel',
                description: 'Đang tải về tệp HRM_Danh_Sach_Nhan_Su.xlsx...',
              });
            }}
          >
            <Download className="size-3.5 text-emerald-600" />
            <span>Xuất Excel</span>
          </Button>

          <Button
            size="sm"
            className="text-xs h-9 bg-[#021E73] hover:bg-blue-900 text-white font-semibold gap-1.5 shadow-xs"
            onClick={() => {
              if (activeTab === 'salary_config') {
                setIsConfigSalaryModalOpen(true);
              } else if (activeTab === 'salary_grades') {
                setIsAddStepModalOpen(true);
              } else {
                toast.info({
                  title: 'Thông báo',
                  description: 'Thêm nhân sự mới được kết nối qua quy trình tuyển dụng hoặc trang quản trị người dùng Core.',
                });
              }
            }}
          >
            <Plus className="size-3.5" />
            <span>
              {activeTab === 'salary_config'
                ? 'Gán cấu hình lương'
                : activeTab === 'salary_grades'
                ? 'Thêm bậc lương'
                : 'Thêm hồ sơ mới'}
            </span>
          </Button>
        </div>
      </div>

      {/* 2. Top Metric Cards (PLAN § 3.1 & § 8) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Tổng nhân sự quản lý
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-900 font-mono">
                {employeesList.length}
              </span>
              <span className="text-xs text-blue-700 font-semibold">Nhân viên</span>
            </div>
            <span className="text-[11px] text-slate-500 block">Dữ liệu thực tế từ Database</span>
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
              <span className="text-xs text-slate-500 font-medium">Thử việc</span>
            </div>
            <span className="text-[11px] text-amber-700 font-medium block">
              {probationCount > 0 ? 'Cần đánh giá hợp đồng' : 'Không có cảnh báo'}
            </span>
          </div>
          <div className="size-11 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-100">
            <AlertTriangle className="size-5" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Chức danh & JD (Positions)
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-[#021E73] font-mono">
                {positionsList.length}
              </span>
              <span className="text-xs text-slate-500 font-medium">Vị trí</span>
            </div>
            <span className="text-[11px] text-emerald-700 font-medium block">
              {configuredJdCount} vị trí đã có JD ({Math.round((configuredJdCount / (positionsList.length || 1)) * 100)}%)
            </span>
          </div>
          <div className="size-11 rounded-xl bg-blue-50 text-[#021E73] flex items-center justify-center border border-blue-100">
            <Briefcase className="size-5" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Ngạch lương (Grades)
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-900 font-mono">
                {salaryGrades.length}
              </span>
              <span className="text-xs text-slate-500 font-medium">Ngạch chuẩn</span>
            </div>
            <span className="text-[11px] text-slate-500 block">{gradeSteps.length} bậc thuộc ngạch chọn</span>
          </div>
          <div className="size-11 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center border border-slate-200">
            <Layers className="size-5" />
          </div>
        </div>
      </div>

      {/* 3. Horizontal Sub-tabs (Chuỗi 4 Tab theo PLAN) */}
      <div className="border-b border-slate-200">
        <div className="flex space-x-8 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('employees')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'employees'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Users className="size-4" />
            <span>Nhân sự (Employee Management)</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
              {employeesList.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('job_titles')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'job_titles'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Briefcase className="size-4" />
            <span>Chức danh & JD (Position & Architecture)</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
              {positionsList.length} Vị trí
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('salary_grades')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'salary_grades'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Layers className="size-4" />
            <span>Thang bảng lương (Salary Structure)</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
              {salaryGrades.length} Ngạch
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('salary_config')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'salary_config'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <FileSpreadsheet className="size-4" />
            <span>Cấu hình lương nhân sự (Compensation)</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
              Cá nhân hóa
            </span>
          </button>
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
                  ]}
                  value={statusFilter}
                  onChange={(val) => setStatusFilter((val || 'ALL') as any)}
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
                    <th className="py-3.5 px-4 text-center">Hoàn thiện hồ sơ</th>
                    <th className="py-3.5 px-4 text-center">Trạng thái</th>
                    <th className="py-3.5 px-4 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {isLoading ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="size-4 animate-spin text-[#021E73]" />
                          <span>Đang tải hồ sơ nhân sự từ Database...</span>
                        </div>
                      </td>
                    </tr>
                  ) : filteredEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        Chưa có hồ sơ nhân viên nào trong cơ sở dữ liệu.
                      </td>
                    </tr>
                  ) : (
                    filteredEmployees.map((emp) => {
                      const completeness = computeCompleteness(emp);
                      return (
                        <tr key={emp.employeeId} className="hover:bg-slate-50/80 transition-colors">
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
                            <span>{emp.joinDate ? String(emp.joinDate).slice(0, 10) : '----'}</span>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <div className="inline-flex items-center gap-1.5">
                              <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                                <div
                                  className={`h-full ${
                                    completeness === 100
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
                                THỬ VIỆC
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
                              Xem hồ sơ (Drawer)
                            </Button>
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
                Hiển thị <strong>{filteredEmployees.length}</strong> / {employeesList.length} nhân sự
              </span>
              <span className="text-[11px] text-slate-400">Kết nối cơ sở dữ liệu hrm_schema</span>
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
                  onChange={(val) => setJdStatusFilter((val || 'ALL') as any)}
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
                  Danh mục Vị trí Chức danh & Tiêu chuẩn Mô tả công việc (Job Descriptions)
                </h3>
                <p className="text-xs text-slate-500">
                  Kế thừa định danh từ Core Organization, quản lý tiêu chuẩn JD và ngạch lương mở rộng của HRM.
                </p>
              </div>
              <Badge className="bg-blue-50 text-blue-800 border-blue-200 text-xs font-semibold">
                Hiển thị {filteredPositions.length} / {positionsList.length} chức danh
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
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        Không tìm thấy vị trí chức danh nào phù hợp với bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    filteredPositions.map((pos) => {
                      const isConfigured = pos.jdStatus === 'CONFIGURED';
                      return (
                        <tr key={pos.positionId} className="hover:bg-slate-50/80 transition-colors">
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
                              className={`h-7 text-xs font-semibold ${
                                isConfigured
                                  ? 'border-blue-200 text-blue-700 hover:bg-blue-50'
                                  : 'border-amber-200 text-amber-800 hover:bg-amber-50'
                              }`}
                              onClick={() => handleOpenJdDrawer(pos)}
                            >
                              {isConfigured ? 'Chỉnh sửa JD' : 'Cấu hình JD'}
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

      {/* SUB-TAB 3: THANG BẢNG LƯƠNG (Salary Grades Matrix) */}
      {activeTab === 'salary_grades' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Ngạch lương (4 Cols) */}
          <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="size-4 text-blue-700" />
                <h3 className="font-bold text-slate-900 text-sm">Ngạch lương (Grades)</h3>
              </div>
              <Badge className="bg-blue-100 text-blue-800 text-[10px] font-bold">
                {salaryGrades.length} Ngạch
              </Badge>
            </div>

            <div className="p-3 space-y-2.5">
              {salaryGrades.map((g) => {
                const isSelected = g.id === selectedGradeId;
                return (
                  <div
                    key={g.id}
                    onClick={() => setSelectedGradeId(g.id)}
                    className={`p-3 rounded-lg border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-[#021E73] bg-blue-50/60 shadow-xs ring-1 ring-[#021E73]'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="font-mono font-bold text-xs text-blue-700 px-1.5 py-0.5 bg-blue-100 rounded">
                          {g.code}
                        </span>
                        <h4 className="font-bold text-slate-900 text-xs mt-1.5">{g.name}</h4>
                      </div>
                      <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">ACTIVE</Badge>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-2 line-clamp-1">{g.description}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Steps Table (8 Cols) */}
          <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  Chi tiết Bậc lương — Ngạch: <span className="font-mono text-blue-700">{activeGrade?.code}</span>
                </h3>
                <p className="text-xs text-slate-500">{activeGrade?.name}</p>
              </div>
              <Button
                size="sm"
                className="text-xs h-8 bg-[#021E73] hover:bg-blue-900 text-white font-semibold gap-1.5"
                onClick={() => setIsAddStepModalOpen(true)}
              >
                <Plus className="size-3.5" />
                <span>+ Thêm bậc lương</span>
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="py-3.5 px-4">Bậc (Step)</th>
                    <th className="py-3.5 px-4 text-right">Mức sàn (Min)</th>
                    <th className="py-3.5 px-4 text-right">Cơ bản chuẩn (Base)</th>
                    <th className="py-3.5 px-4 text-right">Mức trần (Max)</th>
                    <th className="py-3.5 px-4">Ngày hiệu lực</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {gradeSteps.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400">
                        Ngạch này chưa có bậc lương nào được thiết lập.
                      </td>
                    </tr>
                  ) : (
                    gradeSteps.map((step) => (
                      <tr key={step.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4">
                          <Badge className="bg-blue-100 text-blue-800 text-xs font-bold font-mono">
                            Bậc {step.stepNo}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-slate-600">
                          {Number(step.minSalary).toLocaleString('vi-VN')} đ
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-blue-700">
                          {Number(step.baseSalary).toLocaleString('vi-VN')} đ
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-slate-600">
                          {Number(step.maxSalary).toLocaleString('vi-VN')} đ
                        </td>
                        <td className="py-3.5 px-4 font-mono text-slate-500">
                          {step.effectiveFrom ? String(step.effectiveFrom).slice(0, 10) : 'Vô thời hạn'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: CẤU HÌNH LƯƠNG NHÂN SỰ */}
      {activeTab === 'salary_config' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  Cấu hình Lương cá nhân theo Hợp đồng (Employee Compensation)
                </h3>
                <p className="text-xs text-slate-500">
                  Gán ngạch bậc, mức lương cơ bản và chế độ tính lương cho từng nhân sự.
                </p>
              </div>
              <Button
                size="sm"
                className="bg-[#021E73] hover:bg-blue-900 text-white text-xs font-semibold h-8 gap-1.5"
                onClick={() => setIsConfigSalaryModalOpen(true)}
              >
                <Plus className="size-3.5" />
                <span>Gán cấu hình lương mới</span>
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="py-3.5 px-4">Mã NV</th>
                    <th className="py-3.5 px-4">Họ và tên</th>
                    <th className="py-3.5 px-4">Chức danh / Phòng ban</th>
                    <th className="py-3.5 px-4 text-center">Trạng thái việc làm</th>
                    <th className="py-3.5 px-4 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {employeesList.map((emp) => (
                    <tr key={emp.employeeId} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-bold text-blue-700">{emp.employeeCode}</td>
                      <td className="py-3.5 px-4 font-bold text-slate-900">{emp.fullName || '----'}</td>
                      <td className="py-3.5 px-4">
                        <span className="font-semibold text-slate-800 block">{emp.position || '----'}</span>
                        <span className="text-[11px] text-slate-500 block">{emp.department || '----'}</span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <Badge
                          className={
                            emp.employmentStatus === 'OFFICIAL'
                              ? 'bg-emerald-100 text-emerald-800 text-[10px]'
                              : 'bg-amber-100 text-amber-800 text-[10px]'
                          }
                        >
                          {emp.employmentStatus}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-blue-200 text-blue-700 hover:bg-blue-50 font-semibold"
                          onClick={() => {
                            setSelectedEmpForSalary(emp.employeeId);
                            setIsConfigSalaryModalOpen(true);
                          }}
                        >
                          Cấu hình lương
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* DRAWER 1: XEM CHI TIẾT HỒ SƠ NHÂN VIÊN 5 KHỐI THEO PLAN */}
      <Sheet open={isEmployeeDrawerOpen} onOpenChange={setIsEmployeeDrawerOpen}>
        <SheetContent className="max-w-xl p-0 overflow-hidden bg-white flex flex-col justify-between">
          <div>
            <SheetHeader>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-[#021E73]">
                  {selectedEmployee?.employeeCode}
                </span>
                <Badge
                  className={
                    selectedEmployee?.employmentStatus === 'OFFICIAL'
                      ? 'bg-emerald-100 text-emerald-800 text-[10px]'
                      : 'bg-amber-100 text-amber-800 text-[10px]'
                  }
                >
                  {selectedEmployee?.employmentStatus}
                </Badge>
              </div>
              <SheetTitle className="text-base font-bold text-slate-900 mt-1">
                {selectedEmployee?.fullName || 'Hồ sơ nhân sự'}
              </SheetTitle>
              <SheetDescription className="text-xs text-slate-500">
                {selectedEmployee?.position || 'Chức danh'} • {selectedEmployee?.department || 'Phòng ban'}
              </SheetDescription>
            </SheetHeader>

            <div className="p-6 space-y-5 text-xs overflow-y-auto max-h-[calc(100vh-140px)]">
              {/* KHỐI 1: HỒ SƠ CÁ NHÂN */}
              <div className="space-y-2.5">
                <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] flex items-center gap-1.5 text-blue-900">
                  <FileText className="size-3.5 text-blue-600" />
                  1. Hồ sơ cá nhân
                </h4>
                <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 space-y-2">
                  <div className="flex justify-between py-1 border-b border-slate-200/60">
                    <span className="text-slate-500">Số điện thoại:</span>
                    <span className="font-semibold text-slate-900">{selectedEmployee?.phone || '----'}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200/60">
                    <span className="text-slate-500">Email:</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {selectedEmployee?.email || selectedEmployee?.personalEmail || '----'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200/60">
                    <span className="text-slate-500">Ngày sinh & Giới tính:</span>
                    <span className="font-semibold text-slate-900">
                      {formatVnDate(selectedEmployee?.dateOfBirth)} (
                      {selectedEmployee?.gender === 'FEMALE' ? 'Nữ' : 'Nam'})
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200/60">
                    <span className="text-slate-500">Số CCCD / Hộ chiếu:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {selectedEmployee?.identityCardNumber || 'Chưa cập nhật'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Địa chỉ thường trú:</span>
                    <span className="font-semibold text-slate-900 text-right">
                      {selectedEmployee?.permanentAddress || selectedEmployee?.currentAddress || '----'}
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
                      {selectedEmployee?.emergencyContactName || 'Chưa thiết lập'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200/60">
                    <span className="text-slate-500">Mối quan hệ:</span>
                    <span className="font-semibold text-slate-900">
                      {selectedEmployee?.emergencyContactRelationship || '----'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Số điện thoại liên hệ:</span>
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
                      {selectedEmployee?.joinDate ? String(selectedEmployee.joinDate).slice(0, 10) : '----'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200/60">
                    <span className="text-slate-500">Ngày chính thức:</span>
                    <span className="font-mono font-semibold text-emerald-700">
                      {selectedEmployee?.officialDate ? String(selectedEmployee.officialDate).slice(0, 10) : 'Đang thử việc'}
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
                      {selectedEmployee?.taxCode || 'Chưa cập nhật'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200/60">
                    <span className="text-slate-500">Số tài khoản nhận lương:</span>
                    <span className="font-mono font-bold text-blue-700">
                      {selectedEmployee?.bankAccountNumber || 'Chưa liên kết'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Ngân hàng thụ hưởng:</span>
                    <span className="font-semibold text-slate-900">
                      {selectedEmployee?.bankName ? `${selectedEmployee.bankName} ${selectedEmployee.bankBranch || ''}` : '----'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
            <Button
              size="sm"
              className="bg-[#021E73] hover:bg-blue-900 text-white text-xs h-8"
              onClick={() => setIsEmployeeDrawerOpen(false)}
            >
              Đóng hồ sơ
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* DRAWER 2: CẤU HÌNH & QUẢN LÝ TIÊU CHUẨN JD (PLAN § 11 - § 17) */}
      <Sheet open={isJdDrawerOpen} onOpenChange={setIsJdDrawerOpen}>
        <SheetContent className="w-full sm:max-w-[760px] p-0 overflow-hidden bg-white flex flex-col justify-between">
          <div>
            <SheetHeader className="p-5 border-b border-slate-200 bg-slate-50/80">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-blue-700">
                  {selectedPosition?.positionCode}
                </span>
                <Badge
                  className={
                    selectedPosition?.jdStatus === 'CONFIGURED'
                      ? 'bg-emerald-100 text-emerald-800 text-[10px] font-bold border border-emerald-200'
                      : 'bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-200'
                  }
                >
                  {selectedPosition?.jdStatus === 'CONFIGURED' ? 'Đã có JD' : 'Chưa thiết lập JD'}
                </Badge>
              </div>
              <SheetTitle className="text-base font-bold text-slate-900 mt-1">
                {selectedPosition?.positionName}
              </SheetTitle>
              <SheetDescription className="text-xs text-slate-500">
                Đơn vị / Phòng ban: <strong className="text-slate-700">{selectedPosition?.unit?.name || '----'}</strong> — Đang có <strong className="text-blue-700 font-mono">{selectedPosition?.activeEmployeeCount} nhân sự</strong>
              </SheetDescription>
            </SheetHeader>

            <div className="p-6 space-y-6 text-xs overflow-y-auto max-h-[calc(100vh-145px)]">
              {/* SECTION 1: THÔNG TIN ĐỊNH DANH (Chỉ đọc từ Core - PLAN § 12) */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    1. Định danh từ Core Organization (Read-Only)
                  </span>
                  <Badge className="bg-slate-200/80 text-slate-700 text-[10px]">SaaS Core Source</Badge>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Mã chức danh</span>
                    <span className="font-mono font-bold text-slate-800">{selectedPosition?.positionCode}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Tên chức danh</span>
                    <span className="font-semibold text-slate-800">{selectedPosition?.positionName}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Đơn vị trực thuộc</span>
                    <span className="font-medium text-slate-800">{selectedPosition?.unit?.name || '----'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Số nhân sự đảm nhiệm</span>
                    <span className="font-mono font-bold text-blue-700">{selectedPosition?.activeEmployeeCount} người</span>
                  </div>
                </div>
              </div>

              {/* SECTION 2: QUẢN TRỊ NGẠCH LƯƠNG & CHÍNH SÁCH (PLAN § 13) */}
              <div className="space-y-3">
                <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wide flex items-center gap-1.5 border-b pb-1.5">
                  <Layers className="size-3.5 text-blue-700" />
                  <span>2. Ngạch lương & Đãi ngộ liên kết (Compensation Mapping)</span>
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
                    Nhân sự khi được bổ nhiệm vị trí này sẽ kế thừa dải lương Min - Mid - Max của ngạch đã chọn.
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
                    <span>4. Trách nhiệm & Nhiệm vụ chính ({jdResponsibilities.length})</span>
                  </h4>
                  <span className="text-[11px] text-slate-500">
                    Tổng tỷ trọng: <strong className="font-mono text-blue-700">{jdResponsibilities.reduce((acc, r) => acc + (Number(r.weight) || 0), 0)}%</strong>
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
                            <span className="font-bold text-slate-800 text-xs">{idx + 1}. {resp.title}</span>
                            {resp.weight && (
                              <Badge className="bg-blue-100 text-blue-800 text-[10px] font-mono">
                                {resp.weight}% KPI
                              </Badge>
                            )}
                          </div>
                          {resp.description && (
                            <p className="text-[11px] text-slate-500">{resp.description}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setJdResponsibilities(jdResponsibilities.filter((_, i) => i !== idx));
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
                    <span>5. Tiêu chuẩn năng lực & Yêu cầu ({jdRequirements.length})</span>
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
                          <span className="font-medium text-slate-800 text-xs">{req.title}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setJdRequirements(jdRequirements.filter((_, i) => i !== idx));
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
                      onChange={(val) => setNewReqType((val || 'SKILL') as any)}
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
                          { title: newReqTitle.trim(), type: newReqType, required: true },
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
                        { title: newReqTitle.trim(), type: newReqType, required: true },
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
                            setJdAuthorities(jdAuthorities.filter((_, i) => i !== idx));
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
                        setJdAuthorities([...jdAuthorities, newAuthTitle.trim()]);
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
          </div>

          {/* Footer Actions theo PLAN § 21 & § 22 */}
          <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
            <div>
              {selectedPosition?.jdStatus === 'CONFIGURED' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs border-red-200 text-red-600 hover:bg-red-50 gap-1.5"
                  onClick={handleDeleteJd}
                  disabled={isDeletingJd || isSaving}
                >
                  <Trash2 className="size-3.5" />
                  <span>{isDeletingJd ? 'Đang xóa...' : 'Thu hồi / Xóa JD'}</span>
                </Button>
              )}
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
                className="bg-[#021E73] hover:bg-blue-900 text-white text-xs h-8 font-semibold shadow-xs"
                onClick={handleSaveJd}
                disabled={isSaving}
              >
                {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : 'Lưu cấu hình JD'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* MODAL 1: THÊM BẬC LƯƠNG MỚI */}
      <Dialog open={isAddStepModalOpen} onOpenChange={setIsAddStepModalOpen}>
        <DialogContent className="max-w-md p-6 bg-white space-y-4">
          <div className="border-b pb-3">
            <h3 className="font-bold text-slate-900 text-sm">Thêm bậc lương cho ngạch: {activeGrade?.code || 'Chưa chọn'}</h3>
            <p className="text-xs text-slate-500">Ràng buộc: Mức sàn (Min) ≤ Cơ bản (Base) ≤ Mức trần (Max)</p>
          </div>

          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="text-slate-700 block font-semibold">Ngạch lương áp dụng *</label>
              <SearchableSelect
                options={gradeOptions}
                value={selectedGradeId}
                onChange={(val) => setSelectedGradeId(val)}
                placeholder="Chọn ngạch lương..."
                clearable={false}
              />
            </div>
            <div>
              <label className="text-slate-700 block mb-1 font-semibold">Số thứ tự Bậc (Step No) *</label>
              <Input
                type="number"
                value={stepNo}
                onChange={(e) => setStepNo(e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-slate-700 block mb-1 font-semibold">Mức sàn (Min Salary VNĐ) *</label>
              <Input
                type="number"
                value={minSalary}
                onChange={(e) => setMinSalary(e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-slate-700 block mb-1 font-semibold">Lương cơ bản chuẩn (Base Salary VNĐ) *</label>
              <Input
                type="number"
                value={baseSalary}
                onChange={(e) => setBaseSalary(e.target.value)}
                className="h-8 text-xs font-mono font-bold text-blue-700"
              />
            </div>
            <div>
              <label className="text-slate-700 block mb-1 font-semibold">Mức trần (Max Salary VNĐ) *</label>
              <Input
                type="number"
                value={maxSalary}
                onChange={(e) => setMaxSalary(e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-slate-700 block mb-1 font-semibold">Ngày bắt đầu hiệu lực *</label>
              <Input
                type="date"
                value={stepEffectiveFrom}
                onChange={(e) => setStepEffectiveFrom(e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setIsAddStepModalOpen(false)}
              disabled={isSaving}
            >
              Hủy
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs bg-[#021E73] hover:bg-blue-900 text-white font-semibold"
              onClick={handleCreateStep}
              disabled={isSaving}
            >
              {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : 'Lưu bậc lương'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL 2: GÁN CẤU HÌNH LƯƠNG NHÂN SỰ (Tab 4) */}
      <Dialog open={isConfigSalaryModalOpen} onOpenChange={setIsConfigSalaryModalOpen}>
        <DialogContent className="max-w-md p-6 bg-white space-y-4">
          <div className="border-b pb-3">
            <h3 className="font-bold text-slate-900 text-sm">Gán Cấu hình Lương Nhân sự</h3>
            <p className="text-xs text-slate-500">Tạo phiên bản lương mới và tự động kết thúc phiên bản cũ</p>
          </div>

          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="text-slate-700 block font-semibold">Chọn nhân sự *</label>
              <SearchableSelect
                options={employeeOptions}
                value={selectedEmpForSalary}
                onChange={(val) => setSelectedEmpForSalary(val)}
                placeholder="Tìm nhân sự theo mã hoặc tên..."
                clearable={false}
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-700 block font-semibold">Ngạch lương áp dụng</label>
              <SearchableSelect
                options={gradeOptions}
                value={cfgGradeId}
                onChange={(val) => {
                  setCfgGradeId(val);
                  if (val) void fetchGradeSteps(val);
                }}
                placeholder="Chọn ngạch lương..."
                clearable
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-700 block font-semibold">Bậc lương áp dụng</label>
              <SearchableSelect
                options={stepOptions}
                value={cfgStepId}
                onChange={(val) => setCfgStepId(val)}
                placeholder="Chọn bậc lương..."
                clearable
              />
            </div>

            <div>
              <label className="text-slate-700 block mb-1 font-semibold">Lương cơ bản (VNĐ) *</label>
              <Input
                type="number"
                value={cfgBaseSalary}
                onChange={(e) => setCfgBaseSalary(e.target.value)}
                className="h-8 text-xs font-mono font-bold text-blue-700"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-700 block mb-1 font-semibold">Loại lương</label>
                <SearchableSelect
                  options={[
                    { value: 'GROSS', label: 'Lương Gross' },
                    { value: 'NET', label: 'Lương Net' },
                  ]}
                  value={cfgSalaryType}
                  onChange={(val) => setCfgSalaryType((val || 'GROSS') as any)}
                  clearable={false}
                />
              </div>
              <div>
                <label className="text-slate-700 block mb-1 font-semibold">Ngày hiệu lực *</label>
                <Input
                  type="date"
                  value={cfgEffectiveFrom}
                  onChange={(e) => setCfgEffectiveFrom(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="text-slate-700 block mb-1 font-semibold">Lý do thay đổi</label>
              <Input
                value={cfgChangeReason}
                onChange={(e) => setCfgChangeReason(e.target.value)}
                placeholder="VD: Điều chỉnh sau thử việc / Tăng lương định kỳ"
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setIsConfigSalaryModalOpen(false)}
              disabled={isSaving}
            >
              Hủy
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs bg-[#021E73] hover:bg-blue-900 text-white font-semibold"
              onClick={handleAssignSalaryProfile}
              disabled={isSaving}
            >
              {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : 'Lưu cấu hình lương'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
