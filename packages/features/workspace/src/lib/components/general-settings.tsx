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

/*
 * Cấu hình chung của Workspace, dựng theo bộ khung shadcn/ui (Card, Switch, Radio Group, Button). Workspace không chạy
 * Tailwind nên các khối này viết bằng SCSS cùng ngôn ngữ thiết kế, như `form-controls.tsx`.
 */

/** Một thẻ cấu hình: đầu thẻ (tên và mô tả), thân là các dòng ngăn bằng vạch mảnh, chân thẻ tuỳ chọn. */
function SettingsCard({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.gsCard} aria-label={title}>
      <header className={styles.gsHead}>
        <h3>{title}</h3>
        <p>{description}</p>
      </header>
      <div className={styles.gsBody}>{children}</div>
      {footer ? <footer className={styles.gsFoot}>{footer}</footer> : null}
    </section>
  );
}

/** Dòng cấu hình: nhãn và mô tả bên trái, nút gạt bên phải. */
function SettingRow({ label, hint, control }: { label: string; hint: string; control: ReactNode }) {
  return (
    <div className={styles.gsRow}>
      <div className={styles.gsRowText}>
        <strong>{label}</strong>
        <span>{hint}</span>
      </div>
      <div className={styles.gsRowControl}>{control}</div>
    </div>
  );
}

/** Nút gạt Bật / Tắt cho cài đặt hai khả năng mang nghĩa "có hoặc không". */
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
    <span className={styles.gsSwitchWrap}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`${styles.gsSwitch} ${checked ? styles.gsSwitchOn : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.gsSwitchThumb} />
      </button>
      <span className={styles.gsSwitchText}>{checked ? 'Bật' : 'Tắt'}</span>
    </span>
  );
}

interface ChoiceOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description: string;
}

/** Chọn một trong nhiều khả năng; mỗi khả năng có tên và một dòng giải thích hệ quả. */
function RadioChoices<T extends string>({
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  name: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className={styles.gsRadios} disabled={disabled}>
      {options.map((option) => (
        <label key={option.value} className={styles.gsRadio}>
          <input type="radio" name={name} checked={value === option.value} onChange={() => onChange(option.value)} />
          <span className={styles.gsRadioText}>
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

const REOPEN_PROJECT_OPTIONS: readonly ChoiceOption<ReopenProjectPolicy>[] = [
  {
    value: 'reactivate',
    label: 'Đưa dự án về Đang chạy',
    description: 'Dự án rời Lưu trữ và quay lại trạng thái Đang chạy để làm tiếp.',
  },
  {
    value: 'keep',
    label: 'Giữ nguyên trạng thái Hoàn thành',
    description: 'Chỉ bỏ dấu lưu trữ để chỉnh sửa; dự án vẫn ở trạng thái Hoàn thành.',
  },
];

const CHAT_ON_ARCHIVED_OPTIONS: readonly ChoiceOption<ChatOnArchivedPolicy>[] = [
  {
    value: 'block',
    label: 'Chặn nhắn tin',
    description: 'Không ai nhắn, sửa hay thu hồi tin được; chỉ đọc lại tin cũ.',
  },
  {
    value: 'allow',
    label: 'Vẫn cho nhắn tin',
    description: 'Thành viên tiếp tục trao đổi dù dự án đã lưu trữ.',
  },
];

/**
 * Cấu hình chung: những lựa chọn có từ hai khả năng trở lên và áp cho cả tenant, chia thẻ theo chủ đề. Mỗi thay đổi lưu
 * ngay (riêng danh sách công việc mẫu lưu bằng nút ở chân thẻ); lưu hỏng thì trả về lựa chọn cũ. Dự án đã lưu trữ luôn
 * chỉ xem; các lựa chọn ở đây chỉ quyết định phần còn lại của vòng đời lưu trữ.
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
    <div className={styles.gsStack}>
      {settings.canEdit ? null : (
        <p className={styles.gsNote}>Chỉ quản trị viên được đổi cấu hình này; bạn đang xem ở chế độ chỉ đọc.</p>
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

      <SettingsCard
        title="Tạo dự án"
        description="Công việc được tạo sẵn khi tạo dự án mới. Người tạo vẫn thêm hoặc bớt được cho từng dự án."
        footer={
          settings.canEdit ? (
            <>
              <button
                type="button"
                className={styles.buttonGhost}
                disabled={locked}
                onClick={() => setTemplateTitles([...DEFAULT_PROJECT_TASK_TITLES])}
              >
                Dùng mẫu gợi ý
              </button>
              <button
                type="button"
                className={styles.buttonPrimary}
                disabled={locked || !templateDirty}
                onClick={() => void save({ defaultTaskTitles: cleanedTemplate }, 'Đã lưu danh sách công việc mẫu.')}
              >
                Lưu danh sách
              </button>
            </>
          ) : undefined
        }
      >
        <SettingRow
          label="Tự tạo sẵn công việc khi tạo dự án"
          hint="Bật thì form tạo dự án điền sẵn danh sách mẫu bên dưới và tạo chúng cùng dự án. Tắt thì dự án mới trống."
          control={
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
          }
        />
        <div className={`${styles.gsRow} ${styles.gsRowStack}`}>
          <div className={styles.gsRowText}>
            <strong>Danh sách công việc mẫu</strong>
            <span>Mỗi dòng là một công việc cấp gốc, tạo theo đúng thứ tự này, chưa giao ai. Tối đa 30 công việc.</span>
          </div>
          <TaskTitleListEditor
            idPrefix="Công việc mẫu"
            titles={templateTitles}
            disabled={locked}
            emptyText="Danh sách đang trống: bật tự tạo sẵn cũng không tạo công việc nào."
            onChange={setTemplateTitles}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Lưu trữ dự án"
        description="Dự án đã lưu trữ chỉ xem; muốn chỉnh sửa phải mở lưu trữ trước. Các lựa chọn dưới đây quyết định phần còn lại của vòng đời lưu trữ."
      >
        <SettingRow
          label="Tự đóng hồ sơ khi mọi công việc đã xong"
          hint="Dự án có mọi công việc hoàn thành hoặc đã huỷ tự vào Lưu trữ. Đóng hồ sơ thủ công luôn dùng được, kể cả khi còn việc chưa xong."
          control={
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
          }
        />
        <div className={`${styles.gsRow} ${styles.gsRowStack}`}>
          <div className={styles.gsRowText}>
            <strong>Khi mở lưu trữ dự án đã Hoàn thành</strong>
            <span>Dự án đã Hoàn thành luôn nằm trong Lưu trữ. Chọn điều gì xảy ra khi mở lại để chỉnh sửa.</span>
          </div>
          <RadioChoices
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
        </div>
        <div className={`${styles.gsRow} ${styles.gsRowStack}`}>
          <div className={styles.gsRowText}>
            <strong>Trao đổi trong dự án đã lưu trữ</strong>
            <span>Áp dụng cho trao đổi cấp dự án và cấp công việc.</span>
          </div>
          <RadioChoices
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
        </div>
      </SettingsCard>
    </div>
  );
}
