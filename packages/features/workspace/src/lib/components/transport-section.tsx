'use client';

import { TransportField } from '@enterprise-platform/shared-ui';
import styles from '../workspace.module.scss';
import { Field } from './dialog';
import type { SourceTransportState } from './use-source-transport';

const NOTE =
  'Xe được giữ trên Lịch xe của HRM ngay khi lưu; bỏ chọn, huỷ hoặc xoá thì xe được trả lại.';

/**
 * Khối "Phương tiện di chuyển" của form công việc và lịch họp: chọn xe công ty (xe và tài xế còn trống) hoặc
 * phương tiện tự sắp xếp, kèm điểm đến và trạng thái đặt xe mà HRM đã trả lời.
 * `editableRange`: nơi dùng chưa có giờ riêng cho chuyến (công việc chỉ có ngày) nên cho nhập giờ đi, giờ về.
 */
export function TransportSection({
  state,
  editableRange,
  idPrefix,
}: {
  readonly state: SourceTransportState;
  readonly editableRange: boolean;
  readonly idPrefix: string;
}) {
  const status = state.bookingStatus;
  return (
    <div>
      <TransportField
        idPrefix={idPrefix}
        value={state.value}
        onChange={state.setValue}
        range={state.range}
        onRangeChange={editableRange ? state.setRange : undefined}
        availability={state.availability}
        loading={state.loading}
        error={state.error}
        note={NOTE}
      />
      {state.value.mode === 'COMPANY_VEHICLE' ? (
        <Field label="Điểm đến">
          <input
            value={state.destination}
            maxLength={255}
            placeholder="Ví dụ: Trạm biến áp 500kV Phố Nối"
            onChange={(event) => state.setDestination(event.target.value)}
          />
        </Field>
      ) : null}
      {status?.status === 'CONFIRMED' ? <p className={styles.muted}>HRM đã giữ xe cho lựa chọn này.</p> : null}
      {status?.status === 'REQUESTED' ? <p className={styles.muted}>Đã gửi HRM, đang chờ giữ xe.</p> : null}
      {status?.status === 'CONFLICT' ? (
        <p role="alert" className={styles.muted} style={{ color: '#b91c1c', fontWeight: 600 }}>
          {status.reason ?? 'Xe đã có người đặt trước.'} Hãy chọn xe hoặc giờ khác rồi lưu lại.
        </p>
      ) : null}
    </div>
  );
}
