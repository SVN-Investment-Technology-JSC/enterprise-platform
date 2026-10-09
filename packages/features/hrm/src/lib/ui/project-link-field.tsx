'use client';

import { SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  PROJECT_STATUS_LABEL,
  projectLabel,
  type LinkableProject,
} from '../workspace-projects';

/**
 * Trường "Dự án liên kết (Workspace)" của đơn từ.
 *
 * Là một trường dùng chung, không thuộc riêng loại đơn nào: loại đơn nào đặt
 * trường này vào form thì gửi kèm `projectId/projectCode/projectName`, và
 * backend tự đăng ký đơn sang Workspace (mã DTxxx). Khi form đơn thành dynamic,
 * kiểu trường này chỉ cần được ánh xạ tới component này.
 */
export function ProjectLinkField({
  projects,
  value,
  onChange,
  loading = false,
}: {
  readonly projects: readonly LinkableProject[];
  readonly value: string;
  readonly onChange: (project: LinkableProject | undefined) => void;
  readonly loading?: boolean;
}) {
  const selected = projects.find((project) => project.id === value);
  return (
    <div className="space-y-1">
      <label className="font-semibold text-slate-800 block">
        Dự án liên kết (Workspace)
      </label>
      <SearchableSelect
        options={projects.map((project) => ({
          value: project.id,
          label: projectLabel(project),
          description: PROJECT_STATUS_LABEL[project.status] ?? project.status,
        }))}
        value={value}
        onChange={(id) => onChange(projects.find((project) => project.id === id))}
        placeholder={loading ? 'Đang tải danh sách dự án…' : 'Không gắn dự án'}
        emptyText="Bạn chưa tham gia dự án nào bên Workspace"
        clearable
      />
      <p className="text-[11px] text-slate-500">
        {selected
          ? `Đơn sẽ được ghi vào tab "Đơn từ" của dự án ${selected.code} với mã DTxxx tự sinh.`
          : 'Chỉ hiện dự án bạn đang tham gia. Chọn dự án để đơn này được ghi nhận trong dự án đó.'}
      </p>
    </div>
  );
}
