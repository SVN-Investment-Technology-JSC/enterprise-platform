'use client';

import type {
  OpportunityPromotion,
  QuotePromotionSnapshot,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { useEffect, useMemo, useState } from 'react';
import {
  errorMessage,
  listOpportunityPromotions,
  saveQuotePromotions,
} from '../crm-api';
import {
  PROMOTION_NOT_DEDUCTED_NOTE,
  QUOTE_PROMOTIONS_NO_PROJECT,
  promotionOption,
  sameIdSet,
  snapshotLabel,
} from '../promotions.model';
import styles from '../sales.module.scss';

/**
 * Khuyến mãi của báo giá: chọn nhiều từ tập của dự án, lưu một lần (PUT thay toàn bộ) kèm `revision`.
 * Khoá khi `editable = false` (phiên bản không phải Nháp hoặc không có quyền): chỉ hiện ảnh chụp đã áp.
 */
export function QuotePromotionsPanel({
  quoteId,
  opportunityId,
  versionNo,
  revision,
  applied,
  editable,
  onSaved,
}: {
  quoteId: string;
  opportunityId: string | null;
  versionNo: number;
  revision: number;
  applied: readonly QuotePromotionSnapshot[];
  editable: boolean;
  /** Gọi sau khi lưu để màn cha tải lại báo giá (lấy `revision` mới). */
  onSaved: () => void;
}) {
  const [projectSet, setProjectSet] = useState<readonly OpportunityPromotion[]>(
    [],
  );
  const [chosen, setChosen] = useState<string[]>(
    applied.map((item) => item.catalogId),
  );
  const [picker, setPicker] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const appliedKey = applied.map((item) => item.catalogId).join(',');
  useEffect(() => {
    setChosen(appliedKey ? appliedKey.split(',') : []);
  }, [appliedKey, revision]);

  useEffect(() => {
    if (!editable || !opportunityId) return;
    listOpportunityPromotions(opportunityId)
      .then((rows) => {
        setProjectSet(rows);
        setError(undefined);
      })
      .catch((cause) =>
        setError(errorMessage(cause, 'Không tải được khuyến mãi của dự án.')),
      );
  }, [editable, opportunityId]);

  const labelOf = useMemo(() => {
    const labels = new Map<string, string>();
    for (const item of applied) labels.set(item.catalogId, snapshotLabel(item));
    for (const item of projectSet)
      labels.set(
        item.catalog.id,
        snapshotLabel({ ...item.catalog, catalogId: item.catalog.id }),
      );
    return labels;
  }, [applied, projectSet]);
  const options = useMemo(
    () =>
      projectSet
        .filter(
          (item) => item.catalog.effective && !chosen.includes(item.catalog.id),
        )
        .map((item) => promotionOption(item.catalog)),
    [projectSet, chosen],
  );
  const dirty = !sameIdSet(
    chosen,
    applied.map((item) => item.catalogId),
  );

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      await saveQuotePromotions(quoteId, versionNo, {
        catalogIds: chosen,
        revision,
      });
      toast.success('Đã lưu khuyến mãi của báo giá.');
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được khuyến mãi của báo giá.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.panel} aria-label="Khuyến mãi">
      <h3 className={styles.sectionTitle}>Khuyến mãi</h3>
      <p className={styles.muted}>{PROMOTION_NOT_DEDUCTED_NOTE}</p>
      {!opportunityId ? (
        <p className={styles.muted}>{QUOTE_PROMOTIONS_NO_PROJECT}</p>
      ) : null}
      {error ? <p className={styles.alert}>{error}</p> : null}
      {editable && opportunityId ? (
        <>
          {chosen.length ? (
            <ul aria-label="Khuyến mãi đã chọn">
              {chosen.map((id) => (
                <li key={id}>
                  {labelOf.get(id) ?? id}{' '}
                  <button
                    type="button"
                    className={styles.rowActionDanger}
                    onClick={() =>
                      setChosen((current) =>
                        current.filter((item) => item !== id),
                      )
                    }
                  >
                    Bỏ chọn
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>Chưa chọn khuyến mãi nào.</p>
          )}
          <SearchableSelect
            options={options}
            value={picker}
            placeholder="Thêm khuyến mãi của dự án"
            emptyText="Dự án không còn khuyến mãi nào để chọn. Thêm ở chi tiết dự án."
            onChange={(next) => {
              if (!next) return;
              setChosen((current) =>
                current.includes(next) ? current : [...current, next],
              );
              setPicker('');
            }}
          />
          <button
            type="button"
            className={styles.buttonGhost}
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            Lưu khuyến mãi
          </button>
        </>
      ) : applied.length ? (
        <ul aria-label="Khuyến mãi đã áp">
          {applied.map((item) => (
            <li key={item.catalogId}>{snapshotLabel(item)}</li>
          ))}
        </ul>
      ) : opportunityId ? (
        <p className={styles.muted}>
          Phiên bản này không có khuyến mãi. Chỉ sửa được khi phiên bản ở trạng
          thái Nháp.
        </p>
      ) : null}
    </section>
  );
}
