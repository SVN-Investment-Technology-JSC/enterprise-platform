'use client';

import { AppIcon } from '@enterprise-platform/shared-ui';
import { Building2, ClipboardCheck, GitFork, ListChecks, Package, Users, Wrench } from 'lucide-react';

/**
 * Icon của Bảng điều khiển có thể thay bằng icon thương hiệu. Bảng điều khiển là
 * server component nên không truyền được component lucide làm `fallback` trực
 * tiếp; các bao bọc client này giữ nguyên icon cũ khi quản trị chưa gán icon.
 */

export function UsersQuickIcon() {
  return <AppIcon slot="nav.users" fallback={Users} className="size-4" />;
}

export function OrganizationQuickIcon() {
  return <AppIcon slot="nav.organization" fallback={Building2} className="size-4" />;
}

export function ApplicationsQuickIcon() {
  return <AppIcon slot="nav.applications" fallback={Package} className="size-4" />;
}

export function ApprovalsCardIcon() {
  return <AppIcon slot="dashboard.approvals" fallback={ClipboardCheck} className="size-4" />;
}

export function ProcedureTasksCardIcon() {
  return <AppIcon slot="dashboard.procedure-tasks" fallback={GitFork} className="size-4" />;
}

export function WorkTodoCardIcon() {
  return <AppIcon slot="dashboard.work-todo" fallback={ListChecks} className="size-4" />;
}

export function MaintenanceIncidentsCardIcon() {
  return <AppIcon slot="dashboard.maintenance-incidents" fallback={Wrench} className="size-4" />;
}

export function LowStockCardIcon() {
  return <AppIcon slot="dashboard.low-stock" fallback={Package} className="size-4" />;
}
