'use client';

import {
  ENVELOPE_STATUSES,
  ENVELOPE_STATUS_LABELS,
  type CorrespondenceDirectory,
  type EnvelopeStatus,
  type IntakeCheck,
  type LetterDetail,
} from '@enterprise-platform/contracts-correspondence';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import styles from '../correspondence.module.scss';
import { CheckGroup, Field, SelectField } from './form-dialog';

/** Phân loại sơ bộ dạng form (số để chuỗi cho ô nhập). */
export interface IntakeCheckValue {
  readonly envelopeStatus: EnvelopeStatus;
  readonly sealed: boolean;
  readonly pageCount: string;
  readonly copyCount: string;
  readonly addressedTo: string;
  readonly addressedUserId: string;
}

export function intakeCheckOf(letter?: Pick<LetterDetail, 'envelopeStatus' | 'sealed' | 'pageCount' | 'copyCount' | 'addressedTo' | 'addressedUserId'>): IntakeCheckValue {
  return {
    envelopeStatus: letter?.envelopeStatus ?? 'intact',
    sealed: letter?.sealed ?? false,
    pageCount: letter?.pageCount === undefined ? '' : String(letter.pageCount),
    copyCount: letter?.copyCount === undefined ? '' : String(letter.copyCount),
    addressedTo: letter?.addressedTo ?? '',
    addressedUserId: letter?.addressedUserId ?? '',
  };
}

/** Gửi lên API: ô trống là xoá giá trị (khi sửa) hay không ghi (khi tiếp nhận). */
export function intakeCheckPayload(value: IntakeCheckValue, restricted: boolean): IntakeCheck {
  return {
    envelopeStatus: value.envelopeStatus,
    sealed: restricted ? value.sealed : false,
    pageCount: value.pageCount === '' ? null : Number(value.pageCount),
    copyCount: value.copyCount === '' ? null : Number(value.copyCount),
    addressedTo: value.addressedTo.trim() || null,
    addressedUserId: value.addressedUserId || null,
  };
}

/**
 * Phân loại sơ bộ khi tiếp nhận (Nghị định 30): tình trạng bì, số tờ, số bản, dấu niêm phong của văn bản mật,
 * văn bản gửi đích danh. Dùng chung cho tiếp nhận và sửa thông tin.
 */
export function IntakeCheckFields({
  value,
  restricted,
  directory,
  onChange,
}: {
  readonly value: IntakeCheckValue;
  readonly restricted: boolean;
  readonly directory?: CorrespondenceDirectory;
  readonly onChange: (patch: Partial<IntakeCheckValue>) => void;
}) {
  return (
    <fieldset className={styles.fieldset}>
      <legend>Phân loại sơ bộ</legend>
      <div className={styles.formRow3}>
        <SelectField label="Tình trạng bì">
          <SearchableSelect
            options={ENVELOPE_STATUSES.map((status) => ({ value: status, label: ENVELOPE_STATUS_LABELS[status] }))}
            value={value.envelopeStatus}
            searchInDropdown
            hideDropdownSearch
            onChange={(status) => status && onChange({ envelopeStatus: status as EnvelopeStatus })}
          />
        </SelectField>
        <Field label="Số tờ">
          <input type="number" min={0} max={10000} value={value.pageCount} onChange={(event) => onChange({ pageCount: event.target.value })} />
        </Field>
        <Field label="Số bản">
          <input type="number" min={0} max={1000} value={value.copyCount} onChange={(event) => onChange({ copyCount: event.target.value })} />
        </Field>
      </div>
      {restricted ? (
        <CheckGroup label="Văn bản mật">
          <label className={styles.checkRow}>
            <input type="checkbox" checked={value.sealed} onChange={(event) => onChange({ sealed: event.target.checked })} />
            Dấu niêm phong còn nguyên
          </label>
        </CheckGroup>
      ) : null}
      <div className={styles.formRow}>
        <Field label="Gửi đích danh (cá nhân, tổ chức đoàn thể)">
          <input
            value={value.addressedTo}
            maxLength={255}
            placeholder="Để trống nếu gửi cơ quan"
            onChange={(event) => onChange({ addressedTo: event.target.value })}
          />
        </Field>
        <SelectField label="Người nhận đích danh trong hệ thống">
          <SearchableSelect
            options={(directory?.people ?? []).map((person) => ({ value: person.userId, label: person.name }))}
            value={value.addressedUserId}
            placeholder="Chọn nếu người nhận có tài khoản"
            clearable
            onChange={(userId) => onChange({ addressedUserId: userId ?? '' })}
          />
          <span className={styles.hint}>Người này nhận thông báo và xem được công văn.</span>
        </SelectField>
      </div>
    </fieldset>
  );
}
