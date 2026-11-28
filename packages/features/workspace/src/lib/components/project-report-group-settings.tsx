'use client';

import type { ProjectReportGroupList } from '@enterprise-platform/contracts-workspace';
import { toast } from '@enterprise-platform/shared-ui';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ErrorToast } from './error-toast';
import { Tooltip } from './tooltip';

/** Giới hạn giống server (xem `ProjectReportGroupService`). */
const MAX_GROUPS = 30;
const MAX_NAME = 80;

interface Row {
  /** Khoá React; nhóm đã lưu dùng luôn id. */
  readonly key: string;
  /** Vắng là nhóm mới, server cấp id khi lưu. */
  readonly id?: string;
  readonly name: string;
}

const rowsOf = (list: ProjectReportGroupList): Row[] =>
  list.items.map((group) => ({ key: group.id, id: group.id, name: group.name }));

/** Lỗi của danh sách đang sửa (trước khi gửi), cùng luật với server; rỗng là hợp lệ. */
export function reportGroupDraftError(rows: readonly { readonly name: string }[]): string | undefined {
  if (rows.length > MAX_GROUPS) return `Tối đa ${MAX_GROUPS} nhóm báo cáo.`;
  const seen = new Set<string>();
  for (const row of rows) {
    const name = row.name.trim().replace(/\s+/g, ' ');
    if (!name) return 'Tên nhóm báo cáo không được để trống.';
    if (name.length > MAX_NAME) return `Tên nhóm báo cáo không được dài quá ${MAX_NAME} ký tự.`;
    const folded = name.toLocaleLowerCase('vi');
    if (seen.has(folded)) return `Trùng tên nhóm báo cáo "${name}".`;
    seen.add(folded);
  }
  return undefined;
}

/**
 * Cài đặt "Nhóm báo cáo": danh mục lĩnh vực dùng khi xuất báo cáo doanh thu (ví dụ Dịch vụ, Thí nghiệm, Bán hàng,
 * O&M), độc lập với nhóm dự án. Sửa cả danh sách tại chỗ (thêm, đổi tên, xoá, đổi thứ tự) rồi bấm Lưu. Đổi tên giữ
 * nguyên nhóm của các dự án; xoá nhóm thì dự án của nhóm về chưa phân nhóm. Người không phải quản trị chỉ xem.
 */
export function ProjectReportGroupSettings() {
  const [list, setList] = useState<ProjectReportGroupList>();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const nextKey = useRef(0);

  useEffect(() => {
    api
      .listProjectReportGroups()
      .then((result) => {
        setList(result);
        setRows(rowsOf(result));
      })
      .catch((cause: { message?: string }) =>
        setError(cause?.message ?? 'Không tải được danh sách nhóm báo cáo.'),
      );
  }, []);

  const canEdit = list?.canEdit ?? false;
  const saved = list ? rowsOf(list) : [];
  const dirty =
    rows.length !== saved.length ||
    rows.some((row, index) => row.id !== saved[index]?.id || row.name.trim() !== saved[index]?.name);
  const removedCount = saved.filter((group) => !rows.some((row) => row.id === group.id)).length;
  const draftError = dirty ? reportGroupDraftError(rows) : undefined;

  const update = (key: string, name: string) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, name } : row)));
  const remove = (key: string) => setRows((current) => current.filter((row) => row.key !== key));
  const move = (index: number, delta: number) =>
    setRows((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target] as Row, next[index] as Row];
      return next;
    });
  const add = () => setRows((current) => [...current, { key: `new-${++nextKey.current}`, name: '' }]);

  const save = async () => {
    setSaving(true);
    try {
      const result = await api.saveProjectReportGroups({
        items: rows.map((row) => (row.id ? { id: row.id, name: row.name } : { name: row.name })),
      });
      setList(result);
      setRows(rowsOf(result));
      setError(undefined);
      toast.success('Đã lưu nhóm báo cáo.');
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được nhóm báo cáo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.roleSettings}>
      <div className={styles.roleSettingsHead}>
        {canEdit ? <span /> : <p className={styles.muted}>Chỉ quản trị viên được thêm hoặc sửa nhóm báo cáo.</p>}
        {canEdit ? (
          <span className={styles.roleActions}>
            <Button type="button" variant="outline" onClick={add} disabled={rows.length >= MAX_GROUPS}>
              <Plus aria-hidden /> Thêm nhóm
            </Button>
            <Button type="button" onClick={() => void save()} disabled={!dirty || Boolean(draftError) || saving}>
              {saving ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </span>
        ) : null}
      </div>

      <ErrorToast message={error} />

      {!list ? (
        error ? null : <p className={styles.muted}>Đang tải nhóm báo cáo…</p>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 48 }}>STT</th>
                <th>Nhóm báo cáo</th>
                {canEdit ? <th aria-label="Thao tác" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.key}>
                  <td className={styles.muted}>{index + 1}</td>
                  <td>
                    {canEdit ? (
                      <Input
                        value={row.name}
                        maxLength={MAX_NAME}
                        placeholder="Ví dụ: Dịch vụ"
                        aria-label={`Tên nhóm báo cáo ${index + 1}`}
                        onChange={(event) => update(row.key, event.target.value)}
                      />
                    ) : (
                      <b>{row.name}</b>
                    )}
                  </td>
                  {canEdit ? (
                    <td>
                      <span className={styles.roleActions}>
                        <Tooltip content="Lên trên">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label={`Đưa nhóm ${index + 1} lên trên`}
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUp aria-hidden />
                          </Button>
                        </Tooltip>
                        <Tooltip content="Xuống dưới">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label={`Đưa nhóm ${index + 1} xuống dưới`}
                            disabled={index === rows.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDown aria-hidden />
                          </Button>
                        </Tooltip>
                        <Tooltip content="Xoá nhóm">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            className="hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Xoá nhóm ${index + 1}`}
                            onClick={() => remove(row.key)}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </Tooltip>
                      </span>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? <p className={styles.emptyRow}>Chưa có nhóm báo cáo nào.</p> : null}
        </div>
      )}

      {canEdit && draftError ? (
        <p role="alert" className={styles.alert}>
          {draftError}
        </p>
      ) : null}
      {canEdit && removedCount > 0 ? (
        <p className={styles.muted}>
          Khi lưu, {removedCount} nhóm bị xoá; dự án đang gán nhóm đó sẽ về chưa phân nhóm báo cáo.
        </p>
      ) : null}
      {canEdit && dirty ? <p className={styles.muted}>Có thay đổi chưa lưu.</p> : null}
    </div>
  );
}
