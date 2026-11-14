'use client';

import type { CorrespondenceConfig, CorrespondenceDirectory, DispatchUnit, LetterAssignment } from '@enterprise-platform/contracts-correspondence';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { X } from 'lucide-react';
import styles from '../correspondence.module.scss';
import { SelectField } from './form-dialog';

/** Một phòng ban được chọn: cả phòng cùng nhận (`handlerUserId` rỗng) hay một người xử lý. */
export interface UnitPick {
  readonly unitId: string;
  readonly handlerUserId: string;
}

/** Gợi ý ban đầu: phòng đã giao lượt trước, không có thì phòng ban gợi ý của loại văn bản. */
export function suggestedUnits(
  config: CorrespondenceConfig,
  kind: string,
  assignments: readonly Pick<LetterAssignment, 'unitId' | 'handlerUserId'>[] = [],
): UnitPick[] {
  if (assignments.length > 0) return assignments.map((item) => ({ unitId: item.unitId, handlerUserId: item.handlerUserId ?? '' }));
  const defaults = config.catalog.find((item) => item.kind === 'letter_type' && item.code === kind)?.defaultUnitIds ?? [];
  return defaults.map((unitId) => ({ unitId, handlerUserId: '' }));
}

export function unitsPayload(units: readonly UnitPick[]): DispatchUnit[] {
  return units.map((item) => ({ unitId: item.unitId, handlerUserId: item.handlerUserId || undefined }));
}

/** Cấu hình "phải chọn người xử lý" mà còn phòng chưa chọn người. */
export function missingHandler(config: CorrespondenceConfig, units: readonly UnitPick[]): boolean {
  return config.settings.dispatchMode === 'handler' && units.some((unit) => !unit.handlerUserId);
}

/**
 * Chọn phòng ban cho bước "phòng ban xử lý" kế tiếp: tìm và thêm phòng theo sơ đồ tổ chức, mỗi
 * phòng cả phòng cùng nhận hoặc một người xử lý (bắt buộc khi cấu hình yêu cầu).
 */
export function UnitsPicker({
  label,
  config,
  directory,
  units,
  onChange,
}: {
  readonly label: string;
  readonly config: CorrespondenceConfig;
  readonly directory?: CorrespondenceDirectory;
  readonly units: readonly UnitPick[];
  readonly onChange: (units: UnitPick[]) => void;
}) {
  const mustPickHandler = config.settings.dispatchMode === 'handler';
  const all = directory?.units ?? [];
  const byId = new Map(all.map((unit) => [unit.id, unit]));
  return (
    <>
      <SelectField label={label} required>
        <SearchableSelect
          options={all
            .filter((unit) => !units.some((item) => item.unitId === unit.id))
            .map((unit) => ({ value: unit.id, label: unit.name, description: [unit.path, `${unit.members.length} người`].filter(Boolean).join(' · ') }))}
          value=""
          placeholder="Tìm và thêm phòng ban theo sơ đồ tổ chức"
          emptyText={directory?.degraded ? 'Chưa đọc được sơ đồ tổ chức, thử lại sau.' : 'Không còn phòng ban nào để thêm.'}
          onChange={(value) => value && onChange([...units, { unitId: value, handlerUserId: '' }])}
        />
      </SelectField>
      {units.length > 0 ? (
        <div className={styles.unitPicks}>
          {units.map((pick) => {
            const unit = byId.get(pick.unitId);
            const members = unit?.members ?? [];
            const heads = members.filter((member) => member.isHead);
            return (
              <div key={pick.unitId} className={styles.unitPick}>
                <div className={styles.unitPickHead}>
                  <div className={styles.listMain}>
                    <b>{unit?.name ?? 'Phòng ban không còn trong sơ đồ'}</b>
                    <span className={styles.hint}>
                      {members.length} người · Trưởng đơn vị: {heads.map((member) => member.name).join(', ') || 'chưa có'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Bỏ ${unit?.name ?? 'phòng ban'}`}
                    onClick={() => onChange(units.filter((item) => item.unitId !== pick.unitId))}
                  >
                    <X size={14} />
                  </button>
                </div>
                <SearchableSelect
                  options={members.map((member) => ({
                    value: member.userId,
                    label: member.name,
                    description: [member.positionName, member.isHead ? 'Trưởng đơn vị' : undefined].filter(Boolean).join(' · ') || undefined,
                  }))}
                  value={pick.handlerUserId}
                  placeholder={mustPickHandler ? 'Chọn người xử lý (bắt buộc)' : 'Cả phòng cùng nhận (hoặc chọn một người xử lý)'}
                  clearable
                  emptyText="Phòng chưa có ai trong sơ đồ tổ chức."
                  onChange={(value) => onChange(units.map((item) => (item.unitId === pick.unitId ? { ...item, handlerUserId: value ?? '' } : item)))}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
