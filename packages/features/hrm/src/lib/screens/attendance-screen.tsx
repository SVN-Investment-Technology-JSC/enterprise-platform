'use client';

import {
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  History,
  Info,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  MapPin,
  QrCode,
  ScanFace,
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

type AttendanceSubTab = 'checkin' | 'logs';

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
  const [loading, setLoading] = useState(true);

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

  // Fetch real profile & attendances from API
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
        }
      }

      // 2. Fetch attendance logs
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
                      Ca làm việc: ----
                    </h3>
                    <Badge className="text-[10px] font-semibold text-slate-600 bg-slate-100 border border-slate-200">
                      Chưa phân ca
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Mã ca: <strong>----</strong> • Chu kỳ: ----
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="bg-white p-2.5 rounded-lg border border-blue-100">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Khung giờ làm</span>
                  <span className="font-bold text-slate-900 text-xs">----</span>
                  <span className="text-[11px] text-slate-500 block">Nghỉ trưa: ----</span>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-blue-100">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Quy tắc đi muộn</span>
                  <span className="font-semibold text-slate-700 text-xs">----</span>
                  <span className="text-[11px] text-slate-500 block">Dung sai: ----</span>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-blue-100">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Quy tắc về sớm</span>
                  <span className="font-semibold text-slate-700 text-xs">----</span>
                  <span className="text-[11px] text-slate-500 block">Dung sai: ----</span>
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
                    IP: <strong>----</strong>
                  </span>
                  <span className="text-slate-300">•</span>
                  <span className="flex items-center gap-1 text-slate-600">
                    <MapPin className="size-3.5" />
                    GPS: <strong>----</strong>
                  </span>
                </div>
              </div>

              {/* Mobile App Restriction Banner & Disabled Punch Actions */}
              <div className="space-y-4 pt-2">
                <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-start sm:items-center gap-3">
                    <div className="size-9 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                      <Smartphone className="size-5" />
                    </div>
                    <div className="space-y-0.5">
                      <div className="font-bold text-slate-900 flex items-center gap-1.5">
                        <span>Chính sách điểm danh di động (Mobile Only)</span>
                        <Badge variant="outline" className="bg-white text-amber-800 border-amber-300 text-[10px] font-semibold">
                          Chỉ có trên App
                        </Badge>
                      </div>
                      <p className="text-slate-600 text-[11px]">
                        Theo quy định an toàn nhân sự, tính năng quẹt thẻ Check-in / Check-out trực tiếp trên nền tảng Web đã được vô hiệu hóa. Vui lòng sử dụng <strong>Ứng dụng Di động SVN HRM (iOS / Android)</strong> kết hợp GPS & FaceID để thực hiện điểm danh.
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] text-slate-500 border-slate-300 bg-white gap-1 shrink-0 self-start sm:self-auto">
                    <Lock className="size-3 text-slate-400" />
                    Web Read-only
                  </Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Status Box */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col items-center text-center">
                    <div className={`size-10 rounded-full flex items-center justify-center mb-2 ${todayAttendance?.checkInAt ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                      <CheckCircle2 className="size-5" />
                    </div>
                    <span className="text-xs text-slate-500 uppercase font-bold">CHECK-IN VÀO CA (HÔM NAY)</span>
                    <div className={`text-base font-extrabold font-mono mt-0.5 ${todayAttendance?.checkInAt ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {todayAttendance?.checkInAt ? `ĐÃ GHI NHẬN: ${todayInTime}` : 'CHƯA GHI NHẬN'}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                      {todayAttendance?.checkInAt ? (
                        <>
                          <CheckCircle2 className="size-3.5 text-emerald-600" />
                          {todayAttendance.status === 'LATE' ? 'Ghi nhận đi muộn' : 'Hợp lệ'}
                        </>
                      ) : (
                        'Chưa có dữ liệu quẹt thẻ hôm nay'
                      )}
                    </p>
                  </div>

                  {/* Disabled Web Punch Button */}
                  <div className="bg-slate-50/90 border border-slate-200 rounded-xl p-6 flex flex-col items-center text-center justify-center space-y-2 opacity-80">
                    <div className="size-10 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center">
                      <Lock className="size-5" />
                    </div>
                    <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">
                      {isCheckedInToday ? 'KẾT THÚC CA LÀM' : 'BẮT ĐẦU VÀO CA'}
                    </span>
                    <Button
                      disabled
                      variant="outline"
                      className="w-full bg-slate-200/80 border-slate-300 text-slate-500 font-bold text-xs h-9 cursor-not-allowed shadow-none"
                    >
                      <Lock className="size-3.5 mr-1" />
                      {isCheckedInToday ? 'CHECK-OUT TRÊN APP DI ĐỘNG' : 'CHECK-IN TRÊN APP DI ĐỘNG'}
                    </Button>
                    <p className="text-[10px] text-slate-500">
                      Tính năng quẹt thẻ chỉ khả dụng trên ứng dụng SVN HRM Mobile
                    </p>
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
    </div>
  );
}
