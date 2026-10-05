BEGIN;

-- 1. CẤP QUYỀN WORKSPACE VÀO CORE_SCHEMA.PERMISSIONS VÀ ROLE_PERMISSIONS
DO $$
DECLARE
    v_perm_id UUID := 'b1000000-0000-4000-8000-000000000001'::uuid;
    v_admin_role UUID := 'a0000000-0000-4000-8000-000000000001'::uuid;
    v_legacy_role UUID := 'a0000000-0000-4000-8000-000000000002'::uuid;
    v_full_role  UUID := 'e138cdc3-c931-4a77-bdc4-90d3aa281a41'::uuid;
BEGIN
    INSERT INTO core_schema.permissions(id, name, description)
    VALUES (v_perm_id, 'Toàn quyền Workspace', 'Quản trị dự án, công việc và tài liệu phân hệ Workspace')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO core_schema.permission_actions(permission_id, action_key)
    VALUES 
        (v_perm_id, 'workspace.read'),
        (v_perm_id, 'workspace.manage'),
        (v_perm_id, 'workspace.task.write'),
        (v_perm_id, 'workspace.document.write')
    ON CONFLICT (permission_id, action_key) DO NOTHING;

    INSERT INTO core_schema.role_permissions(role_id, permission_id)
    VALUES 
        (v_admin_role, v_perm_id),
        (v_legacy_role, v_perm_id),
        (v_full_role, v_perm_id)
    ON CONFLICT (role_id, permission_id) DO NOTHING;
END $$;

-- 2. TẠO DỮ LIỆU SEED CHO CÁC BẢNG WORKSPACE
DO $$
DECLARE
    v_admin_id UUID := '36096049-fcf3-436a-bc08-77e28edaeb00'::uuid; -- Quản trị SAVINA
    v_pm1_id   UUID := '212b7280-7607-4607-ac02-4d8663ed718a'::uuid; -- Nguyễn Hồng Sang
    v_dev1_id  UUID := '8d8f5536-d2d0-4517-be7f-de58201cb96f'::uuid; -- Hà Nguyên Hoàng
    v_dev2_id  UUID := '21e285a2-85a6-40de-9ebc-12c731813298'::uuid; -- Phan Trung Kiên
    v_qa1_id   UUID := 'eed9c1c7-d7ab-413a-b528-3ac43e6f978c'::uuid; -- Nguyễn Trần Như Quỳnh

    v_org_corp UUID := '066739bf-2285-4ea8-b3b9-c89b9040ca5d'::uuid; -- Công ty SVN
    v_org_tech UUID := '724afe48-697d-4369-903e-e4e98cf48af5'::uuid; -- Khối Kỹ thuật - Dịch vụ

    -- Dự án 1: Triển khai ERP SAVINA Enterprise
    v_proj1_id UUID := 'e1000000-0000-4000-8000-000000000001'::uuid;
    v_phase1_id UUID := 'e1000000-0000-4000-8000-000000000011'::uuid;
    v_task1_id  UUID := 'e1000000-0000-4000-8000-000000000012'::uuid;
    v_task2_id  UUID := 'e1000000-0000-4000-8000-000000000013'::uuid;
    v_ms1_id    UUID := 'e1000000-0000-4000-8000-000000000014'::uuid;

    -- Dự án 2: Nâng cấp Dây chuyền Bảo trì & Tự động hóa
    v_proj2_id UUID := 'e2000000-0000-4000-8000-000000000002'::uuid;
    v_task21_id UUID := 'e2000000-0000-4000-8000-000000000021'::uuid;
    v_task22_id UUID := 'e2000000-0000-4000-8000-000000000022'::uuid;

    -- Thư mục & Tài liệu
    v_folder_root_id UUID := 'f1000000-0000-4000-8000-000000000001'::uuid;
    v_folder_sub_id  UUID := 'f1000000-0000-4000-8000-000000000002'::uuid;
    v_doc1_id        UUID := 'd1000000-0000-4000-8000-000000000001'::uuid;
    v_ver1_id        UUID := 'd1000000-0000-4000-8000-000000000011'::uuid;

    -- Kênh chat
    v_channel_proj1 UUID := 'c1000000-0000-4000-8000-000000000001'::uuid;
    v_channel_task1 UUID := 'c1000000-0000-4000-8000-000000000002'::uuid;

    -- Thẻ tags
    v_tag_urgent UUID := 'ba000000-0000-4000-8000-000000000001'::uuid;
    v_tag_core   UUID := 'ba000000-0000-4000-8000-000000000002'::uuid;
BEGIN
    -- =========================================================================
    -- A. DỰ ÁN (PROJECTS)
    -- =========================================================================
    INSERT INTO workspace_schema.projects (
        id, code, name, description, status, owner_user_id, org_unit_id, customer_ref,
        start_date, end_date, progress_percent, contract_value, budget, committed_cost,
        created_by, created_at, updated_at
    ) VALUES (
        v_proj1_id, 'PRJ-ERP-2026', 'Triển khai Hệ thống Điều hành Doanh nghiệp Savina Enterprise',
        'Dự án tích hợp toàn diện HRM, Kho, Bảo trì và Phân hệ Quản trị công việc Workspace cho toàn bộ các khối phòng ban SVN.',
        'active', v_admin_id, v_org_corp, 'KH-SAVINA-CORP',
        '2026-09-01', '2026-12-31', 45, 1500000000.00, 1200000000.00, 450000000.00,
        v_admin_id, now(), now()
    ) ON CONFLICT (code) DO NOTHING;

    INSERT INTO workspace_schema.projects (
        id, code, name, description, status, owner_user_id, org_unit_id, customer_ref,
        start_date, end_date, progress_percent, contract_value, budget, committed_cost,
        created_by, created_at, updated_at
    ) VALUES (
        v_proj2_id, 'PRJ-MAINT-Q4', 'Nâng cấp Dây chuyền Đóng gói & Định kỳ Bảo trì Q4/2026',
        'Bảo dưỡng hệ thống máy móc sản xuất, cân chỉnh độ rung motor và tích hợp quy trình giám sát bảo trì.',
        'planning', v_pm1_id, v_org_tech, NULL,
        '2026-10-01', '2026-11-30', 15, 450000000.00, 380000000.00, 60000000.00,
        v_admin_id, now(), now()
    ) ON CONFLICT (code) DO NOTHING;

    -- =========================================================================
    -- B. THÀNH VIÊN DỰ ÁN (PROJECT_MEMBERS)
    -- =========================================================================
    INSERT INTO workspace_schema.project_members (project_id, user_id, role, created_by)
    VALUES 
        (v_proj1_id, v_admin_id, 'owner', v_admin_id),
        (v_proj1_id, 'fe5f4c6c-7881-4fe6-b882-481c352ba066'::uuid, 'manager', v_admin_id), -- Bùi Công Quyền
        (v_proj1_id, v_pm1_id, 'manager', v_admin_id),
        (v_proj1_id, v_dev1_id, 'member', v_admin_id),
        (v_proj1_id, v_dev2_id, 'member', v_admin_id),
        (v_proj1_id, v_qa1_id, 'viewer', v_admin_id),
        (v_proj2_id, v_pm1_id, 'owner', v_admin_id),
        (v_proj2_id, 'fe5f4c6c-7881-4fe6-b882-481c352ba066'::uuid, 'manager', v_admin_id), -- Bùi Công Quyền
        (v_proj2_id, v_admin_id, 'manager', v_admin_id),
        (v_proj2_id, v_dev1_id, 'member', v_admin_id)
    ON CONFLICT (project_id, user_id) DO NOTHING;

    -- =========================================================================
    -- C. CÔNG VIỆC VÀ CÂY PHÂN CẤP WBS (WORK_ITEMS)
    -- =========================================================================
    -- 1. Phase 1 của Dự án 1
    INSERT INTO workspace_schema.work_items (
        id, project_id, parent_id, code, title, description, item_type, execution_type,
        status, priority, assignee_user_id, planned_start, planned_end, actual_start,
        estimate_hours, estimated_cost, actual_cost, progress_percent, sort_order, depth,
        created_by
    ) VALUES (
        v_phase1_id, v_proj1_id, NULL, 'WBS-01', 'Giai đoạn 1: Khảo sát & Chuẩn hóa cấu hình hệ thống',
        'Tổng hợp quy chuẩn nghiệp vụ, cấu hình đa chi nhánh và thiết lập môi trường CSDL.',
        'phase', 'manual', 'in_progress', 'high', v_pm1_id,
        '2026-09-01', '2026-10-15', '2026-09-01', 160.00, 80000000.00, 45000000.00, 75, 1, 0,
        v_admin_id
    ) ON CONFLICT (project_id, code) DO NOTHING;

    -- 2. Task 1.1: Thiết lập hạ tầng CSDL
    INSERT INTO workspace_schema.work_items (
        id, project_id, parent_id, code, title, description, item_type, execution_type,
        status, priority, assignee_user_id, planned_start, planned_end, actual_start, actual_end,
        estimate_hours, estimated_cost, actual_cost, progress_percent, sort_order, depth,
        created_by
    ) VALUES (
        v_task1_id, v_proj1_id, v_phase1_id, 'TSK-01-01', 'Cấu hình và kiểm tra cơ sở dữ liệu tenant Savina',
        'Triển khai các schema core, hrm, maintenance, inventory và workspace trên Postgres 17.',
        'task', 'manual', 'done', 'urgent', v_dev1_id,
        '2026-09-01', '2026-09-10', '2026-09-01', '2026-09-09', 40.00, 20000000.00, 20000000.00, 100, 1, 1,
        v_admin_id
    ) ON CONFLICT (project_id, code) DO NOTHING;

    -- 3. Task 1.2: Định vị GPS & Phân ca HRM
    INSERT INTO workspace_schema.work_items (
        id, project_id, parent_id, code, title, description, item_type, execution_type,
        status, priority, assignee_user_id, planned_start, planned_end, actual_start,
        estimate_hours, estimated_cost, actual_cost, progress_percent, sort_order, depth,
        created_by
    ) VALUES (
        v_task2_id, v_proj1_id, v_phase1_id, 'TSK-01-02', 'Cấu hình Geolocation GPS và luồng duyệt đơn',
        'Thiết lập tọa độ GPS văn phòng 16.0375, 108.2122 và chế độ duyệt trực tiếp cho đơn chấm công.',
        'task', 'manual', 'in_progress', 'high', v_dev2_id,
        '2026-09-11', '2026-10-10', '2026-09-12', 60.00, 35000000.00, 25000000.00, 60, 2, 1,
        v_admin_id
    ) ON CONFLICT (project_id, code) DO NOTHING;

    -- 4. Milestone: Nghiệm thu Giai đoạn 1
    INSERT INTO workspace_schema.work_items (
        id, project_id, parent_id, code, title, description, item_type, execution_type,
        status, priority, assignee_user_id, planned_start, planned_end,
        estimate_hours, estimated_cost, actual_cost, progress_percent, sort_order, depth,
        created_by
    ) VALUES (
        v_ms1_id, v_proj1_id, v_phase1_id, 'MLS-01', 'Mốc UAT nghiệm thu vận hành thử nghiệm',
        'Bàn giao phân hệ HRM và phân hệ Workspace cho quản lý các phòng ban chạy thử.',
        'milestone', 'manual', 'todo', 'urgent', v_pm1_id,
        '2026-10-15', '2026-10-15', 8.00, 5000000.00, 0.00, 0, 3, 1,
        v_admin_id
    ) ON CONFLICT (project_id, code) DO NOTHING;

    -- 5. Task dự án 2
    INSERT INTO workspace_schema.work_items (
        id, project_id, parent_id, code, title, description, item_type, execution_type,
        status, priority, assignee_user_id, planned_start, planned_end, actual_start,
        estimate_hours, estimated_cost, actual_cost, progress_percent, sort_order, depth,
        created_by
    ) VALUES (
        v_task21_id, v_proj2_id, NULL, 'WBS-M-01', 'Khảo sát hiện trạng rung lắc băng chuyền đóng gói',
        'Đo đạc chỉ số sensor và đối chiếu lịch sử bảo dưỡng máy trong Maintenance.',
        'task', 'manual', 'in_progress', 'normal', v_dev1_id,
        '2026-10-02', '2026-10-12', '2026-10-02', 24.00, 15000000.00, 5000000.00, 35, 1, 0,
        v_admin_id
    ) ON CONFLICT (project_id, code) DO NOTHING;

    INSERT INTO workspace_schema.work_items (
        id, project_id, parent_id, code, title, description, item_type, execution_type,
        status, priority, assignee_user_id, planned_start, planned_end,
        estimate_hours, estimated_cost, actual_cost, progress_percent, sort_order, depth,
        created_by
    ) VALUES (
        v_task22_id, v_proj2_id, NULL, 'WBS-M-02', 'Đặt mua phụ tùng vòng bi bạc đạn chịu lực cao',
        'Tạo đề xuất vật tư phụ tùng kết nối với phân hệ Kho Inventory.',
        'task', 'manual', 'todo', 'high', v_pm1_id,
        '2026-10-10', '2026-10-20', 16.00, 25000000.00, 0.00, 0, 2, 0,
        v_admin_id
    ) ON CONFLICT (project_id, code) DO NOTHING;

    -- =========================================================================
    -- D. QUAN HỆ PHỤ THUỘC (WORK_ITEM_DEPENDENCIES)
    -- =========================================================================
    INSERT INTO workspace_schema.work_item_dependencies (
        project_id, predecessor_id, successor_id, dependency_type, lag_days, created_by
    ) VALUES (
        v_proj1_id, v_task1_id, v_task2_id, 'FS', 1, v_admin_id
    ) ON CONFLICT (predecessor_id, successor_id) DO NOTHING;

    INSERT INTO workspace_schema.work_item_dependencies (
        project_id, predecessor_id, successor_id, dependency_type, lag_days, created_by
    ) VALUES (
        v_proj1_id, v_task2_id, v_ms1_id, 'FS', 0, v_admin_id
    ) ON CONFLICT (predecessor_id, successor_id) DO NOTHING;

    -- =========================================================================
    -- E. SỔ GHI CHI PHÍ (COST_ENTRIES - Migration 0007)
    -- =========================================================================
    INSERT INTO workspace_schema.cost_entries (
        work_item_id, project_id, amount, note, created_by
    ) VALUES 
        (v_task1_id, v_proj1_id, 20000000.00, 'Chi phí máy chủ hạ tầng & dịch vụ vận hành thử nghiệm', v_admin_id),
        (v_task2_id, v_proj1_id, 25000000.00, 'Kinh phí khảo sát thực địa và cấu hình GPS', v_admin_id),
        (v_task21_id, v_proj2_id, 5000000.00, 'Thuê thiết bị đo độ rung cảm biến ngoại vi', v_pm1_id)
    ON CONFLICT DO NOTHING;

    -- =========================================================================
    -- F. TÀI LIỆU DỰ ÁN & THƯ MỤC (DOCUMENTS & FOLDERS - Migration 0002, 0008, 0009)
    -- =========================================================================
    INSERT INTO workspace_schema.document_folders (
        id, project_id, parent_id, name, depth, is_active, created_by
    ) VALUES (
        v_folder_root_id, v_proj1_id, NULL, 'Tài liệu Kỹ thuật & Hồ sơ Thiết kế', 0, true, v_admin_id
    ) ON CONFLICT DO NOTHING;

    INSERT INTO workspace_schema.document_folders (
        id, project_id, parent_id, name, depth, is_active, created_by
    ) VALUES (
        v_folder_sub_id, v_proj1_id, v_folder_root_id, 'Đặc tả Nghiệp vụ (SRS)', 1, true, v_admin_id
    ) ON CONFLICT DO NOTHING;

    INSERT INTO workspace_schema.documents (
        id, folder_id, project_id, name, description, status, created_by
    ) VALUES (
        v_doc1_id, v_folder_sub_id, v_proj1_id, 'Ke-hoach-trien-khai-Savina-Enterprise-v1.0.pdf',
        'Tài liệu đặc tả kiến trúc phân hệ HRM, Workspace, Kho và Bảo trì.', 'active', v_admin_id
    ) ON CONFLICT (folder_id, name) DO NOTHING;

    INSERT INTO workspace_schema.document_versions (
        id, document_id, version_no, storage_key, file_name, content_type, size_bytes,
        change_note, uploaded_by
    ) VALUES (
        v_ver1_id, v_doc1_id, 1, 'savina/workspace/docs/Ke-hoach-trien-khai-Savina-Enterprise-v1.0.pdf',
        'Ke-hoach-trien-khai-Savina-Enterprise-v1.0.pdf', 'application/pdf', 384512,
        'Phiên bản ban hành chính thức', v_admin_id
    ) ON CONFLICT (document_id, version_no) DO NOTHING;

    UPDATE workspace_schema.documents
    SET current_version_id = v_ver1_id
    WHERE id = v_doc1_id;

    -- Gắn tài liệu vào công việc
    INSERT INTO workspace_schema.document_links (
        document_id, entity_type, entity_id, created_by
    ) VALUES (
        v_doc1_id, 'work_item', v_task2_id, v_admin_id
    ) ON CONFLICT (document_id, entity_type, entity_id) DO NOTHING;

    -- =========================================================================
    -- G. LỊCH LÀM VIỆC & CUỘC HỌP (CALENDAR_EVENTS - Migration 0003)
    -- =========================================================================
    INSERT INTO workspace_schema.calendar_events (
        project_id, work_item_id, title, description, location, event_type,
        start_at, end_at, all_day, timezone, status, organizer_user_id, created_by
    ) VALUES (
        v_proj1_id, v_task2_id, 'Họp rà soát quy trình chấm công GPS & Luồng duyệt',
        'Thống nhất các kịch bản chấm công, giải trình giờ công và đổi ca.',
        'Phòng Họp Trung tâm Tầng 3 - Savina Hub', 'meeting',
        now() + interval '1 day', now() + interval '1 day' + interval '1 hour 30 minutes',
        false, 'Asia/Ho_Chi_Minh', 'scheduled', v_admin_id, v_admin_id
    ) ON CONFLICT DO NOTHING;

    -- =========================================================================
    -- H. KÊNH CHAT & TIN NHẮN (CHAT_CHANNELS & MESSAGES - Migration 0004)
    -- =========================================================================
    INSERT INTO workspace_schema.chat_channels (
        id, entity_type, entity_id, project_id, last_message_at, created_by
    ) VALUES 
        (v_channel_proj1, 'project', v_proj1_id, v_proj1_id, now(), v_admin_id),
        (v_channel_task1, 'work_item', v_task2_id, v_proj1_id, now(), v_dev2_id)
    ON CONFLICT (entity_type, entity_id) DO NOTHING;

    INSERT INTO workspace_schema.chat_messages (
        channel_id, body, created_by, created_at
    ) VALUES 
        (v_channel_proj1, 'Chào mừng toàn đội ngũ tham gia dự án Triển khai Savina Enterprise!', v_admin_id, now() - interval '1 day'),
        (v_channel_task1, 'Đã cập nhật tọa độ GPS mới 16.0375, 108.2122 tại văn phòng chính thành công.', v_dev2_id, now() - interval '20 minutes')
    ON CONFLICT DO NOTHING;

    -- =========================================================================
    -- I. NHÃN PHÂN LOẠI (TAGS & ENTITY_TAGS)
    -- =========================================================================
    INSERT INTO workspace_schema.tags (id, name, color, created_by)
    VALUES 
        (v_tag_urgent, 'ưu tiên cao', '#ef4444', v_admin_id),
        (v_tag_core, 'hệ thống lõi', '#3b82f6', v_admin_id)
    ON CONFLICT (name) DO NOTHING;

    INSERT INTO workspace_schema.entity_tags (tag_id, entity_type, entity_id, created_by)
    VALUES 
        (v_tag_urgent, 'work_item', v_task2_id, v_admin_id),
        (v_tag_core, 'project', v_proj1_id, v_admin_id)
    ON CONFLICT (tag_id, entity_type, entity_id) DO NOTHING;

END $$;

COMMIT;
