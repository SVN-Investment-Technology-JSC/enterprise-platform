'use client';

import type { ProjectReportGroup } from '@enterprise-platform/contracts-workspace';
import { ChevronDown, PieChart } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { listProjectReportGroups } from '../workspace-api';
import { Choice } from './choice';
import { Tooltip } from './tooltip';
import styles from './project-report-group.module.scss';

const EMPTY_LABEL = 'Chưa có nhóm báo cáo';

export interface ProjectReportGroupChipProps {
  /** `metadata.reportGroupId` của dự án; id không còn trong danh mục (nhóm đã xoá) coi là chưa phân nhóm. */
  readonly reportGroupId?: string | null;
  /** Người xem được đổi nhóm (thành viên dự án, người tạo, quản trị). Server vẫn kiểm lại. */
  readonly canEdit?: boolean;
  /** Lưu nhóm mới (`null` là bỏ nhóm). Ném lỗi thì hộp chọn giữ nguyên và hiện lời lỗi. */
  readonly onChange?: (reportGroupId: string | null) => Promise<void>;
}

/**
 * Chip nhỏ "Nhóm báo cáo: …" trong hàng thông tin của khối đầu dự án. Nhóm báo cáo chỉ dùng khi xuất báo cáo doanh thu
 * theo lĩnh vực nên không chiếm cột ở danh sách dự án. Người được sửa bấm vào chip để chọn nhóm khác trong một hộp nhỏ.
 * Tenant chưa lập danh mục thì chip vẫn hiện "Chưa có nhóm báo cáo" và chỉ đường tới Cài đặt > Nhóm báo cáo, để người dùng biết
 * chỗ gán nhóm.
 */
export function ProjectReportGroupChip({ reportGroupId, canEdit = false, onChange }: ProjectReportGroupChipProps) {
  const [groups, setGroups] = useState<readonly ProjectReportGroup[]>();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  /** Tăng mỗi lần mở hộp chọn để nạp lại danh mục. */
  const [reload, setReload] = useState(0);
  const box = useRef<HTMLLIElement>(null);
  const editable = canEdit && Boolean(onChange);

  // Nạp danh mục khi gắn, và nạp lại mỗi lần mở hộp chọn để thấy nhóm quản trị vừa thêm.
  useEffect(() => {
    let alive = true;
    listProjectReportGroups()
      .then((list) => alive && setGroups(list.items))
      .catch(() => alive && setGroups((known) => known ?? []));
    return () => {
      alive = false;
    };
  }, [reload]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!groups) return null;

  const current = groups.find((group) => group.id === reportGroupId);
  const label = current ? `Nhóm báo cáo: ${current.name}` : EMPTY_LABEL;

  const pick = async (value: string) => {
    const next = value || null;
    if (next === (current?.id ?? null)) {
      setOpen(false);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await onChange?.(next);
      setOpen(false);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không đổi được nhóm báo cáo.');
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <>
      <PieChart size={13} aria-hidden />
      <span className={current ? undefined : styles.empty}>{label}</span>
    </>
  );

  return (
    <li ref={box} className={styles.anchor}>
      {editable ? (
        <Tooltip content="Đổi nhóm báo cáo (dùng khi xuất báo cáo doanh thu theo lĩnh vực)">
          <button
            type="button"
            className={`${styles.chip} ${styles.chipButton}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            disabled={saving}
            onClick={() => {
              setError(undefined);
              if (!open) setReload((value) => value + 1);
              setOpen(!open);
            }}
          >
            {content}
            <ChevronDown size={12} aria-hidden />
          </button>
        </Tooltip>
      ) : (
        <Tooltip content="Nhóm báo cáo (dùng khi xuất báo cáo doanh thu theo lĩnh vực)">
          <span className={styles.chip}>{content}</span>
        </Tooltip>
      )}
      {open && editable ? (
        <div className={styles.popover} role="dialog" aria-label="Chọn nhóm báo cáo">
          <p className={styles.popoverTitle}>Nhóm báo cáo</p>
          <Choice
            label="Nhóm báo cáo"
            value={current?.id ?? ''}
            emptyOption={EMPTY_LABEL}
            options={groups.map((group) => ({ value: group.id, label: group.name }))}
            disabled={saving}
            height={32}
            onChange={(value) => void pick(value)}
          />
          {groups.length === 0 ? (
            <p className={styles.hint}>
              Chưa có nhóm nào. Quản trị viên tạo danh mục ở{' '}
              <a href="#settings/project-report-groups">Cài đặt &gt; Nhóm báo cáo</a> (ví dụ Dịch vụ, Thí nghiệm, Bán hàng, O&amp;M).
            </p>
          ) : null}
          {error ? (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
