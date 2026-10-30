'use client';

import {
  DEFAULT_PROJECT_TASK_TITLES,
  type ChatOnArchivedPolicy,
  type ProjectArchiveSettings as Settings,
  type ReopenProjectPolicy,
  type SaveProjectArchiveSettingsRequest,
} from '@enterprise-platform/contracts-workspace';
import { useEffect, useState, type ReactNode } from 'react';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { TaskTitleListEditor } from './task-title-list-editor';

/** Một dòng cài đặt: nhãn và mô tả bên trái, điều khiển bên phải. */
function SettingRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className={styles.settingRow}>
      <div className={styles.settingText}>
        <strong>{label}</strong>
        <span className={styles.fieldHint}>{hint}</span>
      </div>
      <div className={styles.settingControl}>{children}</div>
    </div>
  );
}

/** Nút gạt Bật / Tắt cho cài đặt có hai khả năng và nghĩa "có hoặc không". */
function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`${styles.switchTrack} ${checked ? styles.switchOn : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.switchThumb} />
      <span className={styles.switchText}>{checked ? 'Bật' : 'Tắt'}</span>
    </button>
  );
}

/** Nhóm nút chọn một trong nhiều khả năng, mỗi khả năng có nhãn riêng. */
function RadioGroup<T extends string>({
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  name: string;
  value: T;
  options: readonly { readonly value: T; readonly label: string }[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className={styles.settingRadios} disabled={disabled}>
      {options.map((option) => (
        <label key={option.value} className={styles.checkbox}>
          <input
            type="radio"
            name={name}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

const REOPEN_PROJECT_OPTIONS: readonly { value: ReopenProjectPolicy; label: string }[] = [
  { value: 'reactivate', label: 'Đưa dự án về Đang chạy' },
  { value: 'keep', label: 'Giữ nguyên trạng thái Hoàn thành' },
];

const CHAT_ON_ARCHIVED_OPTIONS: readonly { value: ChatOnArchivedPolicy; label: string }[] = [
  { value: 'block', label: 'Chặn, chỉ đọc lại tin cũ' },
  { value: 'allow', label: 'Vẫn cho nhắn tin' },
];

/**
 * Cấu hình chung của Workspace: những lựa chọn có từ hai khả năng trở lên và áp cho cả tenant. Mỗi thay đổi lưu ngay,
 * lưu hỏng thì trả về lựa chọn cũ. Dự án đã lưu trữ luôn chỉ xem; các lựa chọn dưới đây chỉ quyết định phần còn lại của
 * vòng đời lưu trữ.
 */
export function GeneralSettings() {
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  /** Danh sách công việc mẫu đang soạn; chỉ lưu khi bấm "Lưu danh sách". */
  const [templateTitles, setTemplateTitles] = useState<string[]>([]);

  useEffect(() => {
    api
      .loadProjectArchiveSettings()
      .then((loaded) => {
        setSettings(loaded);
        setTemplateTitles([...loaded.defaultTaskTitles]);
      })
      .catch((cause: { message?: string }) => setError(cause?.message ?? 'Không tải được cấu hình chung.'));
  }, []);

  const save = async (patch: SaveProjectArchiveSettingsRequest, message: string) => {
    if (!settings) return;
    const previous = settings;
    // Đổi ngay trên màn; lưu hỏng thì trả về lựa chọn cũ.
    setSettings({ ...settings, ...patch });
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const saved = await api.saveProjectArchiveSettings(patch);
      setSettings(saved);
      // Chỉ nạp lại danh sách khi chính lần lưu này là lưu danh sách: bật tắt công tắc hay đổi nút chọn không được xoá
      // phần đang soạn dở.
      if (patch.defaultTaskTitles !== undefined) setTemplateTitles([...saved.defaultTaskTitles]);
      setNotice(message);
    } catch (cause) {
      setSettings(previous);
      setError((cause as { message?: string })?.message ?? 'Không lưu được cấu hình.');
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
      <p className={styles.muted}>Đang tải cấu hình…</p>
    );
  }

  const locked = !settings.canEdit || saving;
  const cleanedTemplate = templateTitles.map((title) => title.trim()).filter(Boolean);
  const templateDirty = JSON.stringify(cleanedTemplate) !== JSON.stringify(settings.defaultTaskTitles);

  return (
    <div className={styles.roleSettings}>
      <p className={styles.muted}>
        Cấu hình áp dụng cho mọi dự án của tenant. Dự án đã lưu trữ chỉ xem; muốn chỉnh sửa phải mở lưu trữ trước.
        {settings.canEdit ? '' : ' Chỉ quản trị viên được đổi cấu hình này.'}
      </p>

      <section className={styles.settingGroup} aria-label="Tạo dự án">
        <h4>Tạo dự án</h4>

        <SettingRow
          label="Tự tạo sẵn công việc khi tạo dự án"
          hint="Bật thì form tạo dự án điền sẵn danh sách công việc mẫu bên dưới và tạo chúng cùng dự án. Người tạo vẫn thêm hoặc bớt được cho từng dự án. Tắt thì dự án mới trống."
        >
          <Switch
            label="Tự tạo sẵn công việc"
            checked={settings.defaultTasksEnabled}
            disabled={locked}
            onChange={(defaultTasksEnabled) =>
              void save(
                { defaultTasksEnabled },
                defaultTasksEnabled
                  ? 'Đã bật: dự án mới tự tạo sẵn công việc theo danh sách mẫu.'
                  : 'Đã tắt: dự án mới không tự tạo sẵn công việc.',
              )
            }
          />
        </SettingRow>

        <div className={`${styles.settingRow} ${styles.settingRowStack}`}>
          <div className={styles.settingText}>
            <strong>Danh sách công việc mẫu</strong>
            <span className={styles.fieldHint}>
              Mỗi dòng là một công việc cấp gốc, tạo theo đúng thứ tự này, chưa giao ai. Tối đa 30 công việc.
            </span>
          </div>
          <TaskTitleListEditor
            idPrefix="Công việc mẫu"
            titles={templateTitles}
            disabled={locked}
            emptyText="Danh sách đang trống: bật tự tạo sẵn cũng không tạo công việc nào."
            onChange={setTemplateTitles}
          />
          {settings.canEdit ? (
            <div className={styles.settingActions}>
              <button
                type="button"
                className={styles.buttonPrimary}
                disabled={locked || !templateDirty}
                onClick={() =>
                  void save({ defaultTaskTitles: cleanedTemplate }, 'Đã lưu danh sách công việc mẫu.')
                }
              >
                Lưu danh sách
              </button>
              <button
                type="button"
                className={styles.buttonGhost}
                disabled={locked}
                onClick={() => setTemplateTitles([...DEFAULT_PROJECT_TASK_TITLES])}
              >
                Dùng mẫu gợi ý
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section className={styles.settingGroup} aria-label="Lưu trữ dự án">
        <h4>Lưu trữ dự án</h4>

        <SettingRow
          label="Tự đóng hồ sơ khi mọi công việc đã xong"
          hint="Dự án có mọi công việc hoàn thành hoặc đã huỷ tự vào Lưu trữ. Đóng hồ sơ thủ công luôn dùng được, kể cả khi còn việc chưa xong."
        >
          <Switch
            label="Tự đóng hồ sơ"
            checked={settings.autoArchive}
            disabled={locked}
            onChange={(autoArchive) =>
              void save(
                { autoArchive },
                autoArchive
                  ? 'Đã bật: dự án tự đóng hồ sơ khi mọi công việc đã hoàn thành hoặc đã huỷ.'
                  : 'Đã tắt: dự án chỉ đóng hồ sơ khi có người bấm "Đóng hồ sơ".',
              )
            }
          />
        </SettingRow>

        <SettingRow
          label="Khi mở lưu trữ dự án đã Hoàn thành"
          hint="Dự án đã Hoàn thành luôn nằm trong Lưu trữ. Mở lại để chỉnh sửa thì chọn đưa dự án về Đang chạy, hay chỉ bỏ dấu lưu trữ và giữ trạng thái Hoàn thành."
        >
          <RadioGroup
            name="reopen-project"
            value={settings.reopenProject}
            options={REOPEN_PROJECT_OPTIONS}
            disabled={locked}
            onChange={(reopenProject) =>
              void save(
                { reopenProject },
                reopenProject === 'reactivate'
                  ? 'Đã lưu: mở lưu trữ dự án Hoàn thành thì dự án về Đang chạy.'
                  : 'Đã lưu: mở lưu trữ dự án Hoàn thành thì dự án giữ nguyên trạng thái.',
              )
            }
          />
        </SettingRow>

        <SettingRow
          label="Trao đổi trong dự án đã lưu trữ"
          hint="Chặn thì không ai nhắn, sửa hay thu hồi tin được, chỉ đọc lại. Vẫn cho nhắn thì thành viên dự án tiếp tục trao đổi dù dự án đã lưu trữ."
        >
          <RadioGroup
            name="chat-on-archived"
            value={settings.chatOnArchived}
            options={CHAT_ON_ARCHIVED_OPTIONS}
            disabled={locked}
            onChange={(chatOnArchived) =>
              void save(
                { chatOnArchived },
                chatOnArchived === 'allow'
                  ? 'Đã lưu: dự án đã lưu trữ vẫn nhắn tin được.'
                  : 'Đã lưu: dự án đã lưu trữ không nhắn tin được.',
              )
            }
          />
        </SettingRow>
      </section>

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
    </div>
  );
}
