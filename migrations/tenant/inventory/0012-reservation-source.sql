-- Giữ hàng theo chứng từ nguồn (INV-08, T1-07): Bán hàng giữ hàng cho đơn hoặc hợp
-- đồng qua API nội bộ, có khoá chống lặp. Thêm nguồn (`source_type`, `source_id`),
-- khoá chống lặp duy nhất và băm nội dung yêu cầu để gọi lại cùng khoá mà khác nội
-- dung thì trả 409. Index hạn giữ cho job nhả giữ hàng hết hạn (T1-10) chỉ phủ
-- giữ hàng đang mở. Giữ hàng cũ giữ nguyên, các cột mới để NULL.
-- Chạy lại được: mọi lệnh đều IF NOT EXISTS hoặc DROP ... IF EXISTS trước khi tạo.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE inventory_schema.reservations
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS source_id UUID,
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(200),
    ADD COLUMN IF NOT EXISTS request_hash VARCHAR(64);

-- NULL không trùng nhau nên giữ hàng cũ không có khoá vẫn hợp lệ.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reservations_idempotency_key
    ON inventory_schema.reservations(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_reservations_source
    ON inventory_schema.reservations(source_type, source_id)
    WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_active_expiry
    ON inventory_schema.reservations(expires_at)
    WHERE expires_at IS NOT NULL AND status IN ('RESERVED', 'PARTIALLY_ISSUED');

-- Không xuất quá phần đã giữ. NOT VALID: chỉ kiểm dòng ghi mới, không quét dữ liệu
-- cũ (dữ liệu cũ luôn có quantity_issued = 0 vì trước đây chưa code nào ghi cột này).
ALTER TABLE inventory_schema.reservation_items
    DROP CONSTRAINT IF EXISTS reservation_items_issued_within_reserved;
ALTER TABLE inventory_schema.reservation_items
    ADD CONSTRAINT reservation_items_issued_within_reserved
    CHECK (quantity_issued >= 0 AND quantity_issued <= quantity_reserved) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_stock_document_lines_reservation
    ON inventory_schema.stock_document_lines(reservation_id)
    WHERE reservation_id IS NOT NULL;
