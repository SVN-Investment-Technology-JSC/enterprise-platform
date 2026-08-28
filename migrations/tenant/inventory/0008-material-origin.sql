-- Nguồn gốc vật tư: năm sản xuất, nhà cung cấp, nhà sản xuất.
--
-- Ba trường này thuộc hồ sơ của CHÍNH mã vật tư, không thuộc từng lần nhập.
-- Người nhập kho và ngày nhập đã có trong sổ cái (`inventory_transactions`), còn
-- "ai làm ra nó" và "mua của ai" thì không đổi qua các lần nhập nên để ở đây.
--
-- `manufacture_year` là smallint chứ không phải date: người dùng chỉ biết năm,
-- ép nhập ngày đầy đủ sẽ sinh ra hàng loạt ngày 01/01 giả.
ALTER TABLE inventory_schema.materials
  ADD COLUMN IF NOT EXISTS manufacture_year smallint,
  ADD COLUMN IF NOT EXISTS supplier         varchar(180),
  ADD COLUMN IF NOT EXISTS manufacturer     varchar(180);

-- Chặn năm vô lý ngay ở tầng dữ liệu: gõ nhầm 20226 thì phải hỏng lúc ghi, chứ
-- không phải hiện ra một con số kỳ quặc trên báo cáo vài tháng sau.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'materials_manufacture_year_check'
  ) THEN
    ALTER TABLE inventory_schema.materials
      ADD CONSTRAINT materials_manufacture_year_check
      CHECK (manufacture_year IS NULL OR manufacture_year BETWEEN 1900 AND 2200);
  END IF;
END $$;

-- `assets` là VIEW với danh sách cột CỐ ĐỊNH (xem 0006). Thêm cột vào bảng gốc
-- KHÔNG tự động đưa nó vào view — mọi SELECT/INSERT qua view sẽ không thấy ba
-- cột mới, và INSERT có nêu chúng sẽ lỗi "column does not exist".
--
-- Dựng lại view với đủ cột. `CREATE OR REPLACE VIEW` chỉ cho phép THÊM cột vào
-- cuối, đúng với những gì đang làm ở đây.
CREATE OR REPLACE VIEW inventory_schema.assets AS
  SELECT id, code, internal_code, name, parent_id, type, org_unit_id, serial_number,
         status, criticality, specs, task_template, qr_code, unit,
         purchase_price, currency, warranty_until, kind, created_at, updated_at,
         manufacture_year, supplier, manufacturer
    FROM inventory_schema.materials
   WHERE kind = 'ASSET'
  WITH CASCADED CHECK OPTION;

-- Đặt lại mặc định `kind`: CREATE OR REPLACE VIEW dựng lại định nghĩa nên mặc
-- định cột đặt ở lần trước bị mất, và INSERT qua view sẽ tạo ra dòng STOCK.
ALTER VIEW inventory_schema.assets ALTER COLUMN kind SET DEFAULT 'ASSET';
