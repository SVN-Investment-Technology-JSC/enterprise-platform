-- Phân hệ Trợ lý Savina chạy ở service riêng (savina-agent), không có bảng trong DB tenant.
-- Migration này chỉ để luồng bật phân hệ cho tenant hoàn tất như mọi phân hệ khác.
SELECT 1;
