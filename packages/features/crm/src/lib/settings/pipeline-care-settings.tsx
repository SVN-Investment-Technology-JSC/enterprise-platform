'use client';

import type { Pipeline } from '@enterprise-platform/contracts-crm';
import { toast } from '@enterprise-platform/shared-ui';
import { useEffect, useState } from 'react';
import { errorMessage, listPipelines, setPipelineCareSuggestion } from '../crm-api';
import styles from '../sales.module.scss';

/**
 * "Luồng bán hàng" (P2F-02): mỗi luồng có công tắc "Gợi ý chăm sóc lại khi Thua". Luồng chào thầu không
 * dùng gợi ý này. Chỉ `crm.manage` (trang Cấu hình đã giới hạn; server kiểm quyền lại). Màn cấu hình luồng
 * đầy đủ (GĐ G) sẽ thay hoặc gộp thành phần này.
 */
export function PipelineCareSettings() {
  const [pipelines, setPipelines] = useState<readonly Pipeline[]>([]);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    listPipelines()
      .then(setPipelines)
      .catch((cause) => setError(errorMessage(cause, 'Không tải được các luồng bán hàng.')));
  }, []);

  async function toggle(pipeline: Pipeline, enabled: boolean) {
    setBusyId(pipeline.id);
    setError(undefined);
    try {
      setPipelines(await setPipelineCareSuggestion(pipeline.id, enabled));
      toast.success('Đã lưu cấu hình luồng.');
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được cấu hình luồng.'));
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <section className={styles.panel} aria-label="Luồng bán hàng">
      <h2 className={styles.title}>Luồng bán hàng</h2>
      {error ? <p className={styles.alert}>{error}</p> : null}
      {pipelines.length === 0 && !error ? <p className={styles.muted}>Chưa có luồng bán hàng nào.</p> : null}
      {pipelines.map((pipeline) => {
        const tender = pipeline.profile === 'TENDER';
        return (
          <label key={pipeline.id} className={styles.checkbox}>
            <input
              type="checkbox"
              role="switch"
              checked={!tender && pipeline.careSuggestion}
              disabled={tender || busyId === pipeline.id}
              onChange={(event) => void toggle(pipeline, event.target.checked)}
            />
            <span>
              <strong>{pipeline.name}</strong>: Gợi ý chăm sóc lại khi Thua
              {tender ? ' (luồng chào thầu không dùng gợi ý này)' : ''}
            </span>
          </label>
        );
      })}
    </section>
  );
}
