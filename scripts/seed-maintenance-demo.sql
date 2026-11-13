-- Dữ liệu mẫu để thử giao diện Tổng quan của Bảo trì (CHỈ DÙNG TRÊN DB LOCAL).
-- Chạy lại được: xoá đúng các dòng DEMO do chính file này tạo rồi chèn lại; không đụng dữ liệu khác.
--
--   docker exec -i enterprise-platform-tenant-db-1 psql -U tenant -d savina1 -v ON_ERROR_STOP=1 < scripts/seed-maintenance-demo.sql
--
-- Cần thiết bị MBA-T1, MBA-T2, MC-901, RELAY-901, TBA-110, TBA-110-NGAN1, TBA-22-KCN, TN-MEGGER bên Kho (bộ dữ liệu local có sẵn).
-- Ngày tính theo hôm nay nên chạy lại sẽ "trượt" theo ngày hiện tại.
BEGIN;

DELETE FROM maintenance_schema.occurrences WHERE idempotency_key LIKE 'demo:%';
DELETE FROM maintenance_schema.schedules WHERE code LIKE 'DEMO-SCH-%';

-- Lịch bảo trì: đủ tần suất, mức ưu tiên và một lịch tạm dừng.
INSERT INTO maintenance_schema.schedules (id, code, title, asset_code, frequency, status, priority, start_date, next_due_at)
VALUES
  ('de000000-0000-4000-8000-000000000001', 'DEMO-SCH-01', 'Kiểm tra nhiệt độ dầu MBA T1', 'MBA-T1', 'week', 'active', 'High', current_date - 40, now() + interval '3 days'),
  ('de000000-0000-4000-8000-000000000002', 'DEMO-SCH-02', 'Thử nghiệm cách điện MBA T2', 'MBA-T2', 'month', 'active', 'Normal', current_date - 70, now() + interval '12 days'),
  ('de000000-0000-4000-8000-000000000003', 'DEMO-SCH-03', 'Kiểm tra rơ le bảo vệ lộ 901', 'RELAY-901', 'quarter', 'active', 'High', current_date - 80, now() + interval '25 days'),
  ('de000000-0000-4000-8000-000000000004', 'DEMO-SCH-04', 'Đại tu trạm 110kV', 'TBA-110', 'year', 'active', 'Low', current_date - 300, now() + interval '60 days'),
  ('de000000-0000-4000-8000-000000000005', 'DEMO-SCH-05', 'Vệ sinh ngăn lộ 110kV số 1', 'TBA-110-NGAN1', 'month', 'active', 'Normal', current_date - 20, now() + interval '8 days'),
  ('de000000-0000-4000-8000-000000000006', 'DEMO-SCH-06', 'Kiểm tra cơ cấu truyền động máy cắt 901', 'MC-901', 'week', 'active', 'Low', current_date - 35, now() + interval '5 days'),
  ('de000000-0000-4000-8000-000000000007', 'DEMO-SCH-07', 'Hiệu chuẩn thiết bị đo Megger', 'TN-MEGGER', 'quarter', 'paused', 'Normal', current_date - 90, NULL);

-- Phiếu định kỳ: đã hoàn thành rải đều 8 tuần gần nhất (để biểu đồ có hình), thêm phiếu quá hạn, sắp tới và bị chặn/thất bại.
INSERT INTO maintenance_schema.occurrences
  (id, schedule_id, kind, title, asset_code, due_at, status, priority, idempotency_key, created_at, completed_at, completed_by, completed_by_name, assignee_id, assignee_name)
SELECT gen_random_uuid(), s.id, 'preventive', s.title, s.asset_code,
       now() - (w.weeks_ago * 7 + w.shift) * interval '1 day', 'completed', s.priority,
       'demo:done:' || s.code || ':' || w.weeks_ago || ':' || w.shift,
       now() - (w.weeks_ago * 7 + w.shift + 2) * interval '1 day',
       now() - (w.weeks_ago * 7 + w.shift) * interval '1 day',
       '26b47afc-6d35-4809-b36a-28db731a1c5c', 'Tài Búa',
       'af66160e-7191-400d-abbc-15659ec7545d', 'Nguyễn Minh An'
FROM maintenance_schema.schedules s
JOIN (VALUES
  ('DEMO-SCH-01', 0, 1), ('DEMO-SCH-01', 1, 2), ('DEMO-SCH-01', 2, 0), ('DEMO-SCH-01', 3, 1), ('DEMO-SCH-01', 4, 3), ('DEMO-SCH-01', 5, 2), ('DEMO-SCH-01', 6, 1), ('DEMO-SCH-01', 7, 0),
  ('DEMO-SCH-06', 0, 2), ('DEMO-SCH-06', 1, 3), ('DEMO-SCH-06', 3, 2), ('DEMO-SCH-06', 4, 1), ('DEMO-SCH-06', 6, 3), ('DEMO-SCH-06', 7, 2),
  ('DEMO-SCH-02', 1, 4), ('DEMO-SCH-02', 5, 4), ('DEMO-SCH-05', 2, 5), ('DEMO-SCH-05', 6, 5), ('DEMO-SCH-03', 3, 6), ('DEMO-SCH-04', 4, 6)
) AS w(code, weeks_ago, shift) ON w.code = s.code;

INSERT INTO maintenance_schema.occurrences
  (id, schedule_id, kind, title, asset_code, due_at, status, priority, idempotency_key, failure_reason, assignee_id, assignee_name)
SELECT gen_random_uuid(), s.id, 'preventive', s.title, s.asset_code, now() + o.days * interval '1 day', o.status, s.priority,
       'demo:open:' || s.code || ':' || o.days, o.reason, o.assignee_id::uuid, o.assignee_name
FROM maintenance_schema.schedules s
JOIN (VALUES
  ('DEMO-SCH-01', -4, 'generated', NULL, '26b47afc-6d35-4809-b36a-28db731a1c5c', 'Tài Búa'),
  ('DEMO-SCH-06', -3, 'planned', NULL, NULL, NULL),
  ('DEMO-SCH-02', -1, 'dispatch_pending', NULL, '4e0185b8-c54d-466c-b66b-8370f43ad31e', 'Trần Ngọc Mai'),
  ('DEMO-SCH-01', 1, 'planned', NULL, '26b47afc-6d35-4809-b36a-28db731a1c5c', 'Tài Búa'),
  ('DEMO-SCH-06', 3, 'planned', NULL, NULL, NULL),
  ('DEMO-SCH-05', 5, 'generated', NULL, 'b887bc31-63b6-4018-af79-fdbaf8a1ea40', 'Lê Minh Khoa'),
  ('DEMO-SCH-02', 6, 'in_progress', NULL, '26b47afc-6d35-4809-b36a-28db731a1c5c', 'Tài Búa'),
  ('DEMO-SCH-03', 14, 'planned', NULL, NULL, NULL),
  ('DEMO-SCH-04', 30, 'planned', NULL, NULL, NULL),
  ('DEMO-SCH-05', -9, 'blocked', 'Chưa có xe vận chuyển', NULL, NULL),
  ('DEMO-SCH-03', -15, 'failed', 'Không tạo được phiếu Quy trình', NULL, NULL)
) AS o(code, days, status, reason, assignee_id, assignee_name) ON o.code = s.code;

-- Sự cố: nhiều mức ưu tiên và trạng thái; hai sự cố giao cho tài khoản Tài Búa.
INSERT INTO maintenance_schema.occurrences
  (id, kind, code, title, asset_code, description, due_at, status, priority, idempotency_key, created_at, completed_at,
   assignee_id, assignee_name, created_by, created_by_name, completed_by, completed_by_name, completion_note)
VALUES
  (gen_random_uuid(), 'incident', 'INC-DEMO-001', 'Máy biến áp T1 nóng bất thường', 'MBA-T1', 'Nhiệt độ dầu vượt ngưỡng cảnh báo lúc cao điểm.', now() - interval '1 day', 'in_progress', 'High', 'demo:inc:001', now() - interval '1 day', NULL, '26b47afc-6d35-4809-b36a-28db731a1c5c', 'Tài Búa', '4e0185b8-c54d-466c-b66b-8370f43ad31e', 'Trần Ngọc Mai', NULL, NULL, NULL),
  (gen_random_uuid(), 'incident', 'INC-DEMO-002', 'Rơ le lộ 901 báo lỗi giao tiếp', 'RELAY-901', 'Mất kết nối SCADA gián đoạn nhiều lần.', now() - interval '2 days', 'in_progress', 'High', 'demo:inc:002', now() - interval '2 days', NULL, 'af66160e-7191-400d-abbc-15659ec7545d', 'Nguyễn Minh An', '26b47afc-6d35-4809-b36a-28db731a1c5c', 'Tài Búa', NULL, NULL, NULL),
  (gen_random_uuid(), 'incident', 'INC-DEMO-003', 'Rò dầu nhẹ tại ngăn lộ 110kV số 1', 'TBA-110-NGAN1', NULL, now() - interval '3 days', 'in_progress', 'Normal', 'demo:inc:003', now() - interval '3 days', NULL, 'b887bc31-63b6-4018-af79-fdbaf8a1ea40', 'Lê Minh Khoa', '4e0185b8-c54d-466c-b66b-8370f43ad31e', 'Trần Ngọc Mai', NULL, NULL, NULL),
  (gen_random_uuid(), 'incident', 'INC-DEMO-004', 'Máy cắt 901 kẹt cơ cấu lò xo', 'MC-901', 'Lò xo tích năng không về vị trí.', now() - interval '5 days', 'blocked', 'High', 'demo:inc:004', now() - interval '5 days', NULL, NULL, NULL, '26b47afc-6d35-4809-b36a-28db731a1c5c', 'Tài Búa', NULL, NULL, NULL),
  (gen_random_uuid(), 'incident', 'INC-DEMO-005', 'Đèn báo trạm 22kV hỏng', 'TBA-22-KCN', NULL, now() - interval '6 days', 'planned', 'Low', 'demo:inc:005', now() - interval '6 days', NULL, NULL, NULL, 'af66160e-7191-400d-abbc-15659ec7545d', 'Nguyễn Minh An', NULL, NULL, NULL),
  (gen_random_uuid(), 'incident', 'INC-DEMO-006', 'Quạt làm mát MBA T2 kêu to', 'MBA-T2', NULL, now() - interval '8 days', 'generated', 'Normal', 'demo:inc:006', now() - interval '8 days', NULL, 'af66160e-7191-400d-abbc-15659ec7545d', 'Nguyễn Minh An', '26b47afc-6d35-4809-b36a-28db731a1c5c', 'Tài Búa', NULL, NULL, NULL),
  (gen_random_uuid(), 'incident', 'INC-DEMO-007', 'Megger sai số khi đo thử', 'TN-MEGGER', 'Kết quả đo lệch so với thiết bị chuẩn.', now() - interval '12 days', 'completed', 'Normal', 'demo:inc:007', now() - interval '12 days', now() - interval '9 days', 'af66160e-7191-400d-abbc-15659ec7545d', 'Nguyễn Minh An', '4e0185b8-c54d-466c-b66b-8370f43ad31e', 'Trần Ngọc Mai', 'af66160e-7191-400d-abbc-15659ec7545d', 'Nguyễn Minh An', 'Đã hiệu chuẩn lại, sai số trong giới hạn.'),
  (gen_random_uuid(), 'incident', 'INC-DEMO-008', 'Tiếp địa ngăn lộ 110kV lỏng', 'TBA-110', NULL, now() - interval '20 days', 'completed', 'High', 'demo:inc:008', now() - interval '20 days', now() - interval '18 days', 'b887bc31-63b6-4018-af79-fdbaf8a1ea40', 'Lê Minh Khoa', '26b47afc-6d35-4809-b36a-28db731a1c5c', 'Tài Búa', 'b887bc31-63b6-4018-af79-fdbaf8a1ea40', 'Lê Minh Khoa', 'Đã siết lại và đo điện trở tiếp địa.');

COMMIT;
