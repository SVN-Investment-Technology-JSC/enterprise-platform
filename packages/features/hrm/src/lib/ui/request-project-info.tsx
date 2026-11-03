'use client';

import type { ReactNode } from 'react';
import { DetailField } from './my-requests-view';
import {
  PROJECT_LINK_STATUS_LABEL,
  PROJECT_STATUS_LABEL,
  projectLabel,
  type LinkableProject,
} from '../workspace-projects';

type Raw = Record<string, unknown>;

export interface RequestProjectView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** Trạng thái dự án ở Workspace; chỉ có khi người xem tham gia dự án. */
  readonly projectStatus?: string;
  readonly linkStatus?: string;
  readonly projectRequestCode?: string;
  readonly rejectionReason?: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Gom thông tin "Dự án liên quan" của một đơn từ mọi nơi server có thể trả:
 * `projectLink` (bản Workspace xác nhận), cột `projectId`/`projectName` của đơn,
 * hoặc `attributes` (đơn làm thêm giờ). Danh sách dự án người xem tham gia bổ sung
 * mã, tên và trạng thái khi đơn chỉ lưu mã định danh.
 */
export function resolveRequestProject(
  details: Raw | undefined,
  projects: readonly LinkableProject[],
): RequestProjectView | null {
  if (!details) return null;
  const attributes = (details.attributes ?? {}) as Raw;
  const link = (details.projectLink ?? undefined) as Raw | undefined;

  const id = text(link?.projectId) || text(details.projectId) || text(attributes.projectId);
  const known = id ? projects.find((project) => project.id === id) : undefined;
  const code = text(link?.projectCode) || text(details.projectCode) || text(attributes.projectCode) || known?.code || '';
  const name = text(link?.projectName) || text(details.projectName) || text(attributes.projectName) || known?.name || '';
  if (!id && !code && !name) return null;

  return {
    id,
    code,
    name,
    projectStatus: known?.status,
    linkStatus: text(link?.status) || undefined,
    projectRequestCode: text(link?.projectRequestCode) || undefined,
    rejectionReason: text(link?.rejectionReason) || undefined,
  };
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span>{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

/** Thẻ "Dự án liên quan" trong chi tiết đơn, dùng chung cho đơn làm thêm giờ và đơn công tác. */
export function RequestProjectInfo({
  details,
  projects,
}: {
  readonly details: Raw | undefined;
  readonly projects: readonly LinkableProject[];
}) {
  const project = resolveRequestProject(details, projects);
  if (!project) return null;

  const title = projectLabel(project) || project.id;
  const projectStatus = project.projectStatus
    ? (PROJECT_STATUS_LABEL[project.projectStatus] ?? project.projectStatus)
    : '';
  const linkStatus = project.linkStatus
    ? (PROJECT_LINK_STATUS_LABEL[project.linkStatus] ?? project.linkStatus)
    : '';

  return (
    <div
      data-testid="detail-project"
      className="space-y-1.5 rounded-md border border-blue-200 bg-blue-50/60 p-2.5"
    >
      <Row label="Dự án liên quan:">
        <strong className="text-blue-900">{title}</strong>
      </Row>
      {project.code && project.name ? (
        <Row label="Mã dự án:">
          <span className="font-mono text-slate-800">{project.code}</span>
        </Row>
      ) : null}
      {projectStatus ? (
        <Row label="Trạng thái dự án:">
          <span className="font-semibold text-slate-800">{projectStatus}</span>
        </Row>
      ) : null}
      {project.projectRequestCode ? (
        <Row label="Mã đơn trong dự án:">
          <span className="font-mono text-slate-800">{project.projectRequestCode}</span>
        </Row>
      ) : null}
      {linkStatus ? (
        <Row label="Ghi nhận ở Workspace:">
          <span
            className={
              project.linkStatus === 'REJECTED' ? 'font-semibold text-red-700' : 'font-semibold text-slate-800'
            }
          >
            {linkStatus}
          </span>
        </Row>
      ) : null}
      {project.linkStatus === 'REJECTED' && project.rejectionReason ? (
        <Row label="Lý do từ chối:">
          <span className="text-red-700">{project.rejectionReason}</span>
        </Row>
      ) : null}
    </div>
  );
}

/** Tên dự án để hiện trong thẻ chi tiết đơn; rỗng khi đơn không gắn dự án. */
export function requestProjectName(
  details: Raw | undefined,
  projects: readonly LinkableProject[] = [],
): string {
  const project = resolveRequestProject(details, projects);
  return project ? project.name || project.code || project.id : '';
}

/** Dòng "Dự án" trong khung chi tiết đơn bên phải danh sách: chỉ tên dự án. */
export function RequestProjectField({
  details,
  projects,
}: {
  readonly details: Raw | undefined;
  readonly projects: readonly LinkableProject[];
}) {
  const name = requestProjectName(details, projects);
  if (!name) return null;

  return (
    <DetailField label="Dự án" testId="card-project">
      {name}
    </DetailField>
  );
}
