-- Bán hàng (crm) · nền: schema `crm_schema`, cấu hình phân hệ, hàng chờ lệnh gửi
-- sang phân hệ khác (khoá chống lặp) và nhật ký chuyển trạng thái dùng chung cho
-- mọi máy trạng thái. Phân hệ mới, chưa có dữ liệu cũ.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS crm_schema;

-- ---------------------------------------------------------------------------
-- CẤU HÌNH
--
-- Mỗi khoá một dòng, giá trị JSON. `version` tăng mỗi lần lưu để hai người sửa
-- cùng lúc không ghi đè nhau (so version khi lưu).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.settings (
    key        VARCHAR(100) PRIMARY KEY,
    value      JSONB NOT NULL DEFAULT '{}'::jsonb,
    version    INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Rỗng khi hệ thống tự ghi (giá trị mặc định).
    updated_by UUID
);

-- ---------------------------------------------------------------------------
-- LỆNH GỬI SANG PHÂN HỆ KHÁC
--
-- Lệnh ghi sang Kho, Tài chính, Quy trình (giữ hàng, tạo phiếu thu...) được
-- lưu ở đây trong cùng transaction với thay đổi nghiệp vụ, rồi worker gửi và
-- thử lại theo lease. `idempotency_key` cũng là khoá bên nhận dùng để chống lặp,
-- nên gửi lại bao nhiêu lần vẫn chỉ có một kết quả.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.integration_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Phân hệ nhận: `inventory`, `finance`, `procedure-engine`...
    target          VARCHAR(64) NOT NULL,
    -- Thao tác, ví dụ `reservation.create`, `voucher-source.create`.
    operation       VARCHAR(100) NOT NULL,
    idempotency_key VARCHAR(200) NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    status          VARCHAR(16) NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
    attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    -- Worker đang giữ lệnh tới lúc này; quá hạn thì worker khác được nhận lại.
    lease_until     TIMESTAMPTZ,
    last_error      TEXT,
    result          JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_crm_integration_requests_idempotency UNIQUE (idempotency_key)
);

-- Worker tìm lệnh đến lượt: theo trạng thái, lease đã hết.
CREATE INDEX IF NOT EXISTS ix_crm_integration_requests_due
    ON crm_schema.integration_requests (status, lease_until);

-- ---------------------------------------------------------------------------
-- NHẬT KÝ CHUYỂN TRẠNG THÁI
--
-- Cơ hội, báo giá, hợp đồng, đơn bán, bảo hành ghi chung một bảng: thực thể
-- nào, từ đâu sang đâu, ai làm, vì sao. Chỉ ghi thêm; ghi trong cùng
-- transaction với thay đổi dữ liệu (`writeAuditLog`).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(64) NOT NULL,
    entity_id   UUID NOT NULL,
    -- Rỗng khi vừa tạo, hoặc thao tác không đổi trạng thái.
    from_status VARCHAR(64),
    to_status   VARCHAR(64),
    action      VARCHAR(64) NOT NULL,
    -- Rỗng khi hệ thống tự làm (job, sự kiện).
    actor_id    UUID,
    reason      VARCHAR(2000),
    at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Lịch sử của một thực thể theo thời gian.
CREATE INDEX IF NOT EXISTS ix_crm_audit_log_entity
    ON crm_schema.audit_log (entity_type, entity_id, at);
