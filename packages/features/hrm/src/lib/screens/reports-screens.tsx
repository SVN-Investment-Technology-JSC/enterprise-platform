'use client';
import { PageTitle } from '../ui/page-title';
import { ServerReportPanel } from '../ui/reports/server-report-panel';
import { TimesheetReportPanel } from '../ui/reports/timesheet-report-panel';
import type { ReactNode } from 'react';

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[calc(100dvh-11rem)] flex-col gap-3">
      <PageTitle title={title} description="Xuất báo cáo Excel theo thời gian, đối tượng và các cột cần dùng." withTabs />
      {children}
    </div>
  );
}

export function RequestsReportScreen() {
  return (
    <Page title="Báo cáo">
      <ServerReportPanel
        kind="requests"
        label="Tong hop don tu"
        description="Tổng hợp mọi loại đơn (nghỉ, làm thêm giờ, công tác, đổi ca, giải trình công) có thời gian nằm trong phạm vi đã chọn. Mỗi đơn một dòng."
        statusFilter
        kindFilter
      />
    </Page>
  );
}

export function LeaveUsageReportScreen() {
  return (
    <Page title="Báo cáo">
      <ServerReportPanel
        kind="leave-usage"
        label="Nghi phep da su dung"
        description="Số ngày phép đã dùng của từng nhân viên theo loại phép: đơn đã duyệt có ngày bắt đầu nằm trong phạm vi, kèm quỹ phép của năm chứa ngày kết thúc."
        leaveTypeFilter
      />
    </Page>
  );
}

export function LeaveReportScreen() {
  return (
    <Page title="Báo cáo">
      <ServerReportPanel
        kind="leave"
        label="Don nghi phep"
        description="Danh sách từng đơn nghỉ trong phạm vi đã chọn, kèm loại phép, thời gian, lý do và người duyệt."
        statusFilter
        leaveTypeFilter
      />
    </Page>
  );
}

export function OvertimeReportScreen() {
  return (
    <Page title="Báo cáo">
      <ServerReportPanel
        kind="overtime"
        label="Lam them gio"
        description="Đơn làm thêm giờ: khung giờ từng ngày, số giờ từng khoảng, tổng số giờ và dự án liên quan. Đơn nhiều khoảng gộp thành một dòng."
        statusFilter
      />
    </Page>
  );
}

export function BusinessTripReportScreen() {
  return (
    <Page title="Báo cáo">
      <ServerReportPanel
        kind="business-trips"
        label="Cong tac"
        description="Đơn công tác: mô tả, lý do, thời gian, số ngày và dự án liên quan."
        statusFilter
        withIndex
      />
    </Page>
  );
}

export function TimesheetReportScreen() {
  return (
    <Page title="Báo cáo">
      <TimesheetReportPanel />
    </Page>
  );
}
