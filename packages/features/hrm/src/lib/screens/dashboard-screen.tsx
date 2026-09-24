'use client';

import {
  AlertTriangle,
  BadgeCheck,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  FileCheck2,
  FilePlus,
  HeartHandshake,
  Lock,
  PartyPopper,
  Smartphone,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { toast } from '../ui/toast';

export default function HrmDashboardPage() {
  const [currentTime, setCurrentTime] = useState('08:30:15');
  const [isCheckedIn] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }),
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* Top action row */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
            Trung tâm Vận hành & Chấm công
          </span>
          <h2 className="text-xl font-bold tracking-tight text-slate-950 mt-0.5">
            Tổng quan Quân số & Chấm công Toàn diện
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Theo dõi quân số hiện diện thời gian thực, tiến độ bảng công và xử lý các trường hợp ngoại lệ.
          </p>
        </div>
        <div className="flex items-center flex-wrap gap-2.5">
          <div className="inline-flex items-center gap-2 border border-slate-200 bg-white px-3 py-1.5 rounded-md text-xs font-medium text-slate-700 shadow-sm">
            <Calendar className="size-3.5 text-blue-600" />
            <span>Hôm nay: Thứ Năm, 24/10/2026</span>
          </div>
          <Button
            size="sm"
            className="bg-[#2563eb] hover:bg-blue-700 text-white font-semibold text-xs shadow-sm gap-1.5 rounded-md h-9"
            onClick={() =>
              toast.add({
                title: 'Tạo đơn nhanh',
                description: 'Vui lòng chọn loại đơn từ cần gửi (Phép / OT / Giải trình chấm công).',
                type: 'info',
              })
            }
          >
            <FilePlus className="size-3.5" />
            <span>Tạo đơn nhanh</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs font-semibold text-slate-700 shadow-sm gap-1.5 border-slate-300 hover:bg-slate-50 rounded-md h-9"
            onClick={() =>
              toast.add({
                title: 'Xuất báo cáo',
                description: 'Đang kết xuất báo cáo quân số & chấm công tổng hợp...',
                type: 'info',
              })
            }
          >
            <Download className="size-3.5 text-slate-500" />
            <span>Xuất báo cáo</span>
          </Button>
        </div>
      </div>

      {/* Horizontal Sub-tabs Navigation */}
      <div className="border-b border-slate-200">
        <div className="flex space-x-8 text-xs font-semibold">
          <div className="border-b-2 border-blue-600 text-blue-600 py-3 px-1 flex items-center gap-2 cursor-pointer">
            <TrendingUp className="size-4" />
            <span>Tổng quan hôm nay</span>
            <span className="size-1.5 rounded-full bg-blue-600" />
          </div>
          <a
            href="/shifts"
            className="border-b-2 border-transparent text-slate-500 hover:text-slate-900 py-3 px-1 flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Calendar className="size-4" />
            <span>Lịch làm việc & Ca kíp</span>
          </a>
          <a
            href="/approvals"
            className="border-b-2 border-transparent text-slate-500 hover:text-slate-900 py-3 px-1 flex items-center gap-2 transition-colors cursor-pointer"
          >
            <FileCheck2 className="size-4" />
            <span>Việc cần xử lý</span>
            <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold bg-rose-100 text-rose-700 rounded-full border border-rose-200">
              12
            </span>
          </a>
        </div>
      </div>

      {/* Row 1: Check-in Box & Attendance Roster Summary */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* User live punch card (5 cols) */}
        <div className="xl:col-span-5 bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start mb-3">
            <div className="flex items-center space-x-3">
              <div className="size-11 rounded-full bg-slate-100 text-[#091426] flex items-center justify-center font-bold text-base border border-slate-200">
                NA
              </div>
              <div>
                <div className="text-xs font-bold text-slate-900">
                  Nguyễn Văn An (Kỹ sư Cơ điện)
                </div>
                <div className="text-[11px] text-slate-500 flex items-center gap-1">
                  <Clock className="size-3 text-emerald-600" />
                  <span>Ca hành chính: 08:00 - 17:30</span>
                </div>
              </div>
            </div>
            {isCheckedIn ? (
              <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border border-emerald-200 text-[10px] font-semibold gap-1">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Đã Check-in 07:55
              </Badge>
            ) : (
              <Badge variant="outline" className="text-slate-500 text-[10px]">
                Chưa Check-in
              </Badge>
            )}
          </div>

          <div className="bg-slate-50/80 rounded-lg border border-slate-200 p-4 mb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <Clock className="size-7 text-[#2563eb]" />
              <div>
                <div className="text-2xl font-black tracking-tight text-slate-900 font-mono">
                  {currentTime}
                </div>
                <div className="text-[11px] text-slate-500 font-medium">
                  Thời gian máy chủ chấm công
                </div>
              </div>
            </div>
            <div className="flex flex-col items-start sm:items-end gap-1.5">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled
                  variant="outline"
                  className="text-xs font-semibold shadow-none gap-1.5 rounded-md border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                >
                  <Lock className="size-3.5 text-slate-400" />
                  <span>Check-in / Out trên App</span>
                </Button>
              </div>
              <span className="text-[11px] text-slate-500 flex items-center gap-1 font-medium">
                <Smartphone className="size-3 text-blue-600" />
                Chỉ cho phép quẹt thẻ trên ứng dụng Di động (Mobile)
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 px-1">
            <span className="flex items-center gap-1 text-[11px]">
              <BadgeCheck className="size-3.5 text-emerald-600" />
              <span>Vị trí: VP SVN DTS - IP Wi-Fi hợp lệ</span>
            </span>
            <span className="text-[11px] text-blue-600 font-medium cursor-pointer hover:underline">
              Lịch sử chấm công
            </span>
          </div>
        </div>

        {/* Company Attendance Overview (7 cols) */}
        <div className="xl:col-span-7 bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Users className="size-4 text-blue-600" />
              <span>Quân số hôm nay (Toàn công ty)</span>
            </h3>
            <span className="text-xs text-slate-500 font-medium">
              Cập nhật: 08:30 sáng
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-emerald-50/60 border border-emerald-100 rounded-lg p-3 text-center">
              <div className="text-[11px] font-medium text-emerald-800 mb-0.5">
                Đi làm thực tế
              </div>
              <div className="text-2xl font-bold text-emerald-700">
                142<span className="text-xs font-normal text-slate-500">/150</span>
              </div>
              <div className="text-[10px] font-semibold text-emerald-600 mt-1">
                94.7% quân số
              </div>
            </div>
            <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-3 text-center">
              <div className="text-[11px] font-medium text-blue-800 mb-0.5">
                Nghỉ có phép
              </div>
              <div className="text-2xl font-bold text-blue-700">
                5 <span className="text-xs font-normal text-slate-500">NS</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                Theo đơn duyệt
              </div>
            </div>
            <div className="bg-amber-50/60 border border-amber-100 rounded-lg p-3 text-center">
              <div className="text-[11px] font-medium text-amber-800 mb-0.5">
                Đi muộn / Về sớm
              </div>
              <div className="text-2xl font-bold text-amber-700">
                3 <span className="text-xs font-normal text-slate-500">NS</span>
              </div>
              <div className="text-[10px] text-amber-600 font-semibold mt-1">
                Cần giải trình
              </div>
            </div>
            <div className="bg-rose-50/60 border border-rose-100 rounded-lg p-3 text-center">
              <div className="text-[11px] font-medium text-rose-800 mb-0.5">
                Vắng không phép
              </div>
              <div className="text-2xl font-bold text-rose-700">
                0 <span className="text-xs font-normal text-slate-500">NS</span>
              </div>
              <div className="text-[10px] text-emerald-600 font-semibold mt-1">
                Đạt chỉ tiêu
              </div>
            </div>
          </div>

          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden flex">
            <div className="bg-emerald-500 h-full" style={{ width: '94.7%' }} />
            <div className="bg-blue-500 h-full" style={{ width: '3.3%' }} />
            <div className="bg-amber-400 h-full" style={{ width: '2%' }} />
          </div>
          <div className="flex justify-between items-center text-[11px] text-slate-500 mt-2">
            <span>142 Đúng giờ</span>
            <span>5 Nghỉ phép</span>
            <span>3 Đi muộn/ngoại lệ</span>
          </div>
        </div>
      </div>

      {/* Row 2: 4 KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="shadow-sm border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Tổng quân số
              </span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
                <Users className="size-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              150 <span className="text-xs font-normal text-slate-500">nhân sự</span>
            </div>
            <div className="text-[11px] text-emerald-600 font-medium mt-1 flex items-center gap-1">
              <TrendingUp className="size-3.5" />
              <span>+2 tuyển mới tháng này</span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Đơn chờ phê duyệt
              </span>
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <FileCheck2 className="size-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-amber-600">
              8 <span className="text-xs font-normal text-slate-500">đơn</span>
            </div>
            <div className="text-[11px] text-slate-500 font-medium mt-1">
              Phép: 5 • OT: 2 • Giải trình: 1
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Quỹ công kỳ này
              </span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 className="size-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-900">96.2%</div>
            <div className="text-[11px] text-emerald-600 font-medium mt-1 flex items-center gap-1">
              <BadgeCheck className="size-3.5" />
              <span>Đạt chuẩn kế hoạch đề ra</span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Cảnh báo ngoại lệ
              </span>
              <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                <AlertTriangle className="size-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-rose-600">
              3 <span className="text-xs font-normal text-slate-500">trường hợp</span>
            </div>
            <div className="text-[11px] text-rose-600 font-medium mt-1 flex items-center gap-1">
              <span>Cần rà soát chấm công</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Exceptions Table & Pending Tasks + Celebrations */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left column (7 cols): Exceptions and Department summary */}
        <div className="xl:col-span-7 flex flex-col gap-6">
          {/* Exceptions Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="size-4 text-rose-600" />
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                  Cảnh báo ngoại lệ chấm công (Exceptions)
                </h3>
              </div>
              <Badge variant="outline" className="text-slate-600 text-[11px]">
                Hôm nay • 3 sự việc
              </Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#f8fafc] text-[11px] text-slate-500 uppercase border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Nhân sự / Phòng ban</th>
                    <th className="py-2.5 px-3 font-semibold">Vấn đề phát hiện</th>
                    <th className="py-2.5 px-3 font-semibold">Mức độ</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  <tr className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">Trần Văn Nam</div>
                      <div className="text-[11px] text-slate-500">Kỹ thuật xưởng • Plant KD</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-rose-600 font-medium">Quên quẹt thẻ ra hôm qua (23/10)</span>
                    </td>
                    <td className="py-3 px-3">
                      <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 text-[10px]">
                        Khẩn cấp
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7 px-2.5 text-blue-700"
                        onClick={() =>
                          toast.add({
                            title: 'Tạo giải trình',
                            description: 'Đã gửi thông báo yêu cầu nhân sự tạo đơn giải trình.',
                            type: 'info',
                          })
                        }
                      >
                        Tạo giải trình
                      </Button>
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">Lê Thị Hương</div>
                      <div className="text-[11px] text-slate-500">Kinh doanh • Văn phòng HN</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-amber-600 font-medium">Check-in ngoài phạm vi GPS (0.8km)</span>
                    </td>
                    <td className="py-3 px-3">
                      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 text-[10px]">
                        Cảnh báo
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7 px-2.5 text-blue-700"
                        onClick={() =>
                          toast.add({
                            title: 'Kiểm tra tọa độ GPS',
                            description: 'Vị trí ghi nhận: 21.0285° N, 105.8542° E. Đang chờ nhân sự đính kèm giải trình.',
                            type: 'info',
                          })
                        }
                      >
                        Kiểm tra
                      </Button>
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">Hoàng Minh Tuấn</div>
                      <div className="text-[11px] text-slate-500">Vận hành thiết bị • Plant SB</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-amber-600 font-medium">Làm thêm giờ (OT) chưa đăng ký trước</span>
                    </td>
                    <td className="py-3 px-3">
                      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 text-[10px]">
                        Cảnh báo
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7 px-2.5 text-blue-700"
                        onClick={() =>
                          toast.add({
                            title: 'Duyệt bổ sung OT',
                            description: 'Đã mở phê duyệt đơn làm thêm giờ bù cho ca trực.',
                            type: 'info',
                          })
                        }
                      >
                        Duyệt bổ sung
                      </Button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Attendance by department */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <span>Tỷ lệ có mặt theo phòng ban</span>
              </h3>
              <span className="text-xs text-blue-600 font-medium cursor-pointer hover:underline">
                Xem chi tiết
              </span>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="w-40 font-medium text-slate-800">Khối Văn phòng (HQ)</div>
                <div className="flex-1 mx-3 bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-full rounded-full" style={{ width: '98%' }} />
                </div>
                <div className="w-20 text-right font-semibold text-slate-900">44/45 (98%)</div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <div className="w-40 font-medium text-slate-800">Nhà máy Plant KD</div>
                <div className="flex-1 mx-3 bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-full rounded-full" style={{ width: '94%' }} />
                </div>
                <div className="w-20 text-right font-semibold text-slate-900">58/62 (94%)</div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <div className="w-40 font-medium text-slate-800">Nhà máy Plant HN</div>
                <div className="flex-1 mx-3 bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-full rounded-full" style={{ width: '93%' }} />
                </div>
                <div className="w-20 text-right font-semibold text-slate-900">40/43 (93%)</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right column (5 cols): Urgent approvals & Birthdays */}
        <div className="xl:col-span-5 flex flex-col gap-6">
          {/* Urgent Approvals */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center space-x-2">
                <FileCheck2 className="size-4 text-blue-600" />
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                  Đơn từ cần duyệt gấp
                </h3>
              </div>
              <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px]">
                3 chờ xử lý
              </Badge>
            </div>

            <div className="space-y-3">
              <div className="p-3 bg-slate-50/60 hover:bg-slate-100/50 border border-slate-200/70 rounded-lg transition-colors">
                <div className="flex justify-between items-start mb-1">
                  <div className="font-semibold text-xs text-slate-900">
                    Nguyễn Văn An • Đơn xin nghỉ phép
                  </div>
                  <span className="text-[10px] text-slate-400">10 phút trước</span>
                </div>
                <div className="text-xs text-slate-600 mb-2">
                  Nghỉ 01 ngày (25/10) - Lý do: Việc gia đình cá nhân
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 h-7 bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-medium"
                    onClick={() =>
                      toast.add({
                        title: 'Duyệt thành công',
                        description: 'Đã duyệt đơn nghỉ phép của Nguyễn Văn An.',
                        type: 'success',
                      })
                    }
                  >
                    Duyệt nhanh
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs text-slate-600"
                    onClick={() =>
                      toast.add({
                        title: 'Chi tiết đơn từ',
                        description: 'Mã đơn: REQ-LEAVE-2026-089. Trạng thái: Chờ duyệt cấp 1.',
                        type: 'info',
                      })
                    }
                  >
                    Xem chi tiết
                  </Button>
                </div>
              </div>

              <div className="p-3 bg-slate-50/60 hover:bg-slate-100/50 border border-slate-200/70 rounded-lg transition-colors">
                <div className="flex justify-between items-start mb-1">
                  <div className="font-semibold text-xs text-slate-900">
                    Trần Thị Bình • Đăng ký làm thêm (OT)
                  </div>
                  <span className="text-[10px] text-slate-400">35 phút trước</span>
                </div>
                <div className="text-xs text-slate-600 mb-2">
                  OT 2.5 giờ tối nay (24/10) - Kiểm kê kho định kỳ
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 h-7 bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-medium"
                    onClick={() =>
                      toast.add({
                        title: 'Duyệt thành công',
                        description: 'Đã duyệt đăng ký OT của Trần Thị Bình.',
                        type: 'success',
                      })
                    }
                  >
                    Duyệt nhanh
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs text-slate-600"
                    onClick={() =>
                      toast.add({
                        title: 'Chi tiết đơn từ',
                        description: 'Mã đơn: REQ-OT-2026-042. Hệ số: 1.5x.',
                        type: 'info',
                      })
                    }
                  >
                    Xem chi tiết
                  </Button>
                </div>
              </div>

              <div className="p-3 bg-slate-50/60 hover:bg-slate-100/50 border border-slate-200/70 rounded-lg transition-colors">
                <div className="flex justify-between items-start mb-1">
                  <div className="font-semibold text-xs text-slate-900">
                    Lê Hoàng Chung • Giải trình chấm công
                  </div>
                  <span className="text-[10px] text-slate-400">1 giờ trước</span>
                </div>
                <div className="text-xs text-slate-600 mb-2">
                  Bổ sung Check-out 23/10 (Do mất kết nối mạng máy quẹt vân tay)
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 h-7 bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-medium"
                    onClick={() =>
                      toast.add({
                        title: 'Duyệt thành công',
                        description: 'Đã bổ sung giờ check-out cho Lê Hoàng Chung.',
                        type: 'success',
                      })
                    }
                  >
                    Duyệt nhanh
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs text-slate-600"
                    onClick={() =>
                      toast.add({
                        title: 'Chi tiết đơn từ',
                        description: 'Mã đơn: REQ-ATT-2026-015. Bổ sung lúc 17:35.',
                        type: 'info',
                      })
                    }
                  >
                    Xem chi tiết
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Celebrations & Birthdays */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center space-x-2">
                <PartyPopper className="size-4 text-amber-500" />
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                  Sự kiện & Sinh nhật tháng này
                </h3>
              </div>
              <span className="text-xs text-blue-700 font-medium">Tháng 10</span>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between p-2.5 bg-amber-50/50 border border-amber-100 rounded-lg">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-xs">
                    ĐQ
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      Đặng Quang Dũng
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Phòng Kế toán • Sinh nhật hôm nay (24/10)
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs border-amber-200 text-amber-700 hover:bg-amber-100/50"
                  onClick={() =>
                    toast.add({
                      title: 'Đã gửi lời chúc',
                      description: 'Thiệp chúc mừng sinh nhật đã được gửi đến Đặng Quang Dũng!',
                      type: 'success',
                    })
                  }
                >
                  Chúc mừng
                </Button>
              </div>

              <div className="flex items-center justify-between p-2.5 bg-slate-50/60 border border-slate-200/70 rounded-lg">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-800 flex items-center justify-center font-bold text-xs">
                    <HeartHandshake className="size-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      Kỷ niệm 3 năm cống hiến
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Phạm Thanh Nga • Chuyên viên Nhân sự
                    </div>
                  </div>
                </div>
                <Badge variant="outline" className="text-blue-700 text-[10px] font-bold">
                  3 năm
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
