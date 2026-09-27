'use client';

import {
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  History,
  Info,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  QrCode,
  ScanFace,
  Send,
  ShieldCheck,
  Smartphone,
  Touchpad,
  UserCheck,
  Wifi,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
} from '../ui/dialog';
import { EmployeeHeroCard, type EmployeeProfileHeroData } from '../ui/employee-hero-card';
import { Input } from '../ui/input';
import { toast } from '../ui/toast';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  MonthlyAttendanceMatrixTable,
  type MatrixLeaveRequest,
} from '../ui/monthly-attendance-matrix-table';

type AttendanceSubTab = 'checkin' | 'logs';

interface AssignedShift {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  graceLateMinutes: number;
  graceEarlyMinutes: number;
}

interface AttendanceRecord {
  id: string;
  tenantId: string;
  employeeId: string;
  workDate: string;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  attendanceSource: string;
  deviceId?: string | null;
  status: string;
  workedMinutes: number;
  note?: string | null;
}

interface AttendanceLogRow {
  id: string;
  date: string;
  rawDate: string;
  isToday: boolean;
  shift: string;
  shiftHours: string;
  inTime: string;
  inStatus: string;
  outTime: string;
  outStatus: string;
  workedHours: string;
  device: string;
  status: string;
  statusText: string;
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

export default function AttendancePage() {
  const [activeTab, setActiveTab] = useState<AttendanceSubTab>('checkin');
  const [currentTime, setCurrentTime] = useState('');
  const [currentDateFormatted, setCurrentDateFormatted] = useState('');
  const [currentMonthTag, setCurrentMonthTag] = useState('');

  // Profile data from API
  const [profile, setProfile] = useState<EmployeeProfileHeroData>({
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

  // Attendance data from API
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([]);
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord | null>(null);
  const [assignedShift, setAssignedShift] = useState<AssignedShift | null>(null);
  const [loading, setLoading] = useState(true);

  // Web Mobile-Simulation Punch Modal State
  const [isPunchModalOpen, setIsPunchModalOpen] = useState(false);
  const [punchType, setPunchType] = useState<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN');
  const [punchMethod, setPunchMethod] = useState<'GPS' | 'WIFI_WAN_IP' | 'BIOMETRIC' | 'QR_CODE'>('GPS');
  const [punchDeviceId, setPunchDeviceId] = useState('SIMULATED_WEB_TEST_DEVICE_01');
  const [punchLatitude, setPunchLatitude] = useState('10.776889');
  const [punchLongitude, setPunchLongitude] = useState('106.700806');
  const [punchWifiSsid, setPunchWifiSsid] = useState('SVN_OFFICE_CORP_5G');
  const [punchCustomTime, setPunchCustomTime] = useState('');
  const [punchNote, setPunchNote] = useState('');
  const [submittingPunch, setSubmittingPunch] = useState(false);

  // Correction / Explain Modal state
  const [isExplainModalOpen, setIsExplainModalOpen] = useState(false);
  const [explainAttendanceId, setExplainAttendanceId] = useState<string | null>(null);
  const [explainDate, setExplainDate] = useState('');
  const [explainInTime, setExplainInTime] = useState('08:00');
  const [explainOutTime, setExplainOutTime] = useState('17:30');
  const [explainReason, setExplainReason] = useState('');
  const [submittingExplain, setSubmittingExplain] = useState(false);

  // Filter
  const [filterStatus, setFilterStatus] = useState('all');
  const [currentEmployeeId, setCurrentEmployeeId] = useState<string>('');
  const [myLeaves, setMyLeaves] = useState<MatrixLeaveRequest[]>([]);
  const [logsViewMode, setLogsViewMode] = useState<'MATRIX' | 'RAW_LOGS'>('MATRIX');

  // Real-time clock update & dynamic dates
  useEffect(() => {
    function updateClock() {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }),
      );
      const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
      const dayName = days[now.getDay()];
      setCurrentDateFormatted(
        `${dayName}, ngày ${String(now.getDate()).padStart(2, '0')} tháng ${String(now.getMonth() + 1).padStart(2, '0')} năm ${now.getFullYear()} (GMT+7)`,
      );
      setCurrentMonthTag(`Tháng ${now.getMonth() + 1}/${now.getFullYear()}`);
    }
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch real profile & attendances & shifts from API
  async function loadData() {
    try {
      setLoading(true);
      // 1. Fetch user profile
      const profRes = await fetch('/api/hrm/v1/my-profile', { credentials: 'same-origin' });
      if (profRes.ok) {
        const payload = await profRes.json();
        const p = payload.data;
        if (p) {
          const statusLabel =
            p.employmentStatus === 'OFFICIAL' ? 'CHÍNH THỨC (Official)' :
            p.employmentStatus === 'PROBATION' ? 'THỬ VIỆC (Probation)' :
            p.employmentStatus === 'ON_LEAVE' ? 'NGHỈ PHÉP (On Leave)' :
            p.employmentStatus === 'RESIGNED' ? 'ĐÃ NGHỈ VIỆC (Resigned)' :
            p.employmentStatus === 'TERMINATED' ? 'CHẤM DỨT HĐ (Terminated)' :
            p.employmentStatus || '';

          const empId = p.employeeId || p.id || '';
          setCurrentEmployeeId(empId);
          setProfile({
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

          // Fetch leave requests for this employee
          if (empId) {
            void fetch(`/api/hrm/v1/leave-requests?employee_id=${empId}`, { credentials: 'same-origin' })
              .then((res) => (res.ok ? res.json() : null))
              .then((data) => {
                if (data?.data) {
                  setMyLeaves(data.data);
                }
              })
              .catch(() => {});
          }
        }
      }

      // 2. Fetch shift definitions
      const shiftRes = await fetch('/api/hrm/v1/shifts', { credentials: 'same-origin' });
      if (shiftRes.ok) {
        const payload = await shiftRes.json();
        const shifts = payload.data || [];
        if (shifts.length > 0) {
          const activeShift = shifts.find((s: any) => s.status === 'ACTIVE') || shifts[0];
          setAssignedShift({
            id: activeShift.id,
            code: activeShift.code,
            name: activeShift.name,
            startTime: activeShift.startTime || '08:00:00',
            endTime: activeShift.endTime || '17:30:00',
            breakMinutes: activeShift.breakMinutes ?? 60,
            graceLateMinutes: activeShift.graceLateMinutes ?? 10,
            graceEarlyMinutes: activeShift.graceEarlyMinutes ?? 5,
          });
        }
      }

      // 3. Fetch attendance logs
      const attRes = await fetch('/api/hrm/v1/attendance', { credentials: 'same-origin' });
      if (attRes.ok) {
        const payload = await attRes.json();
        const list: AttendanceRecord[] = payload.data || [];
        setAttendances(list);

        // Find today's record
        const todayIso = new Date().toISOString().slice(0, 10);
        const todayRec = list.find((item) => String(item.workDate).slice(0, 10) === todayIso) || null;
        setTodayAttendance(todayRec);
      }
    } catch (err) {
      console.error('Không thể tải dữ liệu chấm công từ API:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  // Handler for open test punch modal
  const openPunchModal = (type: 'CHECK_IN' | 'CHECK_OUT') => {
    setPunchType(type);
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    setPunchCustomTime(`${hh}:${mm}`);
    setIsPunchModalOpen(true);
  };

  // Submit test punch
  const handlePunchSubmit = async () => {
    try {
      setSubmittingPunch(true);
      const url = punchType === 'CHECK_IN'
        ? '/api/hrm/v1/attendance/check-in'
        : '/api/hrm/v1/attendance/check-out';

      // Build ISO occurred time
      const todayIso = new Date().toISOString().slice(0, 10);
      let occurredAt = new Date().toISOString();
      if (punchCustomTime) {
        occurredAt = `${todayIso}T${punchCustomTime}:00+07:00`;
      }

      const bodyPayload = {
        employeeId: todayAttendance?.employeeId || undefined,
        occurredAt,
        source: 'WEB_PORTAL' as const,
        deviceId: punchDeviceId || 'SIMULATED_WEB_TEST_DEVICE_01',
        verificationMethod: punchMethod,
        latitude: punchMethod === 'GPS' ? parseFloat(punchLatitude) || null : null,
        longitude: punchMethod === 'GPS' ? parseFloat(punchLongitude) || null : null,
        wifiSsid: punchMethod === 'WIFI_WAN_IP' ? punchWifiSsid : null,
        note: punchNote ? punchNote.trim() : undefined,
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken(),
        },
        credentials: 'same-origin',
        body: JSON.stringify(bodyPayload),
      });

      if (res.ok) {
        const resData = await res.json();
        const record = resData.data;
        setIsPunchModalOpen(false);
        toast.add({
          title: punchType === 'CHECK_IN' ? 'Ghi nhận Check-in thành công' : 'Ghi nhận Check-out thành công',
          description: `Thời gian: ${punchCustomTime || 'Hiện tại'} • Trạng thái: ${record?.status || 'VALID'} • Phút công: ${record?.workedMinutes || 0}m`,
          type: 'success',
        });
        await loadData();
      } else {
        const errorData = await res.json().catch(() => ({}));
        toast.add({
          title: 'Thao tác không thành công',
          description: errorData.message || 'Không thể ghi nhận chấm công. Vui lòng thử lại.',
          type: 'error',
        });
      }
    } catch (err) {
      console.error('Lỗi khi quẹt thẻ kiểm thử:', err);
      toast.add({
        title: 'Lỗi kết nối',
        description: 'Không thể kết nối đến máy chủ API.',
        type: 'error',
      });
    } finally {
      setSubmittingPunch(false);
    }
  };

  // Submit attendance correction
  const handleSendExplain = async () => {
    if (!explainDate || !explainReason.trim()) {
      toast.add({
        title: 'Thiếu thông tin',
        description: 'Vui lòng chọn ngày và nhập lý do giải trình.',
        type: 'warning',
      });
      return;
    }

    try {
      setSubmittingExplain(true);
      const res = await fetch('/api/hrm/v1/attendance-corrections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken(),
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          employeeId: todayAttendance?.employeeId || '',
          attendanceId: explainAttendanceId || undefined,
          requestDate: explainDate,
          newCheckInAt: explainInTime ? `${explainDate}T${explainInTime}:00` : null,
          newCheckOutAt: explainOutTime ? `${explainDate}T${explainOutTime}:00` : null,
          reason: explainReason,
        }),
      });

      if (res.ok) {
        setIsExplainModalOpen(false);
        setExplainReason('');
        toast.add({
          title: 'Đã gửi yêu cầu giải trình công',
          description: `Yêu cầu cho ngày ${explainDate} đã được gửi thành công đến Quản lý phê duyệt.`,
          type: 'success',
        });
        await loadData();
      } else {
        toast.add({
          title: 'Gửi thất bại',
          description: 'Không thể tạo đơn giải trình. Vui lòng thử lại sau.',
          type: 'error',
        });
      }
    } catch (err) {
      console.error('Lỗi khi gửi giải trình công:', err);
      toast.add({
        title: 'Lỗi kết nối',
        description: 'Không thể kết nối đến máy chủ.',
        type: 'error',
      });
    } finally {
      setSubmittingExplain(false);
    }
  };

  // Convert raw attendances into presentation rows
  const todayIso = new Date().toISOString().slice(0, 10);
  const logsData: AttendanceLogRow[] = attendances.map((item) => {
    const rawDate = String(item.workDate).slice(0, 10);
    const isToday = rawDate === todayIso;

    // Format Vietnamese date
    let dateLabel = rawDate;
    try {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
        dateLabel = `${days[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      }
    } catch {
      dateLabel = rawDate;
    }

    const inTime = item.checkInAt ? new Date(item.checkInAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '----';
    const outTime = item.checkOutAt ? new Date(item.checkOutAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '----';

    const workedMin = item.workedMinutes || 0;
    const hours = Math.floor(workedMin / 60);
    const minutes = workedMin % 60;
    const workedHours = workedMin > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : (item.checkInAt ? (item.checkOutAt ? '0h 00m' : 'Đang trong ca') : '----');

    let statusKey = 'VALID';
    let statusText = 'Hợp lệ';
    if (item.status === 'LATE' || item.status === 'EARLY_LEAVE' || item.status === 'MISSING_PUNCH' || item.status === 'ABNORMAL') {
      statusKey = 'INVALID';
      statusText = item.status === 'LATE' ? 'Đi muộn' : item.status === 'EARLY_LEAVE' ? 'Về sớm' : item.status === 'MISSING_PUNCH' ? 'Thiếu quẹt thẻ' : 'Bất thường';
    } else if (item.status === 'APPROVED_CORRECTION') {
      statusKey = 'OVERRIDDEN';
      statusText = 'Đã duyệt sửa';
    }

    const sourceLabel =
      item.attendanceSource === 'BIOMETRIC_DEVICE' ? (item.deviceId ? `Máy chấm công (${item.deviceId})` : 'Máy chấm công vân tay') :
      item.attendanceSource === 'MOBILE_GPS' ? 'Mobile App GPS' :
      item.attendanceSource === 'WEB_PORTAL' ? 'Web Portal' :
      item.attendanceSource === 'MANUAL_CORRECTION' ? 'Điều chỉnh thủ công' :
      item.attendanceSource || '----';

    return {
      id: item.id,
      date: dateLabel,
      rawDate,
      isToday,
      shift: '----',
      shiftHours: '----',
      inTime,
      inStatus: item.checkInAt ? (item.status === 'LATE' ? 'Đi muộn' : 'Hợp lệ') : '----',
      outTime,
      outStatus: item.checkOutAt ? 'Đã check-out' : (item.checkInAt ? 'Đang trong ca' : '----'),
      workedHours,
      device: sourceLabel,
      status: statusKey,
      statusText,
    };
  });

  const filteredLogs = logsData.filter((log) => {
    if (filterStatus === 'all') return true;
    return log.status === filterStatus;
  });

  // Calculate statistics
  const totalDays = attendances.length;
  const validDays = logsData.filter((r) => r.status === 'VALID').length;
  const abnormalDays = logsData.filter((r) => r.status === 'INVALID').length;
  const overriddenDays = logsData.filter((r) => r.status === 'OVERRIDDEN').length;
  const totalWorkedMinutes = attendances.reduce((acc, curr) => acc + (curr.workedMinutes || 0), 0);
  const totalWorkedHoursDisplay = (totalWorkedMinutes / 60).toFixed(1);

  // Today specific calculations
  const isCheckedInToday = Boolean(todayAttendance?.checkInAt && !todayAttendance?.checkOutAt);
  const todayInTime = todayAttendance?.checkInAt
    ? new Date(todayAttendance.checkInAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '----';
  const todayOutTime = todayAttendance?.checkOutAt
    ? new Date(todayAttendance.checkOutAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '----';

  const todayWorkedMinutes = todayAttendance?.workedMinutes || 0;
  const todayHours = Math.floor(todayWorkedMinutes / 60);
  const todayMin = todayWorkedMinutes % 60;
  const todayWorkedDisplay = todayWorkedMinutes > 0 ? `${todayHours} giờ ${todayMin} phút` : (todayAttendance?.checkInAt ? 'Đang tích lũy' : '----');

  return (
    <div className="space-y-6">
      {/* 1. Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Chấm công</h1>
            <Badge className="bg-blue-100 text-blue-800 border border-blue-200 text-xs font-semibold">
              My Attendance / ESS
            </Badge>
          </div>
          <p className="text-xs text-slate-500">
            Không gian ghi nhận giờ làm việc, kiểm tra tính hợp lệ dữ liệu quẹt thẻ và rà soát lịch sử công cá nhân.
          </p>
        </div>
      </div>

      {/* 2. Employee Profile Snapshot */}
      <EmployeeHeroCard profile={profile} />

      {/* 3. Sub-tabs Navigation */}
      <div className="border-b border-slate-200">
        <div className="flex space-x-8 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('checkin')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${activeTab === 'checkin'
              ? 'border-blue-600 text-blue-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
          >
            <Touchpad className="size-4" />
            <span>Ghi nhận giờ làm việc (Check-in / Check-out)</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white">
              Hôm nay
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${activeTab === 'logs'
              ? 'border-blue-600 text-blue-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
          >
            <History className="size-4" />
            <span>Lịch sử quẹt thẻ & Sổ chấm công</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
              {currentMonthTag || 'Kỳ hiện tại'}
            </span>
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: CHECK-IN / CHECK-OUT */}
      {activeTab === 'checkin' && (
        <div className="space-y-6">
          {/* Shift Banner */}
          <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-4 shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-lg bg-[#021E73]/10 text-[#021E73] flex items-center justify-center shrink-0">
                  <Calendar className="size-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      {assignedShift ? `Ca làm việc: ${assignedShift.name}` : 'Ca làm việc: Ca Hành chính chuẩn'}
                    </h3>
                    <Badge className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200">
                      {assignedShift ? assignedShift.code : 'CA_HC'}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Mã ca: <strong>{assignedShift?.code || 'CA_HC'}</strong> • Chu kỳ: Thứ Hai - Thứ Sáu hàng tuần
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="bg-white p-2.5 rounded-lg border border-blue-100">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Khung giờ làm</span>
                  <span className="font-bold text-slate-900 text-xs">
                    {assignedShift ? `${assignedShift.startTime.slice(0, 5)} - ${assignedShift.endTime.slice(0, 5)}` : '08:00 - 17:30'}
                  </span>
                  <span className="text-[11px] text-slate-500 block">
                    Nghỉ trưa: {assignedShift ? `${assignedShift.breakMinutes} phút` : '90 phút'}
                  </span>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-blue-100">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Quy tắc đi muộn</span>
                  <span className="font-semibold text-slate-700 text-xs">
                    {assignedShift?.startTime ? `Sau ${assignedShift.startTime.slice(0, 5)}` : 'Sau 08:00'}
                  </span>
                  <span className="text-[11px] text-slate-500 block">
                    Dung sai: {assignedShift ? `${assignedShift.graceLateMinutes} phút` : '10 phút'}
                  </span>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-blue-100">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Quy tắc về sớm</span>
                  <span className="font-semibold text-slate-700 text-xs">
                    {assignedShift?.endTime ? `Trước ${assignedShift.endTime.slice(0, 5)}` : 'Trước 17:30'}
                  </span>
                  <span className="text-[11px] text-slate-500 block">
                    Dung sai: {assignedShift ? `${assignedShift.graceEarlyMinutes} phút` : '5 phút'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Realtime Punch Clock Panel */}
            <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-4 bg-[#021E73] rounded-full" />
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    Đồng hồ điểm danh trực tiếp (Punch Clock)
                  </h3>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                  <span className="size-2 rounded-full bg-emerald-600 animate-pulse" />
                  Máy chủ thời gian thực
                </div>
              </div>

              <div className="my-6 text-center">
                <div className="text-slate-400 text-xs font-semibold tracking-wider uppercase mb-1">
                  Giờ chuẩn hệ thống (NTP Server Time)
                </div>
                <div className="font-mono font-extrabold text-4xl sm:text-5xl text-[#021E73] tracking-tight">
                  {currentTime || '00:00:00'}
                </div>
                <div className="text-xs text-slate-500 font-medium mt-1">
                  {currentDateFormatted || '----'}
                </div>
                <div className="mt-4 inline-flex flex-wrap items-center justify-center gap-3 text-xs text-slate-600 bg-slate-50 px-4 py-2 rounded-lg border border-slate-200">
                  <span className="flex items-center gap-1">
                    <Wifi className="size-3.5 text-blue-700" />
                    IP Máy chủ: <strong>118.69.182.102</strong>
                  </span>
                  <span className="text-slate-300">•</span>
                  <span className="flex items-center gap-1 text-slate-600">
                    <MapPin className="size-3.5 text-emerald-600" />
                    Văn phòng: <strong>Tòa nhà SVN Plaza (GPS: 10.7768, 106.7008)</strong>
                  </span>
                </div>
              </div>

              {/* Punch Actions & Mobile Simulation Banner */}
              <div className="space-y-4 pt-2">
                <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-start sm:items-center gap-3">
                    <div className="size-9 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center shrink-0">
                      <Smartphone className="size-5" />
                    </div>
                    <div className="space-y-0.5">
                      <div className="font-bold text-slate-900 flex items-center gap-1.5">
                        <span>Chế độ kiểm thử quẹt thẻ mô phỏng Di động (Test Mode Active)</span>
                        <Badge variant="outline" className="bg-white text-blue-700 border-blue-300 text-[10px] font-semibold">
                          Mô phỏng Mobile Payload
                        </Badge>
                      </div>
                      <p className="text-slate-600 text-[11px]">
                        Nút Check-in và Check-out đã được kích hoạt nhằm kiểm tra API, tính toán ca làm, dung sai đi muộn / về sớm và cấu trúc payload di động trước khi đồng bộ App chính thức.
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300 bg-emerald-50 gap-1 shrink-0 self-start sm:self-auto font-medium">
                    <CheckCircle2 className="size-3 text-emerald-600" />
                    Web Punch Enabled
                  </Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Check-In Action Box */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col items-center text-center justify-between space-y-3 hover:border-slate-300 transition-colors">
                    <div className="flex flex-col items-center">
                      <div className={`size-10 rounded-full flex items-center justify-center mb-1.5 ${todayAttendance?.checkInAt ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                        <LogIn className="size-5" />
                      </div>
                      <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">CHECK-IN VÀO CA</span>
                      <div className={`text-sm font-extrabold font-mono mt-0.5 ${todayAttendance?.checkInAt ? 'text-emerald-700' : 'text-slate-500'}`}>
                        {todayAttendance?.checkInAt ? `ĐÃ VÀO: ${todayInTime}` : 'CHƯA GHI NHẬN'}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                        {todayAttendance?.checkInAt ? (
                          <>
                            <CheckCircle2 className="size-3 text-emerald-600" />
                            {todayAttendance.status === 'LATE' ? 'Ghi nhận đi muộn' : 'Đúng giờ quy định'}
                          </>
                        ) : (
                          'Sẵn sàng gửi payload vào ca'
                        )}
                      </p>
                    </div>
                    <Button
                      variant="default"
                      onClick={() => openPunchModal('CHECK_IN')}
                      className="w-full bg-[#021E73] hover:bg-blue-900 text-white font-bold text-xs h-9 shadow-xs gap-1.5 cursor-pointer"
                    >
                      <LogIn className="size-3.5" />
                      {todayAttendance?.checkInAt ? 'CHECK-IN LẠI (TEST MULTI-PUNCH)' : 'CHECK-IN VÀO CA (TEST API)'}
                    </Button>
                  </div>

                  {/* Check-Out Action Box */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col items-center text-center justify-between space-y-3 hover:border-slate-300 transition-colors">
                    <div className="flex flex-col items-center">
                      <div className={`size-10 rounded-full flex items-center justify-center mb-1.5 ${todayAttendance?.checkOutAt ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                        <LogOut className="size-5" />
                      </div>
                      <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">CHECK-OUT HẾT CA</span>
                      <div className={`text-sm font-extrabold font-mono mt-0.5 ${todayAttendance?.checkOutAt ? 'text-emerald-700' : 'text-slate-500'}`}>
                        {todayAttendance?.checkOutAt ? `ĐÃ RA: ${todayOutTime}` : (todayAttendance?.checkInAt ? 'ĐANG TRONG CA LÀM' : 'CHƯA GHI NHẬN')}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                        {todayAttendance?.checkOutAt ? (
                          <>
                            <CheckCircle2 className="size-3 text-emerald-600" />
                            {todayAttendance.status === 'EARLY_LEAVE' ? 'Ghi nhận về sớm' : 'Đã hoàn tất ca'}
                          </>
                        ) : (
                          'Sẵn sàng tính toán giờ công & ra về'
                        )}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => openPunchModal('CHECK_OUT')}
                      className="w-full border-blue-700 text-blue-700 hover:bg-blue-50 font-bold text-xs h-9 shadow-xs gap-1.5 cursor-pointer"
                    >
                      <LogOut className="size-3.5" />
                      {todayAttendance?.checkOutAt ? 'CHECK-OUT LẠI (CẬP NHẬT GIỜ RA)' : 'CHECK-OUT HẾT CA (TEST API)'}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
                <span className="flex items-center gap-1.5 font-medium text-slate-600">
                  <Smartphone className="size-3.5 text-blue-600" />
                  Kênh điểm danh khả dụng trên Di động:
                </span>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1 font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-[11px]">
                    <QrCode className="size-3.5 text-blue-700" />
                    Quét mã QR tại trạm (App)
                  </span>
                  <span className="text-slate-300">•</span>
                  <span className="inline-flex items-center gap-1 font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-[11px]">
                    <ScanFace className="size-3.5 text-blue-700" />
                    Sinh trắc học FaceID (App / Cửa)
                  </span>
                </div>
              </div>
            </div>

            {/* Today Status Panel */}
            <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between overflow-hidden">
              {/* Header */}
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-1.5 h-4 bg-emerald-600 rounded-full" />
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    Tình trạng điểm danh hôm nay
                  </h3>
                </div>
                <Badge
                  className={
                    isCheckedInToday
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 text-[11px] font-semibold gap-1'
                      : todayAttendance?.checkOutAt
                        ? 'bg-slate-100 text-slate-600 border-slate-200 text-[11px] font-medium'
                        : 'bg-amber-50 text-amber-700 border-amber-200 text-[11px] font-medium'
                  }
                >
                  {isCheckedInToday && <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                  {isCheckedInToday ? 'Đang làm việc' : todayAttendance?.checkOutAt ? 'Đã check-out' : 'Chưa điểm danh'}
                </Badge>
              </div>

              {/* Body Content */}
              <div className="p-5 space-y-3.5">
                {/* Check-in Entry */}
                <div className="p-3.5 bg-slate-50/70 rounded-xl border border-slate-200/80 flex items-center justify-between gap-3 hover:border-slate-300 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-lg bg-emerald-100/80 text-emerald-700 flex items-center justify-center shrink-0">
                      <LogIn className="size-4" />
                    </div>
                    <div>
                      <span className="text-[11px] font-medium text-slate-500 block">Giờ vào thực tế (Check-in)</span>
                      <span className="font-mono font-bold text-sm text-slate-900 tracking-wide">{todayInTime}</span>
                    </div>
                  </div>
                  <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold shrink-0">
                    {todayAttendance?.checkInAt ? (todayAttendance.status === 'LATE' ? 'Đi muộn' : 'Hợp lệ') : '----'}
                  </Badge>
                </div>

                {/* Check-out Entry */}
                <div className="p-3.5 bg-slate-50/70 rounded-xl border border-slate-200/80 flex items-center justify-between gap-3 hover:border-slate-300 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                      <LogOut className="size-4" />
                    </div>
                    <div>
                      <span className="text-[11px] font-medium text-slate-500 block">Giờ ra thực tế (Check-out)</span>
                      <span className="font-mono font-bold text-sm text-slate-900 tracking-wide">
                        {todayOutTime}
                      </span>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      todayAttendance?.checkOutAt
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-semibold shrink-0'
                        : 'bg-slate-100 text-slate-500 border-slate-200 text-[10px] font-semibold shrink-0'
                    }
                  >
                    {todayAttendance?.checkOutAt ? 'Đã hoàn thành' : (todayAttendance?.checkInAt ? 'Đang chờ ghi nhận' : '----')}
                  </Badge>
                </div>

                {/* 2-Column Metrics */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="p-3.5 bg-blue-50/40 rounded-xl border border-blue-100/80 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-slate-500">Thời gian tích lũy</span>
                      <Clock className="size-3.5 text-blue-600" />
                    </div>
                    <div className="mt-2">
                      <div className="text-base font-extrabold text-[#021E73] font-mono tracking-tight">
                        {todayWorkedDisplay}
                      </div>
                      <span className="text-[10px] text-slate-500 font-medium block mt-0.5">
                        {todayAttendance?.workedMinutes ? `${todayAttendance.workedMinutes} phút làm việc` : '----'}
                      </span>
                    </div>
                  </div>

                  <div className="p-3.5 bg-emerald-50/40 rounded-xl border border-emerald-100/80 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-slate-500">Trạng thái tuân thủ</span>
                      <CheckCircle2 className="size-3.5 text-emerald-600" />
                    </div>
                    <div className="mt-2">
                      <div className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                        {todayAttendance?.status === 'LATE' ? 'Đi muộn' : todayAttendance ? 'Không vi phạm' : '----'}
                      </div>
                      <span className="text-[10px] text-slate-500 font-medium block mt-0.5">
                        {todayAttendance ? 'Dữ liệu hôm nay' : 'Chưa ghi nhận ca'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card Footer with Quick Action */}
              <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  Đồng bộ tự động từ thiết bị
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: ATTENDANCE LOGS & TIMESHEET */}
      {activeTab === 'logs' && (
        <div className="space-y-6">
          {/* Summary Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Tổng ngày công</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-extrabold text-slate-900 font-mono">{totalDays}</span>
                  <span className="text-xs text-slate-400 font-semibold">ngày</span>
                </div>
                <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="size-3.5" />
                  Kỳ hiện tại
                </span>
              </div>
              <div className="size-10 rounded-xl bg-blue-50 text-[#021E73] flex items-center justify-center">
                <Calendar className="size-5" />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Giờ làm thực tế</span>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold text-[#021E73] font-mono">{totalWorkedHoursDisplay}</span>
                  <span className="text-xs text-slate-500 font-semibold">giờ</span>
                </div>
                <span className="text-[11px] text-slate-500">Tổng tích lũy</span>
              </div>
              <div className="size-10 rounded-xl bg-blue-50 text-[#021E73] flex items-center justify-center">
                <Clock className="size-5" />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Quẹt thẻ hợp lệ</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-extrabold text-emerald-700 font-mono">{validDays}</span>
                  <span className="text-xs text-slate-400 font-semibold">ngày</span>
                </div>
                <Badge className="bg-emerald-100 text-emerald-800 text-[10px] font-bold">VALID</Badge>
              </div>
              <div className="size-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
                <ShieldCheck className="size-5" />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Cần giải trình</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-extrabold text-rose-600 font-mono">{abnormalDays}</span>
                  <span className="text-xs text-slate-400 font-semibold">lần</span>
                </div>
                <Badge className="bg-rose-100 text-rose-700 text-[10px] font-bold">INVALID</Badge>
              </div>
              <div className="size-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
                <Info className="size-5" />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Đã điều chỉnh</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-extrabold text-blue-700 font-mono">{overriddenDays}</span>
                  <span className="text-xs text-slate-400 font-semibold">đơn</span>
                </div>
                <Badge className="bg-blue-100 text-blue-800 text-[10px] font-bold">OVERRIDDEN</Badge>
              </div>
              <div className="size-10 rounded-xl bg-blue-50 text-[#021E73] flex items-center justify-center">
                <UserCheck className="size-5" />
              </div>
            </div>
          </div>

          {/* Mode Switcher: Dạng Bảng Ma trận (Chuẩn ảnh mẫu) vs. Chi tiết Log quẹt thẻ */}
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center bg-slate-100 p-1 rounded-lg text-xs font-semibold text-slate-600">
              <button
                type="button"
                onClick={() => setLogsViewMode('MATRIX')}
                className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                  logsViewMode === 'MATRIX' ? 'bg-white text-[#021E73] font-bold shadow-xs' : 'hover:text-slate-900'
                }`}
              >
                Bảng công ma trận tháng (Chuẩn kỳ)
              </button>
              <button
                type="button"
                onClick={() => setLogsViewMode('RAW_LOGS')}
                className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                  logsViewMode === 'RAW_LOGS' ? 'bg-white text-[#021E73] font-bold shadow-xs' : 'hover:text-slate-900'
                }`}
              >
                Danh sách quẹt thẻ chi tiết
              </button>
            </div>

            <Button
              size="sm"
              className="bg-[#021E73] hover:bg-blue-900 text-white text-xs font-semibold h-8"
              onClick={() => {
                setExplainAttendanceId(null);
                setExplainDate(new Date().toISOString().slice(0, 10));
                setExplainInTime('08:00');
                setExplainOutTime('17:30');
                setExplainReason('');
                setIsExplainModalOpen(true);
              }}
            >
              Tạo giải trình công
            </Button>
          </div>

          {/* VIEW 1: BẢNG MA TRẬN THÁNG (CÁ NHÂN 1 HÀNG DUY NHẤT CÓ CON LĂN) */}
          {logsViewMode === 'MATRIX' ? (
            <MonthlyAttendanceMatrixTable
              employees={[
                {
                  employeeId: currentEmployeeId || 'me',
                  employeeCode: profile.employeeCode || 'NS_CURRENT',
                  fullName: profile.fullName || 'Nhân viên hiện tại',
                  department: profile.department || 'Khối Văn phòng',
                  position: profile.position || 'Nhân viên',
                },
              ]}
              attendances={attendances.map((a) => ({
                id: a.id,
                employeeId: a.employeeId,
                workDate: String(a.workDate),
                checkInAt: a.checkInAt,
                checkOutAt: a.checkOutAt,
                status: a.status,
                workedMinutes: a.workedMinutes,
                note: a.note,
              }))}
              leaveRequests={myLeaves}
              isLoading={loading}
              isSingleEmployeeMode={true}
              onExplainRequest={(attId, date) => {
                setExplainAttendanceId(attId);
                setExplainDate(date);
                setExplainInTime('08:00');
                setExplainOutTime('17:30');
                setExplainReason('');
                setIsExplainModalOpen(true);
              }}
            />
          ) : (
            <div className="space-y-4">
              {/* Filter Bar */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center bg-slate-100 p-1 rounded-lg font-medium text-slate-600">
                    <button
                      type="button"
                      onClick={() => setFilterStatus('all')}
                      className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${filterStatus === 'all' ? 'bg-white text-[#021E73] font-bold shadow-xs' : 'hover:text-slate-900'
                        }`}
                    >
                      Tất cả ({logsData.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterStatus('VALID')}
                      className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${filterStatus === 'VALID' ? 'bg-white text-emerald-700 font-bold shadow-xs' : 'hover:text-slate-900'
                        }`}
                    >
                      Hợp lệ ({validDays})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterStatus('INVALID')}
                      className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${filterStatus === 'INVALID' ? 'bg-white text-rose-700 font-bold shadow-xs' : 'hover:text-slate-900'
                        }`}
                    >
                      Bất thường ({abnormalDays})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterStatus('OVERRIDDEN')}
                      className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${filterStatus === 'OVERRIDDEN' ? 'bg-white text-blue-700 font-bold shadow-xs' : 'hover:text-slate-900'
                        }`}
                    >
                      Đã duyệt sửa ({overriddenDays})
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-8 gap-1.5 border-slate-300"
                    onClick={() => {
                      toast.add({
                        title: 'Đang xuất Excel',
                        description: 'File Bang_cham_cong_chi_tiet.xlsx đã được tải về.',
                        type: 'success',
                      });
                    }}
                  >
                    <Download className="size-3.5 text-emerald-700" />
                    <span>Xuất dữ liệu Excel</span>
                  </Button>
                </div>
              </div>

              {/* Logs Data Table */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      <tr>
                        <th className="p-3.5 pl-4">Ngày làm việc</th>
                        <th className="p-3.5">Ca quy định</th>
                        <th className="p-3.5">Giờ vào (Check-in)</th>
                        <th className="p-3.5">Giờ ra (Check-out)</th>
                        <th className="p-3.5">Thời gian làm</th>
                        <th className="p-3.5">Thiết bị / Nguồn</th>
                        <th className="p-3.5">Trạng thái</th>
                        <th className="p-3.5 pr-4 text-center">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                      {loading ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-slate-400">
                            <div className="flex items-center justify-center gap-2">
                              <Loader2 className="size-4 animate-spin text-[#021E73]" />
                              <span>Đang tải dữ liệu chấm công...</span>
                            </div>
                          </td>
                        </tr>
                      ) : filteredLogs.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-slate-400">
                            Không có dữ liệu quẹt thẻ trong kỳ
                          </td>
                        </tr>
                      ) : (
                        filteredLogs.map((row) => (
                          <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="p-3.5 pl-4">
                              <div className="font-bold text-slate-900">{row.date}</div>
                              {row.isToday && (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold bg-blue-100 text-blue-800 mt-0.5">
                                  Hôm nay
                                </span>
                              )}
                            </td>
                            <td className="p-3.5">
                              <div className="font-semibold text-slate-900">{row.shift}</div>
                              <span className="text-[11px] text-slate-400 font-mono">{row.shiftHours}</span>
                            </td>
                            <td className="p-3.5">
                              <div className="font-mono font-bold text-emerald-700">{row.inTime}</div>
                              <span className="text-[10px] text-emerald-600 font-medium">{row.inStatus}</span>
                            </td>
                            <td className="p-3.5">
                              <div className={`font-mono font-bold ${row.outTime === '----' ? 'text-slate-400' : 'text-slate-900'}`}>
                                {row.outTime}
                              </div>
                              <span className="text-[10px] text-slate-500">{row.outStatus}</span>
                            </td>
                            <td className="p-3.5 font-mono font-bold text-slate-900">{row.workedHours}</td>
                            <td className="p-3.5 text-slate-600 text-[11px]">{row.device}</td>
                            <td className="p-3.5">
                              <Badge
                                className={
                                  row.status === 'VALID'
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px]'
                                    : row.status === 'INVALID'
                                      ? 'bg-rose-100 text-rose-700 border border-rose-200 text-[10px]'
                                      : 'bg-blue-100 text-blue-800 border border-blue-200 text-[10px]'
                                }
                              >
                                {row.statusText}
                              </Badge>
                            </td>
                            <td className="p-3.5 pr-4 text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs h-7 text-blue-700 hover:text-blue-900 hover:bg-blue-50"
                                onClick={() => {
                                  setExplainAttendanceId(row.id);
                                  setExplainDate(row.rawDate);
                                  setExplainInTime(row.inTime !== '----' ? row.inTime.slice(0, 5) : '08:00');
                                  setExplainOutTime(row.outTime !== '----' ? row.outTime.slice(0, 5) : '17:30');
                                  setExplainReason('');
                                  setIsExplainModalOpen(true);
                                }}
                              >
                                Giải trình
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                  <span>Hiển thị <strong>{filteredLogs.length}</strong> ngày ghi nhận trong kỳ công</span>
                  <span className="font-mono text-[11px]">Dữ liệu tự động đồng bộ từ hệ thống</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal: Tạo giải trình / Bổ sung công */}
      <Dialog open={isExplainModalOpen} onOpenChange={setIsExplainModalOpen}>
        <DialogContent className="max-w-md p-0 overflow-hidden bg-white">
          <div className="p-5 border-b border-slate-200 bg-slate-50">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Clock className="size-4 text-[#021E73]" />
              Yêu cầu giải trình / Bổ sung giờ công
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Gửi yêu cầu điều chỉnh quẹt thẻ đến Quản lý trực tiếp phê duyệt
            </p>
          </div>

          <div className="p-5 space-y-4 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-800 block">Ngày cần giải trình</label>
              <Input
                type="date"
                value={explainDate}
                onChange={(e) => setExplainDate(e.target.value)}
                className="text-xs font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-semibold text-slate-800 block">Giờ vào đề xuất</label>
                <Input
                  value={explainInTime}
                  onChange={(e) => setExplainInTime(e.target.value)}
                  type="time"
                  className="text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-800 block">Giờ ra đề xuất</label>
                <Input
                  value={explainOutTime}
                  onChange={(e) => setExplainOutTime(e.target.value)}
                  type="time"
                  className="text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-800 block">Lý do giải trình</label>
              <textarea
                rows={3}
                value={explainReason}
                onChange={(e) => setExplainReason(e.target.value)}
                className="w-full rounded-md border border-slate-200 p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
                placeholder="Nhập chi tiết nguyên nhân quên quẹt thẻ hoặc sự cố máy..."
              />
            </div>

            <div className="p-3 bg-blue-50 rounded-lg text-slate-600 text-[11px] leading-relaxed">
              <strong>Quy chế:</strong> Yêu cầu giải trình sẽ được chuyển đến người quản lý trực tiếp và phòng Nhân sự phê duyệt.
            </div>
          </div>

          <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              onClick={() => setIsExplainModalOpen(false)}
              disabled={submittingExplain}
            >
              Hủy
            </Button>
            <Button
              size="sm"
              className="bg-[#021E73] hover:bg-blue-900 text-white text-xs font-semibold h-8 gap-1.5"
              onClick={handleSendExplain}
              disabled={submittingExplain}
            >
              {submittingExplain && <Loader2 className="size-3.5 animate-spin" />}
              <span>{submittingExplain ? 'Đang gửi...' : 'Gửi giải trình'}</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* POPUP MODAL: TEST MOBILE PUNCH SIMULATION */}
      <Dialog open={isPunchModalOpen} onOpenChange={setIsPunchModalOpen}>
        <DialogContent className="sm:max-w-[540px] p-0 overflow-hidden border-slate-200 shadow-xl">
          <div className="p-5 border-b border-slate-200 bg-slate-50/90 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${punchType === 'CHECK_IN' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                {punchType === 'CHECK_IN' ? <LogIn className="size-5" /> : <LogOut className="size-5" />}
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  {punchType === 'CHECK_IN' ? 'Mô phỏng Gửi Payload Check-in Vào Ca' : 'Mô phỏng Gửi Payload Check-out Hết Ca'}
                </h3>
                <p className="text-xs text-slate-500">
                  Mô phỏng dữ liệu phần cứng di động gửi về Server để kiểm tra nghiệp vụ chấm công
                </p>
              </div>
            </div>
            <Badge className={punchType === 'CHECK_IN' ? 'bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]' : 'bg-blue-100 text-blue-800 border-blue-200 text-[10px]'}>
              {punchType}
            </Badge>
          </div>

          <div className="p-5 space-y-4 text-xs max-h-[75vh] overflow-y-auto">
            {/* Shift Context Info */}
            <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200/80 flex items-start gap-2.5">
              <Info className="size-4 text-blue-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold text-blue-900 block">
                  Ca làm việc: {assignedShift ? assignedShift.name : 'Ca Hành chính chuẩn'} ({assignedShift ? `${assignedShift.startTime.slice(0, 5)} - ${assignedShift.endTime.slice(0, 5)}` : '08:00 - 17:30'})
                </span>
                <p className="text-[11px] text-blue-800 leading-relaxed">
                  {punchType === 'CHECK_IN'
                    ? `Dung sai vào ca trễ: ${assignedShift ? assignedShift.graceLateMinutes : 10} phút. Nếu giờ gửi > ${assignedShift?.startTime || '08:00'} + dung sai thì hệ thống tự động ghi nhận trạng thái 'LATE'.`
                    : `Dung sai về sớm: ${assignedShift ? assignedShift.graceEarlyMinutes : 5} phút. Giờ làm việc thực tế được trừ đi ${assignedShift ? assignedShift.breakMinutes : 90} phút nghỉ trưa.`}
                </p>
              </div>
            </div>

            {/* Verification Method Selection */}
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-800 block">
                Phương thức xác thực phần cứng (Verification Method)
              </label>
              <SearchableSelect
                value={punchMethod}
                onChange={(val) => setPunchMethod(val as any)}
                placeholder="Chọn phương thức xác thực..."
                options={[
                  { value: 'GPS', label: 'Tọa độ GPS Di động (Geofencing)', description: 'Mô phỏng định vị vị trí nhân viên' },
                  { value: 'WIFI_WAN_IP', label: 'BSSID / IP WAN Wi-Fi Văn phòng', description: 'Mô phỏng mạng nội bộ được phê duyệt' },
                  { value: 'BIOMETRIC', label: 'Sinh trắc học FaceID / Vân tay', description: 'Mô phỏng thiết bị nhận diện khuôn mặt' },
                  { value: 'QR_CODE', label: 'Mã QR động tại quầy lễ tân', description: 'Mô phỏng quét mã Token xoay vòng' },
                ]}
              />
            </div>

            {/* Simulated Time & Device UUID Selection */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-800 block">
                  Giờ ghi nhận kiểm thử (HH:mm)
                </label>
                <Input
                  type="time"
                  value={punchCustomTime}
                  onChange={(e) => setPunchCustomTime(e.target.value)}
                  className="text-xs font-mono"
                />
                <span className="text-[10px] text-slate-500 block">
                  Thử đổi thành 08:25 để test logic đi muộn
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-800 block">
                  Device UUID / Máy chấm công
                </label>
                <SearchableSelect
                  value={punchDeviceId}
                  onChange={(val) => setPunchDeviceId(val)}
                  placeholder="Chọn hoặc nhập mã thiết bị..."
                  options={[
                    {
                      value: 'DEV-IPHONE-15-PRO-MAX-001',
                      label: 'iPhone 15 Pro Max (iOS 17) - Máy cá nhân',
                      description: 'UUID: DEV-IPHONE-15-PRO-MAX-001',
                    },
                    {
                      value: 'DEV-SAMSUNG-S24-ULTRA-002',
                      label: 'Samsung Galaxy S24 Ultra (Android 14) - Máy kiểm thử',
                      description: 'UUID: DEV-SAMSUNG-S24-ULTRA-002',
                    },
                  ]}
                />
                <span className="text-[10px] text-slate-500 block">
                  Lưu vào `device_id` của lượt quẹt
                </span>
              </div>
            </div>

            {/* GPS Coordinates & Location Presets (If GPS selected) */}
            {punchMethod === 'GPS' && (
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-slate-800">
                    <MapPin className="size-3.5 text-emerald-600" />
                    <span>Chọn vị trí văn phòng / Tọa độ GPS</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-semibold text-emerald-700 bg-white border-emerald-300">
                    2 Vị trí sẵn có
                  </Badge>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-700 block">
                    Vị trí định vị mẫu (Preset Locations)
                  </label>
                  <SearchableSelect
                    value={`${punchLatitude},${punchLongitude}`}
                    onChange={(val) => {
                      const [lat, lng] = val.split(',');
                      if (lat && lng) {
                        setPunchLatitude(lat);
                        setPunchLongitude(lng);
                      }
                    }}
                    placeholder="Chọn địa điểm văn phòng..."
                    options={[
                      {
                        value: '10.776889,106.700806',
                        label: 'Trụ sở chính: Tòa nhà SVN Plaza - Quận 1, TP.HCM',
                        description: 'GPS: 10.776889, 106.700806 (Bán kính 100m)',
                      },
                      {
                        value: '21.028511,105.804817',
                        label: 'Chi nhánh Hà Nội: Tòa nhà Capital Center - Ba Đình, HN',
                        description: 'GPS: 21.028511, 105.804817 (Bán kính 80m)',
                      },
                    ]}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-600 block">Latitude (Vĩ độ)</label>
                    <Input
                      value={punchLatitude}
                      onChange={(e) => setPunchLatitude(e.target.value)}
                      className="text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-600 block">Longitude (Kinh độ)</label>
                    <Input
                      value={punchLongitude}
                      onChange={(e) => setPunchLongitude(e.target.value)}
                      className="text-xs font-mono"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Wi-Fi SSID (If Wi-Fi selected) */}
            {punchMethod === 'WIFI_WAN_IP' && (
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-slate-800">
                    <Wifi className="size-3.5 text-blue-600" />
                    <span>Mạng Wi-Fi văn phòng được duyệt</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-semibold text-blue-700 bg-white border-blue-300">
                    2 Mạng sẵn có
                  </Badge>
                </div>
                <SearchableSelect
                  value={punchWifiSsid}
                  onChange={(val) => setPunchWifiSsid(val)}
                  placeholder="Chọn mạng Wi-Fi văn phòng..."
                  options={[
                    {
                      value: 'SVN_OFFICE_CORP_5G',
                      label: 'SVN_OFFICE_CORP_5G (Trụ sở chính Tầng 8 & 9)',
                      description: 'BSSID: 18:e8:29:44:aa:01 • IP WAN: 118.69.182.102',
                    },
                    {
                      value: 'SVN_HN_BRANCH_SECURE',
                      label: 'SVN_HN_BRANCH_SECURE (Chi nhánh Hà Nội Tầng 12)',
                      description: 'BSSID: c4:ad:34:88:bb:02 • IP WAN: 14.241.120.45',
                    },
                  ]}
                />
                <Input
                  value={punchWifiSsid}
                  onChange={(e) => setPunchWifiSsid(e.target.value)}
                  placeholder="Nhập tên mạng SSID..."
                  className="text-xs font-mono"
                />
              </div>
            )}

            {/* Note / Simulation Meta */}
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-800 block">Ghi chú mô phỏng đính kèm</label>
              <Input
                value={punchNote}
                onChange={(e) => setPunchNote(e.target.value)}
                placeholder="Ví dụ: Test ca làm ngoài giờ, test multi-punch..."
                className="text-xs"
              />
            </div>
          </div>

          <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 cursor-pointer"
              onClick={() => setIsPunchModalOpen(false)}
              disabled={submittingPunch}
            >
              Hủy
            </Button>
            <Button
              size="sm"
              className="bg-[#021E73] hover:bg-blue-900 text-white text-xs font-semibold h-8 gap-1.5 cursor-pointer"
              onClick={handlePunchSubmit}
              disabled={submittingPunch}
            >
              {submittingPunch ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              <span>{submittingPunch ? 'Đang gửi payload...' : (punchType === 'CHECK_IN' ? 'Xác nhận Check-in' : 'Xác nhận Check-out')}</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
