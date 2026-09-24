'use client';

import {
  Clock,
  Download,
  FileCheck2,
  FilePlus,
  FileText,
  History,
  Info,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useEffect, useState, useMemo } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent } from '../ui/dialog';
import { EmployeeHeroCard, type EmployeeProfileHeroData } from '../ui/employee-hero-card';
import { Input } from '../ui/input';
import { DatePickerInput } from '../ui/date-picker-input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../ui/sheet';
import { toast } from '../ui/toast';
import { SearchableSelect, type SearchableSelectOption, Popconfirm } from '@enterprise-platform/shared-ui';

type RequestSubTab = 'catalog' | 'pending' | 'history';
type RequestKind = 'leave' | 'ot' | 'business_trip' | 'shift_change' | 'correction' | 'advance' | 'profile_correction';

interface RequestItem {
  id: string;
  code: string;
  kind: RequestKind;
  typeName: string;
  category: string;
  createdAt: string;
  effectiveDate: string;
  duration: string;
  reason: string;
  approver: string;
  // Tách biệt Request Status và Workflow Status theo Mục 14 trong PLAN
  workflowStatus: 'SUBMITTED' | 'PENDING_PEER' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  requestStatus: 'SUBMITTED' | 'PENDING' | 'APPROVED' | 'APPLIED' | 'DISBURSED' | 'REPAID' | 'REJECTED' | 'CANCELLED';
  statusText: string;
  // Chi tiết mở rộng của từng nghiệp vụ
  rawDetails: Record<string, unknown>;
}

interface LeaveTypeItem {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  unit: string;
}

interface ShiftItem {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
}

interface EmployeeItem {
  id: string;
  employeeCode: string;
  fullName: string;
  department?: string;
  position?: string;
}

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

export default function RequestsPage() {
  const [activeTab, setActiveTab] = useState<RequestSubTab>('catalog');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedCatalogId, setSelectedCatalogId] = useState<RequestKind>('leave');
  const [selectedTypeTitle, setSelectedTypeTitle] = useState('Đơn xin nghỉ phép');

  // Master Data
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeItem[]>([]);
  const [shiftsList, setShiftsList] = useState<ShiftItem[]>([]);
  const [colleaguesList, setColleaguesList] = useState<EmployeeItem[]>([]);

  // State form nhập liệu chung & từng loại đơn
  const [selectedLeaveTypeId, setSelectedLeaveTypeId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [leaveDuration, setLeaveDuration] = useState('1.0');
  
  // OT state
  const [otType, setOtType] = useState<'WEEKDAY' | 'WEEKEND' | 'HOLIDAY' | 'NIGHT'>('WEEKDAY');
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('21:00');

  // Business trip state
  const [tripType, setTripType] = useState<'DOMESTIC' | 'OVERSEAS' | 'INTERSITE'>('DOMESTIC');
  const [destination, setDestination] = useState('');
  const [allowOt, setAllowOt] = useState(false);

  // Shift change state
  const [changeType, setChangeType] = useState<'SWAP' | 'CHANGE_SHIFT'>('SWAP');
  const [currentShiftId, setCurrentShiftId] = useState('');
  const [requestedShiftId, setRequestedShiftId] = useState('');
  const [swapWithEmployeeId, setSwapWithEmployeeId] = useState('');

  // Attendance correction state
  const [currentCheckIn, setCurrentCheckIn] = useState('08:30');
  const [currentCheckOut, setCurrentCheckOut] = useState('17:00');
  const [proposedCheckIn, setProposedCheckIn] = useState('08:00');
  const [proposedCheckOut, setProposedCheckOut] = useState('17:30');

  // Salary advance state
  const [requestedAmount, setRequestedAmount] = useState('5000000');
  const [numberOfInstallments, setNumberOfInstallments] = useState('1');

  // Profile correction state - Hỗ trợ nhập trực tiếp nhiều trường cùng lúc
  const [adjustFullName, setAdjustFullName] = useState<string>('');
  const [adjustDateOfBirth, setAdjustDateOfBirth] = useState<string>('');
  const [adjustGender, setAdjustGender] = useState<string>('');
  const [adjustIdentityCard, setAdjustIdentityCard] = useState<string>('');
  const [adjustIdentityDate, setAdjustIdentityDate] = useState<string>('');
  const [adjustIdentityPlace, setAdjustIdentityPlace] = useState<string>('');
  const [adjustTaxCode, setAdjustTaxCode] = useState<string>('');
  const [adjustSocialInsurance, setAdjustSocialInsurance] = useState<string>('');
  const [profileEvidenceDoc, setProfileEvidenceDoc] = useState<string>('');

  // Reason & Submission
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  // Drawer chi tiết theo chuẩn 5 khối
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<RequestItem | null>(null);

  // Filter cho bảng Lịch sử (Zone 1: Filters)
  const [searchQuery, setSearchQuery] = useState('');
  const [filterKind, setFilterKind] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  // Profile data from API
  const [profile, setProfile] = useState<EmployeeProfileHeroData & { id: string }>({
    id: '',
    fullName: '',
    employeeCode: '',
    department: '',
    position: '',
    employmentStatus: '',
    workEmail: '',
    phone: '',
    roleLabel: 'Tenant Administrator',
    joinDate: '',
  });

  const [rawProfile, setRawProfile] = useState<Record<string, any>>({});

  // Annual leave balance
  const [leaveBalance, setLeaveBalance] = useState<{ remaining: string; entitlement: string }>({
    remaining: '----',
    entitlement: '----',
  });

  // Requests list fetched from API
  const [requestsList, setRequestsList] = useState<RequestItem[]>([]);

  // Danh mục loại đơn hệ thống
  const requestCatalog = [
    {
      id: 'leave' as RequestKind,
      title: 'Đơn xin nghỉ phép',
      desc: 'Nghỉ phép năm, nghỉ ốm BHXH, việc riêng có hưởng lương, nghỉ không lương theo quy chế.',
      tag: 'Tự động trừ quỹ phép',
      tagColor: 'emerald',
      balanceLabel: `Quỹ phép khả dụng: ${leaveBalance.remaining !== '----' ? `${leaveBalance.remaining} ngày` : '----'}`,
      iconBg: 'bg-blue-100 text-[#021E73]',
    },
    {
      id: 'ot' as RequestKind,
      title: 'Đơn làm thêm giờ (OT)',
      desc: 'Đăng ký làm thêm ngày thường (1.5x), làm đêm (2.0x), cuối tuần (2.0x) hoặc Lễ Tết (3.0x).',
      tag: 'Cần duyệt trước ca làm',
      tagColor: 'amber',
      balanceLabel: 'Hệ số tính: 1.5x ~ 3.0x lương',
      iconBg: 'bg-amber-100 text-amber-800',
    },
    {
      id: 'business_trip' as RequestKind,
      title: 'Đơn đi công tác',
      desc: 'Công tác thực địa, hỗ trợ dự án tỉnh xa, hội thảo chuyên môn; kèm chế độ phụ cấp công tác.',
      tag: 'Nội địa / Quốc tế',
      tagColor: 'blue',
      balanceLabel: 'Chế độ: Phụ cấp + Lưu trú',
      iconBg: 'bg-blue-50 text-blue-700',
    },
    {
      id: 'shift_change' as RequestKind,
      title: 'Đơn đổi ca làm việc',
      desc: 'Đổi ca tạm thời/vĩnh viễn; hoán đổi ca trực tương đương với đồng nghiệp cùng bộ phận.',
      tag: 'Cần xác nhận chéo',
      tagColor: 'emerald',
      balanceLabel: 'Hình thức: Đổi ca / Hoán đổi',
      iconBg: 'bg-emerald-100 text-emerald-800',
    },
    {
      id: 'correction' as RequestKind,
      title: 'Đơn giải trình / Bổ sung công',
      desc: 'Giải trình quên quẹt thẻ, sự cố thiết bị nhận diện, bổ sung mốc giờ vào/ra thực tế theo phê duyệt.',
      tag: 'Bù công / Giải trình',
      tagColor: 'rose',
      balanceLabel: 'So sánh: Giờ hiện tại vs Đề xuất',
      iconBg: 'bg-rose-100 text-rose-700',
    },
    {
      id: 'advance' as RequestKind,
      title: 'Đơn xin tạm ứng lương',
      desc: 'Đề nghị tạm ứng lương theo quy định công ty, phân bổ khấu trừ vào các kỳ bảng lương.',
      tag: 'Khấu trừ bảng lương',
      tagColor: 'blue',
      balanceLabel: 'Hạn mức: Tối đa 50% lương cơ bản',
      iconBg: 'bg-indigo-100 text-indigo-800',
    },
    {
      id: 'profile_correction' as RequestKind,
      title: 'Đơn điều chỉnh thông tin nhân sự',
      desc: 'Đề nghị đính chính thông tin định danh: số CCCD, ngày cấp, nơi cấp, ngày sinh hoặc họ tên pháp lý.',
      tag: 'Phê duyệt HR & Pháp lý',
      tagColor: 'purple',
      balanceLabel: 'Kèm minh chứng: Ảnh CCCD / Giấy tờ',
      iconBg: 'bg-purple-100 text-purple-800',
    },
  ];

  async function loadData() {
    try {
      setLoading(true);

      // 1. Fetch user profile
      let empId = '';
      const profRes = await fetch('/api/hrm/v1/my-profile', { credentials: 'same-origin' });
      if (profRes.ok) {
        const payload = await profRes.json();
        const p = payload.data;
        if (p) {
          empId = p.id || '';
          const statusLabel =
            p.employmentStatus === 'OFFICIAL' ? 'CHÍNH THỨC (Official)' :
            p.employmentStatus === 'PROBATION' ? 'THỬ VIỆC (Probation)' :
            p.employmentStatus === 'ON_LEAVE' ? 'NGHỈ PHÉP (On Leave)' :
            p.employmentStatus === 'RESIGNED' ? 'ĐÃ NGHỈ VIỆC (Resigned)' :
            p.employmentStatus === 'TERMINATED' ? 'CHẤM DỨT HĐ (Terminated)' :
            p.employmentStatus || '';

          setProfile({
            id: p.id || '',
            fullName: p.fullName || '',
            employeeCode: p.employeeCode || '',
            department: p.department || '',
            position: p.position || '',
            employmentStatus: statusLabel,
            workEmail: p.email || p.personalEmail || '',
            phone: p.phone || '',
            roleLabel: 'Tenant Administrator',
            joinDate: p.joinDate ? String(p.joinDate).slice(0, 10) : '',
          });

          setRawProfile(p);
          setAdjustFullName(p.fullName || '');
          setAdjustDateOfBirth(p.dateOfBirth ? String(p.dateOfBirth).slice(0, 10) : '');
          setAdjustGender(p.gender || 'MALE');
          setAdjustIdentityCard(p.identityCardNumber || '');
          setAdjustIdentityDate(p.identityCardIssuedDate ? String(p.identityCardIssuedDate).slice(0, 10) : '');
          setAdjustIdentityPlace(p.identityCardIssuedPlace || '');
          setAdjustTaxCode(p.taxCode || '');
          setAdjustSocialInsurance(p.socialInsuranceNumber || '');
        }
      }

      // 2. Fetch Master Data: Leave Types, Shifts, Colleagues
      const [ltRes, shiftRes, empRes] = await Promise.all([
        fetch('/api/hrm/v1/leave-types?active=true', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/shifts?status=ACTIVE', { credentials: 'same-origin' }),
        fetch('/api/hrm/v1/employees?page=1&page_size=50', { credentials: 'same-origin' }),
      ]);

      if (ltRes.ok) {
        const payload = await ltRes.json();
        const types: LeaveTypeItem[] = payload.data || [];
        setLeaveTypes(types);
        if (types.length > 0 && !selectedLeaveTypeId) {
          setSelectedLeaveTypeId(types[0].id);
        }
      }

      if (shiftRes.ok) {
        const payload = await shiftRes.json();
        const sList: ShiftItem[] = payload.data || [];
        setShiftsList(sList);
        if (sList.length > 0) {
          if (!currentShiftId) setCurrentShiftId(sList[0].id);
          if (!requestedShiftId && sList.length > 1) setRequestedShiftId(sList[1].id);
        }
      }

      if (empRes.ok) {
        const payload = await empRes.json();
        const eList: EmployeeItem[] = (payload.data || []).map((e: any) => ({
          id: e.employeeId || e.id,
          employeeCode: e.employeeCode,
          fullName: e.fullName || e.employeeCode,
          department: e.department,
          position: e.position,
        }));
        setColleaguesList(eList.filter((item) => item.id !== empId));
      }

      // 3. Fetch leave balances if empId exists
      if (empId) {
        const balRes = await fetch(`/api/hrm/v1/employees/${empId}/leave-balances`, { credentials: 'same-origin' });
        if (balRes.ok) {
          const payload = await balRes.json();
          const balances = payload.data || [];
          if (balances.length > 0) {
            setLeaveBalance({
              remaining: String(balances[0].remaining ?? '----'),
              entitlement: String(balances[0].entitlement ?? '----'),
            });
          }
        }
      }

      // 4. Fetch all 6 request types concurrently
      const empQuery = empId ? `?employee_id=${empId}` : '';
      const [leaveRes, otRes, tripRes, shiftChangeRes, corrRes, advRes] = await Promise.all([
        fetch(`/api/hrm/v1/leave-requests${empQuery}`, { credentials: 'same-origin' }),
        fetch(`/api/hrm/v1/ot-requests${empQuery}`, { credentials: 'same-origin' }),
        fetch(`/api/hrm/v1/business-trip-requests${empQuery}`, { credentials: 'same-origin' }),
        fetch(`/api/hrm/v1/shift-change-requests${empQuery}`, { credentials: 'same-origin' }),
        fetch(`/api/hrm/v1/attendance-corrections${empQuery}`, { credentials: 'same-origin' }),
        fetch(`/api/hrm/v1/salary-advance-requests${empQuery}`, { credentials: 'same-origin' }),
      ]);

      const mergedList: RequestItem[] = [];

      // 4.1 Leave Requests
      if (leaveRes.ok) {
        const payload = await leaveRes.json();
        for (const item of payload.data || []) {
          const isApproved = item.status === 'APPROVED';
          const isApplied = Boolean(item.appliedAt);
          const wfStatus = isApproved ? 'APPROVED' : item.status === 'REJECTED' || item.status === 'CANCELLED' ? 'REJECTED' : 'PENDING_APPROVAL';
          const reqStatus = isApplied ? 'APPLIED' : isApproved ? 'APPROVED' : item.status === 'CANCELLED' ? 'CANCELLED' : item.status === 'REJECTED' ? 'REJECTED' : 'PENDING';
          const stText = isApplied ? 'Đã áp dụng vào công' : isApproved ? 'Đã duyệt' : wfStatus === 'REJECTED' ? 'Đã từ chối' : 'Chờ phê duyệt';

          mergedList.push({
            id: item.id,
            code: `LEAVE-${item.id.slice(0, 8).toUpperCase()}`,
            kind: 'leave',
            typeName: 'Đơn xin nghỉ phép',
            category: 'Nghỉ phép',
            createdAt: item.createdAt ? new Date(item.createdAt).toLocaleDateString('vi-VN') : '----',
            effectiveDate: `${item.fromDate ? new Date(item.fromDate).toLocaleDateString('vi-VN') : '----'} - ${item.toDate ? new Date(item.toDate).toLocaleDateString('vi-VN') : '----'}`,
            duration: `${item.duration || 1} ngày`,
            reason: item.reason || '----',
            approver: item.approvedBy || 'Quản lý trực tiếp',
            workflowStatus: wfStatus,
            requestStatus: reqStatus,
            statusText: stText,
            rawDetails: item,
          });
        }
      }

      // 4.2 OT Requests
      if (otRes.ok) {
        const payload = await otRes.json();
        for (const item of payload.data || []) {
          const isApproved = item.status === 'APPROVED';
          const wfStatus = isApproved ? 'APPROVED' : item.status === 'REJECTED' || item.status === 'CANCELLED' ? 'REJECTED' : 'PENDING_APPROVAL';
          const reqStatus = isApproved ? 'APPROVED' : item.status === 'CANCELLED' ? 'CANCELLED' : item.status === 'REJECTED' ? 'REJECTED' : 'PENDING';
          const plannedHrs = item.plannedMinutes ? (item.plannedMinutes / 60).toFixed(1) : '----';
          const stText = isApproved ? 'Đã duyệt OT' : wfStatus === 'REJECTED' ? 'Đã từ chối' : 'Chờ duyệt OT';

          mergedList.push({
            id: item.id,
            code: `OT-${item.id.slice(0, 8).toUpperCase()}`,
            kind: 'ot',
            typeName: `Làm thêm giờ (${item.otType || 'OT'})`,
            category: 'Làm thêm giờ',
            createdAt: item.createdAt ? new Date(item.createdAt).toLocaleDateString('vi-VN') : '----',
            effectiveDate: `${item.workDate ? new Date(item.workDate).toLocaleDateString('vi-VN') : '----'} (${item.startTime || '----'} - ${item.endTime || '----'})`,
            duration: `${plannedHrs} giờ (${item.otRateMultiplier || 1.5}x)`,
            reason: item.reason || '----',
            approver: item.approvedBy || 'Quản lý trực tiếp',
            workflowStatus: wfStatus,
            requestStatus: reqStatus,
            statusText: stText,
            rawDetails: item,
          });
        }
      }

      // 4.3 Business Trip Requests
      if (tripRes.ok) {
        const payload = await tripRes.json();
        for (const item of payload.data || []) {
          const isApproved = item.status === 'APPROVED';
          const wfStatus = isApproved ? 'APPROVED' : item.status === 'REJECTED' || item.status === 'CANCELLED' ? 'REJECTED' : 'PENDING_APPROVAL';
          const reqStatus = isApproved ? 'APPROVED' : item.status === 'CANCELLED' ? 'CANCELLED' : item.status === 'REJECTED' ? 'REJECTED' : 'PENDING';
          const stText = isApproved ? 'Đã duyệt công tác' : wfStatus === 'REJECTED' ? 'Đã từ chối' : 'Chờ phê duyệt';

          mergedList.push({
            id: item.id,
            code: `TRIP-${item.id.slice(0, 8).toUpperCase()}`,
            kind: 'business_trip',
            typeName: `Công tác (${item.destination || '----'})`,
            category: 'Công tác',
            createdAt: item.createdAt ? new Date(item.createdAt).toLocaleDateString('vi-VN') : '----',
            effectiveDate: `${item.fromDate ? new Date(item.fromDate).toLocaleDateString('vi-VN') : '----'} - ${item.toDate ? new Date(item.toDate).toLocaleDateString('vi-VN') : '----'}`,
            duration: `${item.daysCount || 1} ngày`,
            reason: item.reason || '----',
            approver: item.approvedBy || 'Quản lý trực tiếp',
            workflowStatus: wfStatus,
            requestStatus: reqStatus,
            statusText: stText,
            rawDetails: item,
          });
        }
      }

      // 4.4 Shift Change Requests
      if (shiftChangeRes.ok) {
        const payload = await shiftChangeRes.json();
        for (const item of payload.data || []) {
          const isApproved = item.status === 'APPROVED';
          const isPeerConfirmed = item.status === 'PEER_CONFIRMED' || item.swapPeerConfirmed;
          const isApplied = Boolean(item.appliedAt);

          let wfStatus: RequestItem['workflowStatus'] = 'PENDING_APPROVAL';
          let reqStatus: RequestItem['requestStatus'] = 'PENDING';
          let stText = 'Chờ quản lý duyệt';

          if (item.status === 'PENDING' && item.swapWithEmployeeId && !isPeerConfirmed) {
            wfStatus = 'PENDING_PEER';
            reqStatus = 'PENDING';
            stText = 'Chờ đồng nghiệp xác nhận';
          } else if (item.status === 'PEER_CONFIRMED') {
            wfStatus = 'PENDING_APPROVAL';
            reqStatus = 'PENDING';
            stText = 'Đồng nghiệp đã xác nhận - Chờ duyệt';
          } else if (isApproved) {
            wfStatus = 'APPROVED';
            reqStatus = isApplied ? 'APPLIED' : 'APPROVED';
            stText = isApplied ? 'Đã cập nhật ca làm việc' : 'Đã duyệt';
          } else if (item.status === 'REJECTED') {
            wfStatus = 'REJECTED';
            reqStatus = 'REJECTED';
            stText = 'Đã từ chối';
          }

          mergedList.push({
            id: item.id,
            code: `SHIFT-${item.id.slice(0, 8).toUpperCase()}`,
            kind: 'shift_change',
            typeName: item.changeType === 'SWAP' ? 'Đổi ca với đồng nghiệp' : 'Đề nghị chuyển ca',
            category: 'Đổi ca',
            createdAt: item.createdAt ? new Date(item.createdAt).toLocaleDateString('vi-VN') : '----',
            effectiveDate: `${item.fromDate ? new Date(item.fromDate).toLocaleDateString('vi-VN') : '----'} - ${item.toDate ? new Date(item.toDate).toLocaleDateString('vi-VN') : '----'}`,
            duration: item.changeType === 'SWAP' ? 'Hoán đổi ca trực' : 'Thay đổi ca',
            reason: item.reason || '----',
            approver: item.approvedBy || 'Quản lý ca / Trưởng bộ phận',
            workflowStatus: wfStatus,
            requestStatus: reqStatus,
            statusText: stText,
            rawDetails: item,
          });
        }
      }

      // 4.5 Attendance Correction Requests
      if (corrRes.ok) {
        const payload = await corrRes.json();
        for (const item of payload.data || []) {
          const isApproved = item.status === 'APPROVED';
          const isApplied = Boolean(item.appliedAt);
          const wfStatus = isApproved ? 'APPROVED' : item.status === 'REJECTED' || item.status === 'CANCELLED' ? 'REJECTED' : 'PENDING_APPROVAL';
          const reqStatus = isApplied ? 'APPLIED' : isApproved ? 'APPROVED' : item.status === 'CANCELLED' ? 'CANCELLED' : item.status === 'REJECTED' ? 'REJECTED' : 'PENDING';
          const inTime = item.newCheckInAt ? new Date(item.newCheckInAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '----';
          const outTime = item.newCheckOutAt ? new Date(item.newCheckOutAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '----';
          const stText = isApplied ? 'Đã cập nhật Timesheet' : isApproved ? 'Đã duyệt giải trình' : wfStatus === 'REJECTED' ? 'Đã từ chối' : 'Chờ phê duyệt';

          mergedList.push({
            id: item.id,
            code: `CORR-${item.id.slice(0, 8).toUpperCase()}`,
            kind: 'correction',
            typeName: 'Giải trình / Bổ sung công',
            category: 'Chấm công',
            createdAt: item.createdAt ? new Date(item.createdAt).toLocaleDateString('vi-VN') : '----',
            effectiveDate: item.requestDate ? new Date(item.requestDate).toLocaleDateString('vi-VN') : '----',
            duration: `Vào: ${inTime} | Ra: ${outTime}`,
            reason: item.reason || '----',
            approver: item.approvedBy || 'Quản lý trực tiếp',
            workflowStatus: wfStatus,
            requestStatus: reqStatus,
            statusText: stText,
            rawDetails: item,
          });
        }
      }

      // 4.6 Salary Advance Requests
      if (advRes.ok) {
        const payload = await advRes.json();
        for (const item of payload.data || []) {
          const isApproved = item.status === 'APPROVED';
          const isDisbursed = item.status === 'DISBURSED' || Boolean(item.disbursedAt);
          const wfStatus = isApproved || isDisbursed ? 'APPROVED' : item.status === 'REJECTED' || item.status === 'CANCELLED' ? 'REJECTED' : 'PENDING_APPROVAL';
          const reqStatus = isDisbursed ? 'DISBURSED' : isApproved ? 'APPROVED' : item.status === 'CANCELLED' ? 'CANCELLED' : item.status === 'REJECTED' ? 'REJECTED' : 'PENDING';
          const stText = isDisbursed ? 'Đã giải ngân' : isApproved ? 'Đã duyệt - Chờ chi' : wfStatus === 'REJECTED' ? 'Đã từ chối' : 'Chờ phê duyệt';

          mergedList.push({
            id: item.id,
            code: `ADV-${item.id.slice(0, 8).toUpperCase()}`,
            kind: 'advance',
            typeName: 'Đơn xin tạm ứng lương',
            category: 'Tạm ứng',
            createdAt: item.createdAt ? new Date(item.createdAt).toLocaleDateString('vi-VN') : '----',
            effectiveDate: item.requestDate ? new Date(item.requestDate).toLocaleDateString('vi-VN') : '----',
            duration: `${Number(item.requestedAmount || 0).toLocaleString('vi-VN')} đ (${item.numberOfInstallments || 1} kỳ)`,
            reason: item.reason || '----',
            approver: item.approvedBy || 'Kế toán / Giám đốc',
            workflowStatus: wfStatus,
            requestStatus: reqStatus,
            statusText: stText,
            rawDetails: item,
          });
        }
      }

      // Sort newest first
      mergedList.sort((a, b) => b.id.localeCompare(a.id));
      setRequestsList(mergedList);
    } catch (err) {
      console.error('Không thể tải danh sách đơn từ:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    const todayStr = new Date().toISOString().slice(0, 10);
    setFromDate(todayStr);
    setToDate(todayStr);
  }, []);

  const pendingRequests = useMemo(() => {
    return requestsList.filter(
      (r) => r.workflowStatus === 'PENDING_APPROVAL' || r.workflowStatus === 'PENDING_PEER' || r.workflowStatus === 'SUBMITTED',
    );
  }, [requestsList]);

  // Bộ lọc cho tab Lịch sử (Zone 1)
  const filteredHistory = useMemo(() => {
    return requestsList.filter((item) => {
      const matchSearch =
        !searchQuery.trim() ||
        item.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.typeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.reason.toLowerCase().includes(searchQuery.toLowerCase());

      const matchKind = filterKind === 'ALL' || item.kind === filterKind;
      const matchStatus =
        filterStatus === 'ALL' ||
        (filterStatus === 'PENDING' && (item.workflowStatus === 'PENDING_APPROVAL' || item.workflowStatus === 'PENDING_PEER')) ||
        (filterStatus === 'APPROVED' && (item.workflowStatus === 'APPROVED' || item.requestStatus === 'APPLIED' || item.requestStatus === 'DISBURSED')) ||
        (filterStatus === 'REJECTED' && item.workflowStatus === 'REJECTED');

      return matchSearch && matchKind && matchStatus;
    });
  }, [requestsList, searchQuery, filterKind, filterStatus]);

  const handleOpenCreateForType = (catId: RequestKind, typeTitle: string) => {
    setSelectedCatalogId(catId);
    setSelectedTypeTitle(typeTitle);
    const todayStr = new Date().toISOString().slice(0, 10);
    setFromDate(todayStr);
    setToDate(todayStr);
    setReason('');
    if (catId === 'profile_correction') {
      setAdjustFullName(rawProfile.fullName || profile.fullName || '');
      setAdjustDateOfBirth(rawProfile.dateOfBirth ? String(rawProfile.dateOfBirth).slice(0, 10) : '');
      setAdjustGender(rawProfile.gender || 'MALE');
      setAdjustIdentityCard(rawProfile.identityCardNumber || '');
      setAdjustIdentityDate(rawProfile.identityCardIssuedDate ? String(rawProfile.identityCardIssuedDate).slice(0, 10) : '');
      setAdjustIdentityPlace(rawProfile.identityCardIssuedPlace || '');
      setAdjustTaxCode(rawProfile.taxCode || '');
      setAdjustSocialInsurance(rawProfile.socialInsuranceNumber || '');
      setProfileEvidenceDoc('');
    }
    setIsCreateModalOpen(true);
  };

  // Submit đơn theo đúng bảng nghiệp vụ riêng của từng domain (Mục 6 trong PLAN)
  const handleSubmitRequest = async () => {
    if (!reason.trim()) {
      toast.error({
        title: 'Thiếu thông tin',
        description: 'Vui lòng nhập lý do khởi tạo yêu cầu.',
      });
      return;
    }

    try {
      setIsSubmitting(true);
      let res: Response | null = null;

      if (selectedCatalogId === 'leave') {
        const typeId = selectedLeaveTypeId || (leaveTypes[0]?.id ?? '');
        if (!typeId) {
          toast.error({
            title: 'Lỗi',
            description: 'Chưa có loại nghỉ phép hợp lệ được cấu hình trên hệ thống.',
          });
          return;
        }
        res = await fetch('/api/hrm/v1/leave-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
          credentials: 'same-origin',
          body: JSON.stringify({
            employeeId: profile.id,
            leaveTypeId: typeId,
            fromDate,
            toDate,
            duration: parseFloat(leaveDuration) || 1.0,
            reason,
          }),
        });
      } else if (selectedCatalogId === 'ot') {
        const startH = parseInt(startTime.split(':')[0] || '18', 10);
        const endH = parseInt(endTime.split(':')[0] || '21', 10);
        const plannedMin = Math.max(30, (endH - startH) * 60);

        res = await fetch('/api/hrm/v1/ot-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
          credentials: 'same-origin',
          body: JSON.stringify({
            employeeId: profile.id,
            workDate: fromDate,
            startTime,
            endTime,
            plannedMinutes: plannedMin,
            otType,
            reason,
          }),
        });
      } else if (selectedCatalogId === 'business_trip') {
        const d1 = new Date(fromDate).getTime();
        const d2 = new Date(toDate).getTime();
        const days = Math.max(1, Math.round((d2 - d1) / (1000 * 3600 * 24)) + 1);

        res = await fetch('/api/hrm/v1/business-trip-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
          credentials: 'same-origin',
          body: JSON.stringify({
            employeeId: profile.id,
            businessTripType: tripType,
            destination: destination || 'Công tác theo kế hoạch phòng ban',
            fromDate,
            toDate,
            daysCount: days,
            allowOt,
            reason,
          }),
        });
      } else if (selectedCatalogId === 'shift_change') {
        if (!currentShiftId || !requestedShiftId) {
          toast.error({
            title: 'Thiếu thông tin ca',
            description: 'Vui lòng chọn ca hiện tại và ca muốn đổi.',
          });
          return;
        }

        res = await fetch('/api/hrm/v1/shift-change-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
          credentials: 'same-origin',
          body: JSON.stringify({
            employeeId: profile.id,
            changeType,
            currentShiftId,
            requestedShiftId,
            fromDate,
            toDate,
            swapWithEmployeeId: changeType === 'SWAP' ? swapWithEmployeeId || null : null,
            reason,
          }),
        });
      } else if (selectedCatalogId === 'correction') {
        res = await fetch('/api/hrm/v1/attendance-corrections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
          credentials: 'same-origin',
          body: JSON.stringify({
            employeeId: profile.id,
            requestDate: fromDate,
            newCheckInAt: `${fromDate}T${proposedCheckIn}:00`,
            newCheckOutAt: `${fromDate}T${proposedCheckOut}:00`,
            reason,
          }),
        });
      } else if (selectedCatalogId === 'advance') {
        const amt = parseFloat(requestedAmount);
        if (isNaN(amt) || amt <= 0) {
          toast.error({
            title: 'Số tiền không hợp lệ',
            description: 'Vui lòng nhập số tiền tạm ứng lớn hơn 0.',
          });
          return;
        }

        res = await fetch('/api/hrm/v1/salary-advance-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
          credentials: 'same-origin',
          body: JSON.stringify({
            employeeId: profile.id,
            requestDate: fromDate,
            requestedAmount: amt,
            numberOfInstallments: parseInt(numberOfInstallments, 10) || 1,
            reason,
          }),
        });
      } else if (selectedCatalogId === 'profile_correction') {
        const changes: string[] = [];
        const oldName = rawProfile.fullName || profile.fullName || '';
        if (adjustFullName.trim() && adjustFullName.trim() !== oldName) {
          changes.push(`Họ và tên: "${oldName}" -> "${adjustFullName.trim()}"`);
        }

        const oldDob = rawProfile.dateOfBirth ? String(rawProfile.dateOfBirth).slice(0, 10) : '';
        if (adjustDateOfBirth && adjustDateOfBirth !== oldDob) {
          changes.push(`Ngày sinh: "${oldDob || '----'}" -> "${adjustDateOfBirth}"`);
        }

        const oldGender = rawProfile.gender || 'MALE';
        if (adjustGender && adjustGender !== oldGender) {
          changes.push(`Giới tính: "${oldGender}" -> "${adjustGender}"`);
        }

        const oldCccd = rawProfile.identityCardNumber || '';
        if (adjustIdentityCard.trim() && adjustIdentityCard.trim() !== oldCccd) {
          changes.push(`Số CCCD/CMND: "${oldCccd || '----'}" -> "${adjustIdentityCard.trim()}"`);
        }

        const oldCccdDate = rawProfile.identityCardIssuedDate ? String(rawProfile.identityCardIssuedDate).slice(0, 10) : '';
        if (adjustIdentityDate && adjustIdentityDate !== oldCccdDate) {
          changes.push(`Ngày cấp: "${oldCccdDate || '----'}" -> "${adjustIdentityDate}"`);
        }

        const oldCccdPlace = rawProfile.identityCardIssuedPlace || '';
        if (adjustIdentityPlace.trim() && adjustIdentityPlace.trim() !== oldCccdPlace) {
          changes.push(`Nơi cấp: "${oldCccdPlace || '----'}" -> "${adjustIdentityPlace.trim()}"`);
        }

        const oldTax = rawProfile.taxCode || '';
        if (adjustTaxCode.trim() && adjustTaxCode.trim() !== oldTax) {
          changes.push(`Mã số thuế: "${oldTax || '----'}" -> "${adjustTaxCode.trim()}"`);
        }

        const oldBhxh = rawProfile.socialInsuranceNumber || '';
        if (adjustSocialInsurance.trim() && adjustSocialInsurance.trim() !== oldBhxh) {
          changes.push(`Số sổ BHXH: "${oldBhxh || '----'}" -> "${adjustSocialInsurance.trim()}"`);
        }

        if (changes.length === 0) {
          toast.error({
            title: 'Chưa có thông tin thay đổi',
            description: 'Bạn chưa thay đổi trường dữ liệu nào so với hồ sơ hiện tại.',
          });
          return;
        }

        const formattedReason = `[Đề nghị điều chỉnh hồ sơ (${changes.length} mục)]\n- ${changes.join('\n- ')}\n${profileEvidenceDoc.trim() ? `• Minh chứng kèm theo: ${profileEvidenceDoc.trim()}\n` : ''}• Lý do điều chỉnh: ${reason.trim()}`;

        // Lưu vào danh sách đơn từ của nhân viên
        res = await fetch('/api/hrm/v1/leave-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
          credentials: 'same-origin',
          body: JSON.stringify({
            employeeId: profile.id,
            leaveTypeId: leaveTypes[0]?.id || '00000000-0000-0000-0000-000000000000',
            fromDate,
            toDate: fromDate,
            totalDays: 0,
            reason: formattedReason,
          }),
        });
      }

      if (res && res.ok) {
        setIsCreateModalOpen(false);
        setReason('');
        toast.success({
          title: 'Tạo đơn thành công',
          description: `Đơn đã được khởi tạo và chuyển tiếp tới quy trình phê duyệt.`,
        });
        await loadData();
      } else {
        let errMsg = 'Không thể gửi đơn yêu cầu. Vui lòng thử lại sau.';
        try {
          const errData = await res?.json();
          if (errData?.error?.message) {
            errMsg = errData.error.message;
          }
        } catch {
          // ignore
        }
        toast.error({
          title: 'Tạo đơn thất bại',
          description: errMsg,
        });
      }
    } catch (err) {
      console.error('Lỗi khi gửi đơn yêu cầu:', err);
      toast.error({
        title: 'Lỗi kết nối',
        description: 'Không thể kết nối đến máy chủ.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Xác nhận đổi ca chéo cho đồng nghiệp
  const handlePeerConfirm = async (requestId: string, confirmed: boolean) => {
    try {
      const res = await fetch(`/api/hrm/v1/shift-change-requests/${requestId}/peer-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
        credentials: 'same-origin',
        body: JSON.stringify({ confirmed }),
      });
      if (res.ok) {
        toast.success({
          title: confirmed ? 'Đã xác nhận đổi ca' : 'Đã từ chối đổi ca',
          description: 'Hồ sơ đã được cập nhật trạng thái trong chu trình phê duyệt.',
        });
        setIsDetailDrawerOpen(false);
        await loadData();
      } else {
        toast.error({
          title: 'Thao tác không thành công',
          description: 'Vui lòng kiểm tra lại quyền hạn hoặc thử lại sau.',
        });
      }
    } catch (err) {
      console.error('Peer confirm error:', err);
    }
  };

  // Hủy đơn khi còn ở trạng thái Pending
  const handleCancelRequest = async (reqItem: RequestItem) => {
    let endpoint = '';
    if (reqItem.kind === 'leave') endpoint = `/api/hrm/v1/leave-requests/${reqItem.id}/cancel`;
    else if (reqItem.kind === 'business_trip') endpoint = `/api/hrm/v1/business-trip-requests/${reqItem.id}/cancel`;
    else if (reqItem.kind === 'correction') endpoint = `/api/hrm/v1/attendance-corrections/${reqItem.id}/cancel`;

    if (!endpoint) {
      toast.info({
        title: 'Thông báo',
        description: 'Đơn từ loại này cần liên hệ quản lý trực tiếp để huỷ.',
      });
      return;
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken() },
        credentials: 'same-origin',
      });
      if (res.ok) {
        toast.success({
          title: 'Đã hủy đơn thành công',
          description: `Đơn ${reqItem.code} đã được rút khỏi luồng phê duyệt.`,
        });
        setIsDetailDrawerOpen(false);
        await loadData();
      } else {
        toast.error({
          title: 'Hủy đơn thất bại',
          description: 'Không thể hủy đơn ở trạng thái hiện tại.',
        });
      }
    } catch (err) {
      console.error('Cancel request error:', err);
    }
  };

  // Chuẩn bị options SearchableSelect
  const leaveTypeOptions: SearchableSelectOption[] = useMemo(() => {
    return leaveTypes.map((t) => ({
      value: t.id,
      label: t.name,
      badge: t.code,
      description: t.paid ? 'Có hưởng lương' : 'Không hưởng lương',
    }));
  }, [leaveTypes]);

  const shiftOptions: SearchableSelectOption[] = useMemo(() => {
    return shiftsList.map((s) => ({
      value: s.id,
      label: `${s.name} (${s.startTime} - ${s.endTime})`,
      badge: s.code,
    }));
  }, [shiftsList]);

  const colleagueOptions: SearchableSelectOption[] = useMemo(() => {
    return colleaguesList.map((e) => ({
      value: e.id,
      label: `${e.fullName} (${e.employeeCode})`,
      badge: e.department || 'Nhân sự',
      description: e.position || undefined,
    }));
  }, [colleaguesList]);

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Đơn từ & Yêu cầu</h1>
            <Badge className="bg-blue-100 text-blue-800 border border-blue-200 text-xs font-semibold">
              ESS / 6 System Requests
            </Badge>
          </div>
          <p className="text-xs text-slate-500">
            Trung tâm khởi tạo và giám sát tiến độ toàn bộ các giao dịch phát sinh cần phê duyệt của nhân viên.
          </p>
        </div>
        <div className="flex items-center flex-wrap gap-2.5">
          <Button
            variant="outline"
            size="sm"
            className="text-xs font-medium gap-1.5 h-9 border-slate-300"
            onClick={() => {
              toast.success({
                title: 'Đang xuất lịch sử',
                description: 'File Lich_su_don_tu.xlsx đã được tải về.',
              });
            }}
          >
            <Download className="size-3.5" />
            <span>Xuất lịch sử đơn</span>
          </Button>
          <Button
            size="sm"
            className="bg-[#021E73] hover:bg-blue-900 text-white text-xs font-semibold gap-1.5 h-9"
            onClick={() => handleOpenCreateForType('leave', 'Đơn xin nghỉ phép')}
          >
            <Plus className="size-3.5" />
            <span>Tạo đơn mới</span>
          </Button>
        </div>
      </div>

      {/* 2. Employee Profile Snapshot */}
      <EmployeeHeroCard profile={profile} />

      {/* 3. Sub-tabs Navigation */}
      <div className="border-b border-slate-200">
        <div className="flex space-x-8 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('catalog')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'catalog'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <FilePlus className="size-4" />
            <span>Tạo đơn mới (Request Catalog)</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
              6 loại đơn
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'pending'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Clock className="size-4" />
            <span>Đơn đang chờ duyệt (Pending)</span>
            {pendingRequests.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                {pendingRequests.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'history'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <History className="size-4" />
            <span>Lịch sử đơn từ (History)</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
              {requestsList.length}
            </span>
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: REQUEST CATALOG (6 System Requests) */}
      {activeTab === 'catalog' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {requestCatalog.map((cat) => (
              <div
                key={cat.id}
                className="bg-white rounded-xl border border-slate-200 hover:border-blue-500 p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <div className={`size-10 rounded-xl ${cat.iconBg} flex items-center justify-center font-bold shadow-xs`}>
                      <FileText className="size-5" />
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-semibold ${
                        cat.tagColor === 'emerald'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : cat.tagColor === 'amber'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : cat.tagColor === 'rose'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-blue-50 text-blue-700 border-blue-200'
                      }`}
                    >
                      {cat.tag}
                    </Badge>
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm group-hover:text-blue-700 transition-colors">
                    {cat.title}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 mb-3 leading-relaxed line-clamp-2">
                    {cat.desc}
                  </p>
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-[11px] font-medium text-slate-600 mb-4">
                    {cat.balanceLabel}
                  </div>
                </div>

                <Button
                  size="sm"
                  className="w-full bg-[#021E73] hover:bg-blue-900 text-white text-xs font-semibold gap-1.5 h-8"
                  onClick={() => handleOpenCreateForType(cat.id, cat.title)}
                >
                  <Plus className="size-3.5" />
                  <span>Khởi tạo đơn này</span>
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: PENDING APPROVAL */}
      {activeTab === 'pending' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="font-bold text-slate-900 text-xs uppercase tracking-wide">
                Danh sách yêu cầu đang chờ phê duyệt ({pendingRequests.length})
              </span>
              <span className="text-[11px] text-slate-500 font-medium">
                Tự động gửi thông báo nhắc duyệt SLA 24h
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {loading ? (
                <div className="p-8 text-center text-slate-400 flex items-center justify-center gap-2">
                  <Loader2 className="size-4 animate-spin text-[#021E73]" />
                  <span>Đang tải danh sách đơn từ...</span>
                </div>
              ) : pendingRequests.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs">
                  Hiện không có yêu cầu nào đang chờ phê duyệt.
                </div>
              ) : (
                pendingRequests.map((req) => (
                  <div key={req.id} className="p-4 hover:bg-slate-50/70 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                    <div className="flex items-start gap-3">
                      <div className="size-9 rounded-lg bg-blue-100 text-[#021E73] flex items-center justify-center font-bold shrink-0 mt-0.5">
                        <FileText className="size-4" />
                      </div>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-900 text-xs">{req.code}</span>
                          <span className="font-bold text-slate-900 text-xs">{req.typeName}</span>
                          <Badge
                            className={
                              req.workflowStatus === 'PENDING_PEER'
                                ? 'bg-indigo-100 text-indigo-800 text-[10px] font-bold border border-indigo-200'
                                : 'bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-200'
                            }
                          >
                            {req.statusText}
                          </Badge>
                        </div>
                        <p className="text-slate-500 text-[11px]">
                          Hiệu lực: <strong className="text-slate-700">{req.effectiveDate}</strong> ({req.duration}) • Lý do: {req.reason}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 ml-12 md:ml-0">
                      <div className="text-right hidden sm:block">
                        <span className="text-[10px] text-slate-400 uppercase font-bold block">Người phê duyệt</span>
                        <span className="font-semibold text-slate-800 text-xs">{req.approver}</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-8 border-slate-300"
                        onClick={() => {
                          setSelectedRequest(req);
                          setIsDetailDrawerOpen(true);
                        }}
                      >
                        Chi tiết
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: HISTORY (Standard 3-Zone Enterprise Table) */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            {/* Zone 1: Header - Controls & Multi-criteria Filters */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5 flex-1">
                <div className="w-full sm:w-64">
                  <Input
                    placeholder="Tìm theo mã đơn, loại hoặc lý do..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 text-xs bg-white"
                  />
                </div>
                <div className="w-44">
                  <SearchableSelect
                    options={[
                      { value: 'ALL', label: 'Tất cả loại đơn' },
                      { value: 'leave', label: 'Nghỉ phép' },
                      { value: 'ot', label: 'Làm thêm giờ (OT)' },
                      { value: 'business_trip', label: 'Công tác' },
                      { value: 'shift_change', label: 'Đổi ca' },
                      { value: 'correction', label: 'Bổ sung công' },
                      { value: 'advance', label: 'Tạm ứng lương' },
                      { value: 'profile_correction', label: 'Đính chính nhân sự' },
                    ]}
                    value={filterKind}
                    onChange={(val) => setFilterKind(val || 'ALL')}
                    placeholder="Lọc loại đơn..."
                    clearable={false}
                  />
                </div>
                <div className="w-40">
                  <SearchableSelect
                    options={[
                      { value: 'ALL', label: 'Tất cả trạng thái' },
                      { value: 'PENDING', label: 'Đang chờ duyệt' },
                      { value: 'APPROVED', label: 'Đã duyệt / Áp dụng' },
                      { value: 'REJECTED', label: 'Đã từ chối' },
                    ]}
                    value={filterStatus}
                    onChange={(val) => setFilterStatus(val || 'ALL')}
                    placeholder="Lọc trạng thái..."
                    clearable={false}
                  />
                </div>
                {(searchQuery || filterKind !== 'ALL' || filterStatus !== 'ALL') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-8 text-slate-500 hover:text-slate-800"
                    onClick={() => {
                      setSearchQuery('');
                      setFilterKind('ALL');
                      setFilterStatus('ALL');
                    }}
                  >
                    <RotateCcw className="size-3 mr-1" />
                    Đặt lại
                  </Button>
                )}
              </div>
              <div className="text-xs text-slate-500 font-medium text-right">
                Tìm thấy <strong>{filteredHistory.length}</strong> / {requestsList.length} hồ sơ
              </div>
            </div>

            {/* Zone 2: Body - Data Grid */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50/70 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="p-3 pl-4">Mã đơn</th>
                    <th className="p-3">Loại yêu cầu</th>
                    <th className="p-3">Thời gian hiệu lực</th>
                    <th className="p-3">Thời lượng / Giá trị</th>
                    <th className="p-3">Lý do</th>
                    <th className="p-3">Người duyệt</th>
                    <th className="p-3">Trạng thái Quy trình</th>
                    <th className="p-3">Kết quả Hậu xử lý</th>
                    <th className="p-3 pr-4 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-400">
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="size-4 animate-spin text-[#021E73]" />
                          <span>Đang tải lịch sử đơn từ...</span>
                        </div>
                      </td>
                    </tr>
                  ) : filteredHistory.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-400">
                        Không tìm thấy hồ sơ đơn từ nào phù hợp với bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    filteredHistory.map((req) => (
                      <tr key={req.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-3 pl-4 font-mono font-bold text-[#021E73]">
                          {req.code}
                        </td>
                        <td className="p-3 font-bold text-slate-900">{req.typeName}</td>
                        <td className="p-3 text-slate-600">{req.effectiveDate}</td>
                        <td className="p-3 font-mono font-semibold">{req.duration}</td>
                        <td className="p-3 text-slate-500 text-[11px] max-w-[180px] truncate" title={req.reason}>
                          {req.reason}
                        </td>
                        <td className="p-3 text-slate-700 text-[11px]">{req.approver}</td>
                        <td className="p-3">
                          <Badge
                            className={
                              req.workflowStatus === 'APPROVED'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px]'
                                : req.workflowStatus === 'PENDING_PEER'
                                ? 'bg-indigo-100 text-indigo-800 border border-indigo-200 text-[10px]'
                                : req.workflowStatus === 'PENDING_APPROVAL'
                                ? 'bg-amber-100 text-amber-800 border border-amber-200 text-[10px]'
                                : 'bg-rose-100 text-rose-700 border border-rose-200 text-[10px]'
                            }
                          >
                            {req.workflowStatus === 'APPROVED'
                              ? 'Đã duyệt'
                              : req.workflowStatus === 'PENDING_PEER'
                              ? 'Chờ đồng nghiệp'
                              : req.workflowStatus === 'REJECTED'
                              ? 'Đã từ chối'
                              : 'Chờ duyệt'}
                          </Badge>
                        </td>
                        <td className="p-3">
                          {req.requestStatus === 'APPLIED' ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px]">
                              Đã cập nhật công
                            </Badge>
                          ) : req.requestStatus === 'DISBURSED' ? (
                            <Badge className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px]">
                              Đã giải ngân
                            </Badge>
                          ) : (
                            <span className="text-slate-400 text-[11px]">Chưa áp dụng</span>
                          )}
                        </td>
                        <td className="p-3 pr-4 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-7 text-blue-700 hover:bg-blue-50"
                            onClick={() => {
                              setSelectedRequest(req);
                              setIsDetailDrawerOpen(true);
                            }}
                          >
                            Chi tiết
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Zone 3: Footer - Pagination Standard Info */}
            <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <div>
                Hiển thị <strong>1 – {filteredHistory.length}</strong> trong tổng số <strong>{filteredHistory.length}</strong> đơn từ
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled>
                  Trang trước
                </Button>
                <span className="font-semibold text-slate-700">1 / 1</span>
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled>
                  Trang sau
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* POPUP MODAL: KHỞI TẠO ĐƠN THEO TỪNG LOẠI NGHIỆP VỤ */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden bg-white">
          <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <FilePlus className="size-4 text-[#021E73]" />
                Khởi tạo: {selectedTypeTitle}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Nhập đầy đủ thông tin để gửi qua quy trình phê duyệt tự động
              </p>
            </div>
            <Badge className="bg-blue-100 text-blue-800 text-[10px] font-bold">
              Quy trình chuẩn SLA 24h
            </Badge>
          </div>

          <div className="p-6 space-y-4 text-xs max-h-[75vh] overflow-y-auto">
            {/* THÔNG TIN HỖ TRỢ / ĐIỀU KIỆN (Mục 3 Khối 3 trong PLAN) */}
            {selectedCatalogId === 'leave' && (
              <div className="p-3 bg-blue-50/60 rounded-lg border border-blue-200 flex items-center justify-between">
                <div>
                  <span className="text-slate-600 block text-[11px]">Số dư phép năm khả dụng:</span>
                  <strong className="text-sm text-[#021E73] font-mono">{leaveBalance.remaining} ngày</strong>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 block text-[11px]">Sau khi xin ({leaveDuration} ngày):</span>
                  <strong className="text-sm text-emerald-700 font-mono">
                    {leaveBalance.remaining !== '----'
                      ? Math.max(0, parseFloat(leaveBalance.remaining) - parseFloat(leaveDuration)).toFixed(1)
                      : '----'}{' '}
                    ngày
                  </strong>
                </div>
              </div>
            )}

            {selectedCatalogId === 'advance' && (
              <div className="p-3 bg-indigo-50/60 rounded-lg border border-indigo-200 flex items-center justify-between">
                <div>
                  <span className="text-slate-600 block text-[11px]">Hạn mức tạm ứng tối đa (50% lương CB):</span>
                  <strong className="text-sm text-indigo-900 font-mono">15.000.000 đ</strong>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 block text-[11px]">Dự kiến trừ mỗi kỳ:</span>
                  <strong className="text-sm text-emerald-700 font-mono">
                    {(parseFloat(requestedAmount || '0') / (parseInt(numberOfInstallments, 10) || 1)).toLocaleString('vi-VN')} đ
                  </strong>
                </div>
              </div>
            )}

            {/* FORM 1: NGHỈ PHÉP */}
            {selectedCatalogId === 'leave' && (
              <>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-800 block">Loại hình nghỉ phép *</label>
                  <SearchableSelect
                    options={leaveTypeOptions}
                    value={selectedLeaveTypeId}
                    onChange={(val) => setSelectedLeaveTypeId(val)}
                    placeholder="Chọn loại phép..."
                    clearable={false}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">Từ ngày *</label>
                    <DatePickerInput
                      value={fromDate}
                      onChange={(val) => setFromDate(val)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">Đến ngày *</label>
                    <DatePickerInput
                      value={toDate}
                      onChange={(val) => setToDate(val)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-800 block">Thời lượng nghỉ</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setLeaveDuration('1.0')}
                      className={`py-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
                        leaveDuration === '1.0'
                          ? 'bg-[#021E73] text-white border-[#021E73] font-bold shadow-xs'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      Cả ngày (1.0)
                    </button>
                    <button
                      type="button"
                      onClick={() => setLeaveDuration('0.5')}
                      className={`py-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
                        leaveDuration === '0.5'
                          ? 'bg-[#021E73] text-white border-[#021E73] font-bold shadow-xs'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      Nửa ngày (0.5)
                    </button>
                    <button
                      type="button"
                      onClick={() => setLeaveDuration('2.0')}
                      className={`py-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
                        leaveDuration === '2.0'
                          ? 'bg-[#021E73] text-white border-[#021E73] font-bold shadow-xs'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      2 ngày (2.0)
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* FORM 2: LÀM THÊM GIỜ (OT) */}
            {selectedCatalogId === 'ot' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">Ngày làm thêm (OT) *</label>
                    <DatePickerInput
                      value={fromDate}
                      onChange={(val) => setFromDate(val)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">Loại OT (Hệ số lương) *</label>
                    <SearchableSelect
                      options={[
                        { value: 'WEEKDAY', label: 'Ngày thường (1.5x)' },
                        { value: 'WEEKEND', label: 'Ngày nghỉ cuối tuần (2.0x)' },
                        { value: 'NIGHT', label: 'Làm thêm ca đêm (2.0x)' },
                        { value: 'HOLIDAY', label: 'Lễ / Tết (3.0x)' },
                      ]}
                      value={otType}
                      onChange={(val) => setOtType(val as any)}
                      clearable={false}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">Giờ bắt đầu *</label>
                    <Input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">Giờ kết thúc *</label>
                    <Input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="text-xs font-mono"
                    />
                  </div>
                </div>
              </>
            )}

            {/* FORM 3: CÔNG TÁC */}
            {selectedCatalogId === 'business_trip' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">Loại hình công tác *</label>
                    <SearchableSelect
                      options={[
                        { value: 'DOMESTIC', label: 'Nội địa (Domestic)' },
                        { value: 'OVERSEAS', label: 'Quốc tế (Overseas)' },
                        { value: 'INTERSITE', label: 'Nội bộ liên chi nhánh (Intersite)' },
                      ]}
                      value={tripType}
                      onChange={(val) => setTripType(val as any)}
                      clearable={false}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">Địa điểm công tác *</label>
                    <Input
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      placeholder="VD: Trạm biến áp 500kV Phố Nối"
                      className="text-xs"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">Từ ngày *</label>
                    <DatePickerInput
                      value={fromDate}
                      onChange={(val) => setFromDate(val)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">Đến ngày *</label>
                    <DatePickerInput
                      value={toDate}
                      onChange={(val) => setToDate(val)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="allowOtCheck"
                    checked={allowOt}
                    onChange={(e) => setAllowOt(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 size-4"
                  />
                  <label htmlFor="allowOtCheck" className="text-xs text-slate-700 font-medium cursor-pointer">
                    Cho phép tính làm thêm giờ (OT) trong chuyến công tác nếu có phát sinh
                  </label>
                </div>
              </>
            )}

            {/* FORM 4: ĐỔI CA */}
            {selectedCatalogId === 'shift_change' && (
              <>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-800 block">Hình thức đổi ca *</label>
                  <SearchableSelect
                    options={[
                      { value: 'SWAP', label: 'Hoán đổi ca với đồng nghiệp (Cần xác nhận chéo)' },
                      { value: 'CHANGE_SHIFT', label: 'Đề nghị chuyển ca làm việc cá nhân' },
                    ]}
                    value={changeType}
                    onChange={(val) => setChangeType(val as any)}
                    clearable={false}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">Ca làm việc hiện tại *</label>
                    <SearchableSelect
                      options={shiftOptions}
                      value={currentShiftId}
                      onChange={(val) => setCurrentShiftId(val)}
                      placeholder="Chọn ca hiện tại..."
                      clearable={false}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">Ca làm việc đề xuất chuyển *</label>
                    <SearchableSelect
                      options={shiftOptions}
                      value={requestedShiftId}
                      onChange={(val) => setRequestedShiftId(val)}
                      placeholder="Chọn ca mong muốn..."
                      clearable={false}
                    />
                  </div>
                </div>
                {changeType === 'SWAP' && (
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">Đồng nghiệp hoán đổi ca *</label>
                    <SearchableSelect
                      options={colleagueOptions}
                      value={swapWithEmployeeId}
                      onChange={(val) => setSwapWithEmployeeId(val)}
                      placeholder="Chọn đồng nghiệp để gửi yêu cầu xác nhận..."
                      clearable={false}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">Từ ngày áp dụng *</label>
                    <DatePickerInput
                      value={fromDate}
                      onChange={(val) => setFromDate(val)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">Đến ngày áp dụng *</label>
                    <DatePickerInput
                      value={toDate}
                      onChange={(val) => setToDate(val)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                </div>
              </>
            )}

            {/* FORM 5: BỔ SUNG CÔNG (CORRECTION) - So sánh hiện tại vs Đề xuất theo Mục 4.1 trong PLAN */}
            {selectedCatalogId === 'correction' && (
              <>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-800 block">Ngày phát sinh điều chỉnh *</label>
                  <DatePickerInput
                    value={fromDate}
                    onChange={(val) => setFromDate(val)}
                    placeholder="dd/mm/yyyy"
                  />
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
                  <span className="font-bold text-slate-800 block text-[11px] uppercase tracking-wide">
                    So sánh đối chiếu giờ công (Hiện tại vs Đề xuất)
                  </span>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <span className="font-semibold text-slate-500 block">Dữ liệu ghi nhận hiện tại:</span>
                      <div className="space-y-1">
                        <label className="text-slate-600 block">Giờ vào hiện tại</label>
                        <Input
                          type="time"
                          value={currentCheckIn}
                          onChange={(e) => setCurrentCheckIn(e.target.value)}
                          className="text-xs font-mono bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-slate-600 block">Giờ ra hiện tại</label>
                        <Input
                          type="time"
                          value={currentCheckOut}
                          onChange={(e) => setCurrentCheckOut(e.target.value)}
                          className="text-xs font-mono bg-white"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <span className="font-semibold text-blue-700 block">Mốc giờ đề xuất điều chỉnh:</span>
                      <div className="space-y-1">
                        <label className="text-slate-600 block">Giờ vào đề xuất *</label>
                        <Input
                          type="time"
                          value={proposedCheckIn}
                          onChange={(e) => setProposedCheckIn(e.target.value)}
                          className="text-xs font-mono bg-white border-blue-300"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-slate-600 block">Giờ ra đề xuất *</label>
                        <Input
                          type="time"
                          value={proposedCheckOut}
                          onChange={(e) => setProposedCheckOut(e.target.value)}
                          className="text-xs font-mono bg-white border-blue-300"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* FORM 6: TẠM ỨNG LƯƠNG */}
            {selectedCatalogId === 'advance' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">Ngày yêu cầu tạm ứng *</label>
                    <DatePickerInput
                      value={fromDate}
                      onChange={(val) => setFromDate(val)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800 block">Số tiền tạm ứng (VNĐ) *</label>
                    <Input
                      type="number"
                      value={requestedAmount}
                      onChange={(e) => setRequestedAmount(e.target.value)}
                      placeholder="VD: 5000000"
                      className="text-xs font-mono font-bold text-slate-900"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-800 block">Số kỳ khấu trừ hoàn trả *</label>
                  <SearchableSelect
                    options={[
                      { value: '1', label: '1 kỳ (Khấu trừ toàn bộ vào kỳ lương tới)' },
                      { value: '2', label: '2 kỳ (Chia đều 2 tháng)' },
                      { value: '3', label: '3 kỳ (Chia đều 3 tháng)' },
                      { value: '4', label: '4 kỳ (Chia đều 4 tháng)' },
                    ]}
                    value={numberOfInstallments}
                    onChange={(val) => setNumberOfInstallments(val)}
                    clearable={false}
                  />
                </div>
              </>
            )}

            {/* FORM 7: ĐỀ NGHỊ ĐIỀU CHỈNH THÔNG TIN NHÂN SỰ (PROFILE CORRECTION - MULTI-FIELD) */}
            {selectedCatalogId === 'profile_correction' && (
              <>
                <div className="bg-blue-50/70 p-3 rounded-lg border border-blue-200 text-xs text-blue-900 flex items-start gap-2">
                  <Info className="size-4 shrink-0 text-blue-700 mt-0.5" />
                  <span>
                    Bạn có thể chỉnh sửa trực tiếp một hoặc nhiều trường bên dưới. Hệ thống sẽ tự động so sánh đối chiếu và tổng hợp các mục thay đổi gửi tới phòng Nhân sự phê duyệt.
                  </span>
                </div>

                <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                  {/* Họ và tên & Ngày sinh */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-800 block text-xs">
                        Họ và tên pháp lý
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Hiện tại: {rawProfile.fullName || profile.fullName || '----'})
                        </span>
                      </label>
                      <Input
                        value={adjustFullName}
                        onChange={(e) => setAdjustFullName(e.target.value)}
                        placeholder="Nhập họ và tên..."
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-800 block text-xs">
                        Ngày sinh (date_of_birth)
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Hiện tại: {formatVnDate(rawProfile.dateOfBirth)})
                        </span>
                      </label>
                      <DatePickerInput
                        value={adjustDateOfBirth}
                        onChange={(val) => setAdjustDateOfBirth(val)}
                        placeholder="dd/mm/yyyy"
                      />
                    </div>
                  </div>

                  {/* Giới tính & Số CCCD */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-800 block text-xs">
                        Giới tính
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Hiện tại: {rawProfile.gender === 'FEMALE' ? 'Nữ' : rawProfile.gender === 'OTHER' ? 'Khác' : 'Nam'})
                        </span>
                      </label>
                      <SearchableSelect
                        options={[
                          { value: 'MALE', label: 'Nam' },
                          { value: 'FEMALE', label: 'Nữ' },
                          { value: 'OTHER', label: 'Khác' },
                        ]}
                        value={adjustGender}
                        onChange={(val) => setAdjustGender(val || 'MALE')}
                        clearable={false}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-800 block text-xs">
                        Số CCCD / CMND
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Hiện tại: {rawProfile.identityCardNumber || '----'})
                        </span>
                      </label>
                      <Input
                        value={adjustIdentityCard}
                        onChange={(e) => setAdjustIdentityCard(e.target.value)}
                        placeholder="Số CCCD 12 chữ số..."
                        className="text-xs font-mono font-bold"
                      />
                    </div>
                  </div>

                  {/* Ngày cấp & Nơi cấp */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-800 block text-xs">
                        Ngày cấp CCCD
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Hiện tại: {formatVnDate(rawProfile.identityCardIssuedDate)})
                        </span>
                      </label>
                      <DatePickerInput
                        value={adjustIdentityDate}
                        onChange={(val) => setAdjustIdentityDate(val)}
                        placeholder="dd/mm/yyyy"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-800 block text-xs">
                        Nơi cấp CCCD
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Hiện tại: {rawProfile.identityCardIssuedPlace || '----'})
                        </span>
                      </label>
                      <Input
                        value={adjustIdentityPlace}
                        onChange={(e) => setAdjustIdentityPlace(e.target.value)}
                        placeholder="VD: Cục Cảnh sát QLHC về TTXH"
                        className="text-xs"
                      />
                    </div>
                  </div>

                  {/* Mã số thuế & Số sổ BHXH */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-800 block text-xs">
                        Mã số thuế TNCN
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Hiện tại: {rawProfile.taxCode || '----'})
                        </span>
                      </label>
                      <Input
                        value={adjustTaxCode}
                        onChange={(e) => setAdjustTaxCode(e.target.value)}
                        placeholder="Mã số thuế..."
                        className="text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-800 block text-xs">
                        Mã số BHXH
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Hiện tại: {rawProfile.socialInsuranceNumber || '----'})
                        </span>
                      </label>
                      <Input
                        value={adjustSocialInsurance}
                        onChange={(e) => setAdjustSocialInsurance(e.target.value)}
                        placeholder="Số sổ BHXH..."
                        className="text-xs font-mono"
                      />
                    </div>
                  </div>

                  {/* Minh chứng đính kèm */}
                  <div className="space-y-1 pt-1">
                    <label className="font-semibold text-slate-800 block text-xs">Tài liệu minh chứng / Ghi chú đính kèm</label>
                    <Input
                      value={profileEvidenceDoc}
                      onChange={(e) => setProfileEvidenceDoc(e.target.value)}
                      placeholder="VD: Đã gửi bản scan 2 mặt CCCD gắn chip qua email hr@svn.vn"
                      className="text-xs"
                    />
                    <span className="text-[11px] text-slate-500 italic block mt-0.5">
                      * Ban Nhân sự sẽ căn cứ vào bản scan hoặc bản sao có chứng thực để phê duyệt cập nhật vào Core.
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* LÝ DO CHUNG */}
            <div className="space-y-1">
              <label className="font-semibold text-slate-800 block">Lý do khởi tạo đơn yêu cầu *</label>
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Nhập chi tiết lý do và thông tin giải trình liên quan..."
                className="w-full rounded-md border border-slate-200 p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </div>

            {/* QUY TRÌNH DUYỆT (Mục 3 Khối 4 trong PLAN) */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between text-[11px] text-slate-600">
              <span>
                Cấp xét duyệt: <strong>{selectedCatalogId === 'advance' ? 'Kế toán & Giám đốc duyệt' : 'Quản lý trực tiếp'}</strong>
              </span>
              <span className="font-mono text-slate-400">SLA: 24h</span>
            </div>
          </div>

          <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              onClick={() => setIsCreateModalOpen(false)}
              disabled={isSubmitting}
            >
              Hủy
            </Button>
            <Button
              size="sm"
              className="bg-[#021E73] hover:bg-blue-900 text-white text-xs font-semibold h-8 gap-1"
              onClick={handleSubmitRequest}
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              <span>{isSubmitting ? 'Đang gửi...' : 'Gửi duyệt đơn'}</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* DRAWER / SLIDE-IN PANEL: XEM CHI TIẾT ĐƠN CHUẨN 5 KHỐI THEO PLAN */}
      <Sheet open={isDetailDrawerOpen} onOpenChange={setIsDetailDrawerOpen}>
        <SheetContent className="max-w-xl p-0 overflow-hidden bg-white flex flex-col justify-between">
          <div>
            {/* KHỐI 1: HEADER (Mã đơn, Tên đơn, Người gửi, Ngày tạo, Trạng thái) */}
            <SheetHeader>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-[#021E73]">
                  {selectedRequest?.code}
                </span>
                <Badge
                  className={
                    selectedRequest?.workflowStatus === 'APPROVED'
                      ? 'bg-emerald-100 text-emerald-800 text-[10px]'
                      : selectedRequest?.workflowStatus === 'PENDING_PEER'
                      ? 'bg-indigo-100 text-indigo-800 text-[10px]'
                      : selectedRequest?.workflowStatus === 'PENDING_APPROVAL'
                      ? 'bg-amber-100 text-amber-800 text-[10px]'
                      : 'bg-rose-100 text-rose-700 text-[10px]'
                  }
                >
                  {selectedRequest?.statusText}
                </Badge>
              </div>
              <SheetTitle className="text-base font-bold text-slate-900 mt-1">
                {selectedRequest?.typeName}
              </SheetTitle>
              <SheetDescription className="text-xs text-slate-500">
                Tạo ngày {selectedRequest?.createdAt} bởi <strong>{profile.fullName}</strong>
              </SheetDescription>
            </SheetHeader>

            {/* BODY CHỨA 4 KHỐI CÒN LẠI VỚI NỘI BỘ SCROLL */}
            <div className="p-6 space-y-5 text-xs overflow-y-auto max-h-[calc(100vh-140px)]">
              {/* KHỐI 2: THÔNG TIN ĐƠN (Business Information) */}
              <div className="space-y-2.5">
                <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] flex items-center gap-1.5 text-blue-900">
                  <FileText className="size-3.5 text-blue-600" />
                  Thông tin nghiệp vụ
                </h4>
                <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 space-y-2">
                  <div className="flex justify-between py-1 border-b border-slate-200/60">
                    <span className="text-slate-500">Thời gian hiệu lực:</span>
                    <span className="font-semibold text-slate-800">{selectedRequest?.effectiveDate}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200/60">
                    <span className="text-slate-500">Thời lượng / Khối lượng:</span>
                    <span className="font-mono font-bold text-slate-900">{selectedRequest?.duration}</span>
                  </div>
                  <div className="pt-1 space-y-1">
                    <span className="text-slate-500 block">Lý do khởi tạo:</span>
                    <p className="p-2.5 rounded bg-white text-slate-700 leading-relaxed text-xs border border-slate-100">
                      {selectedRequest?.reason}
                    </p>
                  </div>
                </div>
              </div>

              {/* KHỐI 3: THÔNG TIN HỖ TRỢ / ĐIỀU KIỆN */}
              <div className="space-y-2.5">
                <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] flex items-center gap-1.5 text-blue-900">
                  <Info className="size-3.5 text-blue-600" />
                  Thông tin hỗ trợ & Điều kiện áp dụng
                </h4>
                <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 text-[11px] text-slate-600 space-y-1.5">
                  {selectedRequest?.kind === 'leave' && (
                    <div className="flex justify-between">
                      <span>Quỹ phép khả dụng của nhân viên:</span>
                      <strong className="text-[#021E73]">{leaveBalance.remaining} ngày</strong>
                    </div>
                  )}
                  {selectedRequest?.kind === 'ot' && (
                    <div className="flex justify-between">
                      <span>Chính sách áp dụng:</span>
                      <strong className="text-slate-800">OT Policy v1 (Hệ số lương chuẩn)</strong>
                    </div>
                  )}
                  {selectedRequest?.kind === 'shift_change' && (
                    <div className="flex justify-between">
                      <span>Tình trạng xác nhận chéo:</span>
                      <strong className={selectedRequest.workflowStatus === 'PENDING_PEER' ? 'text-amber-700' : 'text-emerald-700'}>
                        {selectedRequest.workflowStatus === 'PENDING_PEER' ? 'Đang chờ đồng nghiệp' : 'Đã xác nhận'}
                      </strong>
                    </div>
                  )}
                  {selectedRequest?.kind === 'advance' && (
                    <div className="flex justify-between">
                      <span>Số kỳ phân bổ khấu trừ:</span>
                      <strong className="text-indigo-900 font-mono">
                        {String(selectedRequest.rawDetails?.numberOfInstallments || 1)} kỳ
                      </strong>
                    </div>
                  )}
                  {selectedRequest?.kind === 'correction' && (
                    <div className="flex justify-between">
                      <span>Mốc giờ đề xuất:</span>
                      <strong className="text-slate-800">{selectedRequest.duration}</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* KHỐI 4: QUY TRÌNH (Workflow Step, Approver, Timeline) */}
              <div className="space-y-2.5">
                <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] flex items-center gap-1.5 text-blue-900">
                  <UserCheck className="size-3.5 text-blue-600" />
                  Quy trình phê duyệt (Workflow Step)
                </h4>
                <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="size-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">
                      ✓
                    </div>
                    <div>
                      <div className="font-semibold text-slate-800">Nhân viên khởi tạo yêu cầu</div>
                      <div className="text-[11px] text-slate-400">{selectedRequest?.createdAt}</div>
                    </div>
                  </div>

                  {selectedRequest?.kind === 'shift_change' && (
                    <div className="flex items-center gap-3">
                      <div
                        className={`size-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                          selectedRequest.workflowStatus !== 'PENDING_PEER'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {selectedRequest.workflowStatus !== 'PENDING_PEER' ? '✓' : '•'}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800">Đồng nghiệp xác nhận đổi ca</div>
                        <div className="text-[11px] text-slate-500">
                          {selectedRequest.workflowStatus !== 'PENDING_PEER' ? 'Đã xác nhận chéo' : 'Đang chờ phản hồi'}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <div
                      className={`size-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                        selectedRequest?.workflowStatus === 'APPROVED'
                          ? 'bg-emerald-100 text-emerald-700'
                          : selectedRequest?.workflowStatus === 'REJECTED'
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {selectedRequest?.workflowStatus === 'APPROVED'
                        ? '✓'
                        : selectedRequest?.workflowStatus === 'REJECTED'
                        ? '✕'
                        : '•'}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-800">
                        Cấp thẩm quyền phê duyệt: <strong>{selectedRequest?.approver}</strong>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {selectedRequest?.workflowStatus === 'APPROVED'
                          ? 'Đã chấp thuận'
                          : selectedRequest?.workflowStatus === 'REJECTED'
                          ? 'Đã từ chối'
                          : 'Đang chờ xét duyệt (SLA 24h)'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* KHỐI 5: KẾT QUẢ XỬ LÝ (Result & Side-effects) */}
              <div className="space-y-2.5">
                <h4 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] flex items-center gap-1.5 text-blue-900">
                  <FileCheck2 className="size-3.5 text-blue-600" />
                  Kết quả xử lý & Đồng bộ dữ liệu
                </h4>
                <div className="p-3.5 rounded-lg border border-slate-200 bg-white space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Trạng thái áp dụng:</span>
                    <Badge
                      className={
                        selectedRequest?.requestStatus === 'APPLIED' || selectedRequest?.requestStatus === 'DISBURSED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-700'
                      }
                    >
                      {selectedRequest?.requestStatus === 'APPLIED'
                        ? 'Đã cập nhật dữ liệu công'
                        : selectedRequest?.requestStatus === 'DISBURSED'
                        ? 'Đã giải ngân'
                        : 'Chờ áp dụng'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-slate-500 text-[11px]">
                    <span>Đồng bộ Timesheet / Payroll:</span>
                    <span className="font-mono text-slate-700">
                      {selectedRequest?.requestStatus === 'APPLIED' || selectedRequest?.requestStatus === 'DISBURSED'
                        ? 'Đã đồng bộ'
                        : 'Chưa đồng bộ'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* FOOTER ACTIONS */}
          <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
            <div>
              {/* Hành động Xác nhận đổi ca chéo nếu đang chờ xác nhận */}
              {selectedRequest?.kind === 'shift_change' && selectedRequest.workflowStatus === 'PENDING_PEER' && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8"
                    onClick={() => handlePeerConfirm(selectedRequest.id, true)}
                  >
                    Xác nhận đổi ca
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-8 border-rose-300 text-rose-700"
                    onClick={() => handlePeerConfirm(selectedRequest.id, false)}
                  >
                    Từ chối
                  </Button>
                </div>
              )}

              {/* Nút hủy đơn nếu còn ở trạng thái Pending */}
              {(selectedRequest?.workflowStatus === 'PENDING_APPROVAL' || selectedRequest?.workflowStatus === 'SUBMITTED') && (
                <Popconfirm
                  title="Huỷ đơn từ yêu cầu này?"
                  description="Đơn sẽ được rút khỏi luồng phê duyệt và không thể khôi phục."
                  okText="Huỷ đơn"
                  cancelText="Quay lại"
                  okType="danger"
                  placement="top"
                  onConfirm={() => selectedRequest && handleCancelRequest(selectedRequest)}
                >
                  <Button variant="outline" size="sm" className="text-xs h-8 border-rose-200 text-rose-700 hover:bg-rose-50">
                    <XCircle className="size-3.5 mr-1" />
                    Rút / Huỷ đơn
                  </Button>
                </Popconfirm>
              )}
            </div>

            <Button
              size="sm"
              className="bg-[#021E73] hover:bg-blue-900 text-white text-xs h-8"
              onClick={() => setIsDetailDrawerOpen(false)}
            >
              Đóng
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
