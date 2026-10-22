'use client';

import {
  PROJECT_CODE_TOKENS,
  formatProjectCode,
  normalizeProjectCodeTemplate,
  projectCodeParts,
  projectCodeTemplateError,
  type ProjectCodeSettings as Settings,
  type ProjectGroup,
} from '@enterprise-platform/contracts-workspace';
import { useEffect, useRef, useState } from 'react';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { Field } from './dialog';
import { upperCaseKeepingCaret } from './upper-case-input';

/** Ví dụ trên màn cài đặt dùng năm và tháng hiện tại. */
const today = new Date();

/**
 * Cài đặt "Mã dự án": quy tắc sinh mã cho dự án mới, vd `DA_{NHOM}_{SO:4}` → DA_DVTN_0001 hay
 * `DA_{NAM}_{SO:3}` → DA_2026_001. Mã do hệ thống cấp khi tạo dự án, người tạo không sửa được; đổi quy tắc không
 * đổi mã các dự án đã có.
 */
export function ProjectCodeSettings() {
  const [settings, setSettings] = useState<Settings>();
  const [groups, setGroups] = useState<readonly ProjectGroup[]>([]);
  const [template, setTemplate] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .loadProjectCodeRule()
      .then((loaded) => {
        setSettings(loaded);
        setTemplate(loaded.template);
      })
      .catch((cause: { message?: string }) => setError(cause?.message ?? 'Không tải được quy tắc mã dự án.'));
    api
      .listProjectGroups()
      .then((list) => setGroups(list.items))
      .catch(() => setGroups([]));
  }, []);

  const canEdit = settings?.canEdit ?? false;
  const normalized = normalizeProjectCodeTemplate(template);
  const problem = template ? projectCodeTemplateError(normalized) : undefined;
  const usesGroup = normalized.includes('{NHOM}');
  const changed = Boolean(settings) && normalized !== settings?.template;

  /** Chèn token vào chỗ con trỏ đang đứng trong ô quy tắc. */
  const insert = (token: string) => {
    const element = input.current;
    const start = element?.selectionStart ?? template.length;
    const end = element?.selectionEnd ?? template.length;
    const next = `${template.slice(0, start)}${token}${template.slice(end)}`;
    setTemplate(next);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const example = (group?: ProjectGroup): string => {
    try {
      return formatProjectCode(
        projectCodeParts(normalized, {
          year: today.getFullYear(),
          month: today.getMonth() + 1,
          ...(group?.code ? { groupCode: group.code } : {}),
          ...(group ? { groupName: group.name } : {}),
        }),
        1,
      );
    } catch (cause) {
      return (cause as Error).message;
    }
  };

  const save = async () => {
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const saved = await api.saveProjectCodeRule({ template: normalized });
      setSettings(saved);
      setTemplate(saved.template);
      setNotice('Đã lưu quy tắc. Dự án tạo từ giờ dùng quy tắc mới; mã dự án đã có giữ nguyên.');
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được quy tắc mã dự án.');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return error ? (
      <p role="alert" className={styles.alert}>
        {error}
      </p>
    ) : (
      <p className={styles.muted}>Đang tải quy tắc mã dự án…</p>
    );
  }

  return (
    <div className={styles.roleSettings}>
      <p className={styles.muted}>
        Mã dự án do hệ thống cấp khi tạo dự án theo quy tắc dưới đây; người tạo không sửa được. Số thứ tự đếm riêng
        theo phần đứng trước nó: mỗi nhóm một dãy khi quy tắc có {'{NHOM}'}, mỗi năm một dãy khi có {'{NAM}'}.
        {canEdit ? '' : ' Chỉ quản trị viên được đổi quy tắc.'}
      </p>

      <Field label="Quy tắc mã dự án" hint={settings.isDefault ? 'Đang dùng quy tắc mặc định.' : undefined}>
        <input
          ref={input}
          value={template}
          disabled={!canEdit}
          maxLength={64}
          placeholder="Ví dụ: DA_{NHOM}_{SO:4}"
          onChange={(event) => setTemplate(upperCaseKeepingCaret(event))}
        />
      </Field>

      {canEdit ? (
        <div className={styles.codeTokens}>
          {PROJECT_CODE_TOKENS.map((entry) => (
            <button
              key={entry.token}
              type="button"
              className={styles.buttonSmall}
              title={entry.label}
              onClick={() => insert(entry.token)}
            >
              {entry.token}
            </button>
          ))}
        </div>
      ) : null}

      <ul className={styles.codeTokenHelp}>
        {PROJECT_CODE_TOKENS.map((entry) => (
          <li key={entry.token}>
            <code>{entry.token}</code> {entry.label}
          </li>
        ))}
      </ul>

      {problem ? (
        <p role="alert" className={styles.alert}>
          {problem}
        </p>
      ) : (
        <div className={styles.codeExamples}>
          <strong>Ví dụ mã dự án đầu tiên</strong>
          {usesGroup ? (
            groups.length > 0 ? (
              <ul>
                {groups.map((group) => (
                  <li key={group.id}>
                    <span>{group.name}</span>
                    {group.code ? (
                      <code>{example(group)}</code>
                    ) : (
                      <em>Chưa có mã viết tắt — đặt ở Cài đặt &gt; Nhóm dự án</em>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>Chưa có nhóm dự án nào; quy tắc có {'{NHOM}'} cần nhóm có mã viết tắt.</p>
            )
          ) : (
            <code>{example()}</code>
          )}
        </div>
      )}

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}

      {canEdit ? (
        <div>
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={saving || !changed || Boolean(problem)}
            onClick={() => void save()}
          >
            {saving ? 'Đang lưu…' : 'Lưu quy tắc'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
