-- Migration: 0026-draft-line-lot.sql
-- Description: Thông tin lô khai trên dòng chứng từ lúc lưu nháp (ISS-BE-066).
-- Trước đây lưu nháp đã tạo lô và điền hạn dùng, ngày sản xuất vào lô có sẵn; huỷ nháp không dọn.
-- Nay dòng nhập lưu số lô, ngày sản xuất, hạn dùng, nhà cung cấp, số chứng chỉ, lô gốc (hàng trả về)
-- và trạng thái chất lượng của lô mới vào `lot_draft` (JSONB); lô chỉ được tạo lúc ghi sổ.
-- Cột mới cho phép NULL nên bản app cũ vẫn ghi bình thường; dòng cũ giữ NULL và giữ `lot_id` đã có.
-- Lô rác do nháp cũ tạo dọn bằng `tools/inventory/cleanup-orphan-lots.mjs`.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE inventory_schema.stock_document_lines
    ADD COLUMN IF NOT EXISTS lot_draft JSONB;

COMMENT ON COLUMN inventory_schema.stock_document_lines.lot_draft IS
    'Thông tin lô khai trên dòng nhập (lotNo, manufacturedOn, expiresOn, supplier, certificateNo, copyLotFrom, newLotQuality); lô tạo lúc ghi sổ.';
