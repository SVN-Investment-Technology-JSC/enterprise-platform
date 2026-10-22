'use client';

import type { ProjectArchiveSettings as Settings } from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';

/**
 * Cài đặt "Đóng hồ sơ dự án": có tự đóng hồ sơ (đưa vào Lưu trữ) khi mọi công việc của dự án đã hoàn thành hoặc
 * đã huỷ hay không. Đóng hồ sơ thủ công luôn dùng được, không phụ thuộc cài đặt này.
 */
export function ProjectArchiveSettings() {
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .loadProjectArchiveSettings()
      .then(setSettings)
      .catch((cause: { message?: string }) => setError(cause?.message ?? 'Không tải được cài đặt đóng hồ sơ.'));
  }, []);

  const choose = async (autoArchive: boolean) => {
    if (!settings || settings.autoArchive === autoArchive) return;
    const previous = settings;
    // Đổi ngay trên màn; lưu hỏng thì trả về lựa chọn cũ.
    setSettings({ ...settings, autoArchive });
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      setSettings(await api.saveProjectArchiveSettings({ autoArchive }));
      setNotice(
        autoArchive
          ? 'Đã bật: dự án tự đóng hồ sơ khi mọi công việc đã hoàn thành hoặc đã huỷ.'
          : 'Đã tắt: dự án chỉ đóng hồ sơ khi có người bấm "Đóng hồ sơ".',
      );
    } catch (cause) {
      setSettings(previous);
      setError((cause as { message?: string })?.message ?? 'Không lưu được cài đặt.');
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
      <p className={styles.muted}>Đang tải cài đặt…</p>
    );
  }

  return (
    <div className={styles.roleSettings}>
      <p className={styles.muted}>
        Đóng hồ sơ đưa dự án vào Lưu trữ và giữ nguyên trạng thái của dự án. Người có quyền luôn đóng hồ sơ thủ công
        được, kể cả khi còn công việc chưa xong.
        {settings.canEdit ? '' : ' Chỉ quản trị viên được đổi cài đặt này.'}
      </p>
      <fieldset className={styles.choiceGroup} disabled={!settings.canEdit || saving}>
        <legend>Tự đóng hồ sơ khi mọi công việc đã hoàn thành hoặc đã huỷ</legend>
        <label className={styles.checkbox}>
          <input
            type="radio"
            name="project-auto-archive"
            checked={settings.autoArchive}
            onChange={() => void choose(true)}
          />
          Có
        </label>
        <label className={styles.checkbox}>
          <input
            type="radio"
            name="project-auto-archive"
            checked={!settings.autoArchive}
            onChange={() => void choose(false)}
          />
          Không
        </label>
      </fieldset>
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
