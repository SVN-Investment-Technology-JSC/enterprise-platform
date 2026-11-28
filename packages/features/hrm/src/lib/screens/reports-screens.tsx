'use client';
import { PageTitle } from '../ui/page-title';
import { ServerReportPanel } from '../ui/reports/server-report-panel';
import { TimesheetReportPanel } from '../ui/reports/timesheet-report-panel';
import type { ReactNode } from 'react';

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[calc(100dvh-11rem)] flex-col gap-3">
      <PageTitle title={title} withTabs />
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
        description="Gồm mọi loại đơn có thời gian trong phạm vi; mỗi đơn một dòng."
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
        description="Tính đơn đã duyệt có ngày bắt đầu trong phạm vi."
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
        description="Đơn nhiều khoảng gộp thành một dòng."
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
