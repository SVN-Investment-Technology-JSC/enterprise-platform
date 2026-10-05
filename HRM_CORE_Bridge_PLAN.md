# KẾ HOẠCH KIẾN TRÚC & TRIỂN KHAI CORE ↔ HRM INTEGRATION BRIDGE (SAAS ENTERPRISE)
**Tài liệu kỹ thuật tổng hợp chuẩn hóa (Architecture, Multi-tenant SaaS Safety, Database, Backend, Frontend)**  
*Mã tài liệu:* `HRM_CORE_Bridge_PLAN.md`  
*Phạm vi:* Enterprise Platform / SaaS Multi-tenant / CORE (Identity & Org) + HRM  
*Trạng thái:* Kế hoạch kiến trúc & triển khai chi tiết chuẩn production

---

## MỤC LỤC
1. [Bối Cảnh & Ranh Giới Domain (Domain Boundaries)](#1-bối-cảnh--ranh-giới-domain-domain-boundaries)
2. [Nguyên Tắc Kiến Trúc SaaS Multi-Tenant & Tenant Safety](#2-nguyên-tắc-kiến-trúc-saas-multi-tenant--tenant-safety)
3. [Hiện Trạng Hệ Thống & Gap Analysis](#3-hiện-trạng-hệ-thống--gap-analysis)
4. [Event Envelope & Ma Trận Sự Kiện Hai Chiều (Event Matrix)](#4-event-envelope--ma-trận-sự-kiện-hai-chiều-event-matrix)
5. [Thiết Kế Database Migrations (SQL) Chuẩn Tenant-Safe](#5-thiết-kế-database-migrations-sql-chuẩn-tenant-safe)
6. [Hạ Tầng Integration: Outbox, Inbox, Multi-Worker, Retry & DLQ](#6-hạ-tầng-integration-outbox-inbox-multi-worker-retry--dlq)
7. [Thiết Kế Backend Service (NestJS) Theo Mô Hình Event → Command](#7-thiết-kế-backend-service-nestjs-theo-mô-hình-event--command)
8. [Thiết Kế APIs: Career History & Snapshot](#8-thiết-kế-apis-career-history--snapshot)
9. [Thiết Kế Giao Diện Người Dùng (UI/UX Chuẩn Hóa)](#9-thiết-kế-giao-diện-người-dùng-uiux-chuẩn-hóa)
10. [Lộ Trình Triển Khai Chi Tiết (Phase 0 đến Phase 5)](#10-lộ-trình-triển-khai-chi-tiết-phase-0-đến-phase-5)
11. [Bộ Tiêu Chí Nghiệm Thu Toàn Diện (Acceptance Criteria)](#11-bộ-tiêu-chí-nghiệm-thu-toàn-diện-acceptance-criteria)

---

## 1. BỐI CẢNH & RANH GIỚI DOMAIN (DOMAIN BOUNDARIES)

### 1.1. Bản chất hai Domain trong Doanh nghiệp
Trong hệ thống Enterprise ERP, có sự phân định trách nhiệm rõ ràng giữa Quản trị Cơ cấu Tổ chức và Quản trị Hồ sơ Nhân sự:

| Tiêu chí | CORE / Organization (Sơ đồ tổ chức & Bổ nhiệm) | HRM / Employee Profile (Hồ sơ nhân sự) |
|---|---|---|
| **Mục đích** | Cấu trúc quyền lực, vị trí, quan hệ báo cáo, assignment | Quản lý vòng đời lao động, hành chính, đãi ngộ, chế độ |
| **Owner nghiệp vụ** | Ban Lãnh đạo / Ban Tổ chức Doanh nghiệp | Phòng Nhân sự (HR Operations / C&B) |
| **Thực thể trung tâm** | `organization_nodes` (Đơn vị, Chức danh công việc) | `core.employees` + `employee_profiles` (Con người) |
| **Quan hệ bổ nhiệm** | 1 Chức danh có thể có nhiều người (Kiêm nhiệm, đồng cấp) | 1 Con người chỉ có 1 hồ sơ duy nhất |
| **Vòng đời** | Ổn định theo sơ đồ tổ chức công ty | Biến động theo hành trình cá nhân (Vào - Thử việc - Ký HĐ - Nghỉ) |
| **Source of Truth** | **Source of Truth cho Vị trí & Cây tổ chức** | **Source of Truth cho Con người & Trạng thái lao động** |

### 1.2. Nguyên tắc phân định then chốt: Employee $\neq$ User Account
Một nhân viên trong doanh nghiệp có thể:
- Chưa được cấp tài khoản đăng nhập (công nhân, thời vụ, bảo vệ...);
- Đã được cấp tài khoản;
- Bị khóa/unlink tài khoản nhưng vẫn là nhân viên chính thức;
- Thay đổi email/tài khoản đăng nhập trong vòng đời công tác.

```
       Employee (Identity con người trong doanh nghiệp)
          └── optional User (Tài khoản định danh đăng nhập)
```
> **Quy tắc bất biến:** Tuyệt đối không thiết kế `Employee == User`. `employee_id` là định danh gốc (Authoritative Identity) của việc bổ nhiệm chức vụ. `user_id` chỉ đóng vai trò tùy chọn cho ngữ cảnh tài khoản.

---

## 2. NGUYÊN TẮC KIẾN TRÚC SAAS MULTI-TENANT & TENANT SAFETY

### 2.1. Tenant là ranh giới cô lập bắt buộc (Tenant Isolation Boundary)
```
Tenant A Context                              Tenant B Context
 ├── CORE Organization                         ├── CORE Organization
 ├── HRM Employee                              ├── HRM Employee
 └── Integration Outbox/Inbox                  └── Integration Outbox/Inbox
```
Tuyệt đối không để sự kiện của Tenant A tác động hay truy vấn dữ liệu của Tenant B. Mọi Handler, Dispatcher, Trigger, Query đều bắt buộc phải mang ngữ cảnh `tenant_id`.

### 2.2. Defense in Depth (Bảo vệ đa tầng)
1. **Application Context:** Mọi request và event handler nhận `tenantId` tường minh.
2. **Tenant-Aware Idempotency Key:** Khóa định danh tin nhắn trong Inbox phải là bộ ba:
   $$\text{Idempotency Key} = (\text{tenant\_id}, \text{consumer}, \text{event\_id})$$
3. **Database Constraints & Conditions:** Mọi câu lệnh SQL truy vấn và cập nhật bắt buộc kèm theo mệnh đề:
   ```sql
   WHERE employee_id = $1 AND tenant_id = $2
   ```

### 2.3. Vòng đời Module (Module Lifecycle Awareness)
Không giả định mọi Tenant đều kích hoạt đồng thời CORE và HRM. Khi Tenant B tắt HRM (`HRM = DISABLED`), Bridge phải bỏ qua an toàn các sự kiện liên quan HRM mà không gây lỗi crash hoặc gọi vào các bảng/schema chưa được cấp phát.

---

## 3. HIỆN TRẠNG HỆ THỐNG & GAP ANALYSIS

### 3.1. Hiện trạng Codebase
- **CORE Organization API:** [platform-access.controller.ts](file:///d:/CRM/enterprise-platform/packages/platform/identity/src/lib/platform-access.controller.ts) và [platform-identity.service.ts](file:///d:/CRM/enterprise-platform/packages/platform/identity/src/lib/platform-identity.service.ts)
  - Endpoint `POST /api/platform/v1/tenant-organization/assignments` nhận `user_id` thay vì `employee_id`.
  - Snapshot trả về danh sách `users` từ `core_schema.users`, thiếu mã nhân viên `employee_code` và liên kết nhân sự.
- **HRM Employee API:** [hrm-employee.controller.ts](file:///d:/CRM/enterprise-platform/packages/modules/hrm/src/lib/presentation/hrm-employee.controller.ts)
  - Khi cập nhật trạng thái nhân viên nghỉ việc (`RESIGNED`, `TERMINATED`), không phát sinh thông báo/sự kiện nào sang CORE Organization.
- **Outbox System:** Sẵn có tại schema `integration_schema` gồm `outbox_events` và `inbox_messages`, đã được áp dụng trong HRM Request Workflow.
- **Giao diện Hồ sơ nhân viên:** [profile-screen.tsx](file:///d:/CRM/enterprise-platform/packages/features/hrm/src/lib/screens/profile-screen.tsx)
  - Tab Quá trình công tác (`work_history`) hiện đang hiển thị dữ liệu tĩnh mẫu (hardcoded events từ ngày gia nhập/chính thức).

### 3.2. Chi tiết 4 Lỗ Hổng Kiến Trúc (Critical Gaps)
```
[Gap 1: Identity Disconnect]
CORE Assignment: user_id (Tài khoản)  <--- KHÔNG CÓ LIÊN KẾT TRỰC TIẾP ---> HRM: employee_id (Nhân viên)
(Nhân viên chưa có tài khoản đăng nhập thì không thể được bổ nhiệm trên sơ đồ tổ chức)

[Gap 2: Offboarding Desynchronization]
HRM: Nhân viên nghỉ việc (RESIGNED/TERMINATED)  --- X (Không báo) --->  CORE: Vị trí trên sơ đồ tổ chức vẫn "Active"

[Gap 3: Position Deletion Blindspot]
CORE: Chức danh bị xóa khỏi cây tổ chức  --- X (Không thông báo) --->  HRM: Profile chức danh (Lương, JD) bị mồ côi

[Gap 4: Hardcoded Career Timeline]
HRM UI Profile tab "Quá trình công tác": Đang fix cứng 2 mốc thời gian tĩnh, không phản ánh lịch sử bổ nhiệm từ CORE
```

---

## 4. EVENT ENVELOPE & MA TRẬN SỰ KIỆN HAI CHIỀU (EVENT MATRIX)

### 4.1. Chuẩn hóa Event Contract (Envelope)
Mọi sự kiện trao đổi qua Integration Bridge phải tuân theo cấu trúc JSON chuẩn:

```json
{
  "eventId": "b3e04cfb-8149-411a-8c38-890db7f946e3",
  "eventType": "hrm.employee.offboarded",
  "eventVersion": 1,
  "tenantId": "c4962ceb-626a-49ae-967a-0639994fe83f",
  "source": {
    "module": "hrm",
    "service": "employee"
  },
  "aggregate": {
    "type": "employee",
    "id": "78a63dc1-dfc5-4dcb-9fe3-455aa2359f10"
  },
  "occurredAt": "2026-09-30T10:00:00.000Z",
  "correlationId": "8f03761c-8e43-41bb-9279-bf8bfb972cbb",
  "causationId": null,
  "payload": {
    "employeeId": "78a63dc1-dfc5-4dcb-9fe3-455aa2359f10",
    "employmentStatus": "RESIGNED",
    "effectiveDate": "2026-09-30"
  }
}
```

### 4.2. Ma trận Sự Kiện Hai Chiều
| STT | Sự Kiện Kích Hoạt | Nguồn | Tác Vụ Đồng Bộ Tương Ứng | Đích | Cơ Chế Xử Lý | Mức Độ |
|---|---|---|---|---|---|---|
| **E-01** | Bổ nhiệm trên sơ đồ tổ chức | CORE Org | Map `employee_id` từ `user_id` (nếu có), cập nhật Career Projection | HRM Career | Outbox Event → Projection | Cao |
| **E-02** | Bãi nhiệm chức vụ / Hết nhiệm kỳ | CORE Org | Cập nhật `end_date`, kiểm tra cảnh báo nếu nhân sự không còn vị trí active nào | HRM Profile / Alert | Outbox Event → Projection | Cao |
| **E-03** | Xóa Node chức danh (`position`) | CORE Org | Đánh dấu vô hiệu hóa `hrm_schema.position_profiles` tương ứng | HRM Position Profile | Outbox Event → Domain Command | Trung bình |
| **E-04** | Nhân viên nghỉ việc (`RESIGNED`/`TERMINATED`) | HRM | Tự động thu hồi/chấm dứt toàn bộ các vị trí bổ nhiệm active trong sơ đồ | CORE Assignments | Outbox Event → Domain Command | **Nghiêm ngặt (P0)** |
| **E-05** | Phê duyệt Quyết định bổ nhiệm chính thức | HRM Workflow | Gửi lệnh tạo `organization_node_assignments` mới sang CORE | CORE Org | Procedure Engine Hook | Cao |
| **E-06** | Xóa nhân viên (Soft Delete) | HRM | Chấm dứt các bổ nhiệm hiện có và giải phóng vị trí trên cây tổ chức | CORE Assignments | Outbox Event → Domain Command | Cao |
| **E-07** | Cập nhật thông tin cá nhân (CCCD, SĐT) | HRM | Không tác động sang sơ đồ tổ chức CORE (Tách biệt dữ liệu) | CORE Org | Bỏ qua (No-op) | Thấp |
| **E-08** | Thêm mới Node chức danh trên cây tổ chức | CORE Org | Gợi ý HR cấu hình thang bậc lương và mô tả công việc (JD) bên HRM | HRM UI Prompt | UI Notification | Thấp |

---

## 5. THIẾT KẾ DATABASE MIGRATIONS (SQL) CHUẨN TENANT-SAFE

### Migration 1: Bổ sung liên kết `employee_id` và Career History View
*Đường dẫn tệp:* `migrations/tenant/core/0007-org-hrm-bridge.sql`

```sql
-- 1. Bổ sung employee_id vào bảng organization_node_assignments
ALTER TABLE core_schema.organization_node_assignments
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES core_schema.employees(id) ON DELETE RESTRICT;

-- 2. Backfill an toàn dữ liệu hiện có từ user_id sang employee_id (bảo đảm cùng tenant_id)
UPDATE core_schema.organization_node_assignments a
SET employee_id = e.id
FROM core_schema.employees e
WHERE e.user_id = a.user_id
  AND e.tenant_id = a.tenant_id
  AND a.employee_id IS NULL
  AND a.deleted_at IS NULL;

-- 3. Tạo Index tối ưu hóa truy vấn quá trình công tác (bao gồm tenant_id)
CREATE INDEX IF NOT EXISTS idx_org_assignments_tenant_emp_career
  ON core_schema.organization_node_assignments (tenant_id, employee_id, status, start_date DESC)
  WHERE deleted_at IS NULL;

-- 4. View Quá trình công tác hợp nhất (Hỗ trợ truy vấn từ HRM)
CREATE OR REPLACE VIEW core_schema.employee_career_history AS
SELECT
  a.id AS assignment_id,
  a.tenant_id,
  a.employee_id,
  a.user_id,
  a.node_id AS position_node_id,
  pos.name  AS position_name,
  pos.code  AS position_code,
  unit.id   AS unit_node_id,
  unit.name AS unit_name,
  a.is_primary,
  a.start_date,
  a.end_date,
  a.status,
  a.note,
  a.created_at,
  a.updated_at
FROM core_schema.organization_node_assignments a
JOIN core_schema.organization_nodes pos ON pos.id = a.node_id AND pos.deleted_at IS NULL
LEFT JOIN core_schema.organization_nodes unit ON unit.id = pos.parent_id AND unit.deleted_at IS NULL
WHERE a.deleted_at IS NULL;
```

---

### Migration 2: Outbox Triggers cho Sự Kiện Tổ Chức (CORE)
*Đường dẫn tệp:* `migrations/tenant/core/0008-org-outbox-triggers.sql`

```sql
-- Hàm trigger ghi nhận sự kiện bổ nhiệm / thay đổi phân công kèm tenantId
CREATE OR REPLACE FUNCTION core_schema.record_assignment_event() RETURNS trigger AS $$
DECLARE 
  v_event_id uuid := gen_random_uuid();
  v_event_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'core.org.assignment.created';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IN ('ended', 'inactive') AND OLD.status = 'active' THEN
      v_event_type := 'core.org.assignment.ended';
    ELSE
      v_event_type := 'core.org.assignment.updated';
    END IF;
  END IF;

  INSERT INTO integration_schema.outbox_events
    (id, tenant_id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
  VALUES (
    v_event_id,
    NEW.tenant_id,
    'org-assignment',
    NEW.id::text,
    v_event_type,
    1,
    jsonb_build_object(
      'eventId', v_event_id,
      'eventType', v_event_type,
      'eventVersion', 1,
      'tenantId', NEW.tenant_id,
      'source', jsonb_build_object('module', 'core', 'service', 'organization'),
      'aggregate', jsonb_build_object('type', 'org-assignment', 'id', NEW.id),
      'occurredAt', now(),
      'payload', jsonb_build_object(
        'assignmentId', NEW.id,
        'nodeId',       NEW.node_id,
        'userId',       NEW.user_id,
        'employeeId',   NEW.employee_id,
        'status',       NEW.status,
        'startDate',    NEW.start_date,
        'endDate',      NEW.end_date,
        'isPrimary',    NEW.is_primary
      )
    ),
    now()
  );
  RETURN NEW;
END; 
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_core_assignment_event ON core_schema.organization_node_assignments;
CREATE TRIGGER trg_core_assignment_event
  AFTER INSERT OR UPDATE OF status, is_primary, end_date, employee_id
  ON core_schema.organization_node_assignments
  FOR EACH ROW EXECUTE FUNCTION core_schema.record_assignment_event();

-- Hàm trigger khi node chức danh (category = position) bị xóa
CREATE OR REPLACE FUNCTION core_schema.record_position_node_deleted() RETURNS trigger AS $$
DECLARE
  v_event_id uuid := gen_random_uuid();
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND NEW.category = 'position' THEN
    INSERT INTO integration_schema.outbox_events
      (id, tenant_id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
    VALUES (
      v_event_id,
      NEW.tenant_id,
      'org-node',
      NEW.id::text,
      'core.org.position.deleted',
      1,
      jsonb_build_object(
        'eventId', v_event_id,
        'eventType', 'core.org.position.deleted',
        'eventVersion', 1,
        'tenantId', NEW.tenant_id,
        'source', jsonb_build_object('module', 'core', 'service', 'organization'),
        'aggregate', jsonb_build_object('type', 'org-node', 'id', NEW.id),
        'occurredAt', now(),
        'payload', jsonb_build_object(
          'nodeId', NEW.id,
          'name', NEW.name,
          'code', NEW.code,
          'deletedAt', NEW.deleted_at
        )
      ),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_core_node_deleted ON core_schema.organization_nodes;
CREATE TRIGGER trg_core_node_deleted
  AFTER UPDATE OF deleted_at ON core_schema.organization_nodes
  FOR EACH ROW EXECUTE FUNCTION core_schema.record_position_node_deleted();
```

---

### Migration 3: Outbox Trigger cho Sự Kiện Nghỉ Việc (HRM)
*Đường dẫn tệp:* `migrations/tenant/hrm/0021-hrm-offboarding-event.sql`

```sql
-- Hàm trigger ghi nhận sự kiện nhân viên nghỉ việc kèm tenantId tường minh
CREATE OR REPLACE FUNCTION hrm_schema.record_employee_offboarded_event() RETURNS trigger AS $$
DECLARE
  v_event_id uuid := gen_random_uuid();
  v_tenant_id uuid;
BEGIN
  IF NEW.employment_status IN ('RESIGNED', 'TERMINATED')
     AND OLD.employment_status NOT IN ('RESIGNED', 'TERMINATED') THEN
     
    -- Lấy tenant_id từ bảng core.employees
    SELECT tenant_id INTO v_tenant_id FROM core_schema.employees WHERE id = NEW.employee_id;

    INSERT INTO integration_schema.outbox_events
      (id, tenant_id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
    VALUES (
      v_event_id,
      v_tenant_id,
      'hrm-employee',
      NEW.employee_id::text,
      'hrm.employee.offboarded',
      1,
      jsonb_build_object(
        'eventId', v_event_id,
        'eventType', 'hrm.employee.offboarded',
        'eventVersion', 1,
        'tenantId', v_tenant_id,
        'source', jsonb_build_object('module', 'hrm', 'service', 'employee'),
        'aggregate', jsonb_build_object('type', 'employee', 'id', NEW.employee_id),
        'occurredAt', now(),
        'payload', jsonb_build_object(
          'employeeId', NEW.employee_id,
          'employmentStatus', NEW.employment_status,
          'effectiveDate', CURRENT_DATE
        )
      ),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hrm_employee_offboarded ON hrm_schema.employee_profiles;
CREATE TRIGGER trg_hrm_employee_offboarded
  AFTER UPDATE OF employment_status ON hrm_schema.employee_profiles
  FOR EACH ROW EXECUTE FUNCTION hrm_schema.record_employee_offboarded_event();
```

---

## 6. HẠ TẦNG INTEGRATION: OUTBOX, INBOX, MULTI-WORKER, RETRY & DLQ

### 6.1. Bảng Inbox Khóa Ba Thành Phần (Tenant-Safe Idempotency)
Bổ sung `tenant_id` vào `integration_schema.inbox_messages`:
```sql
ALTER TABLE integration_schema.inbox_messages
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- Ràng buộc duy nhất theo Tenant
ALTER TABLE integration_schema.inbox_messages
  DROP CONSTRAINT IF EXISTS inbox_messages_pkey,
  ADD PRIMARY KEY (tenant_id, consumer, event_id);
```

### 6.2. Cơ Chế Xử Lý Lỗi, Retry và Dead Letter Queue (DLQ)
Vòng đời trạng thái sự kiện:
```
[PENDING] ──> [PROCESSING] ──(Thành công)──> [PUBLISHED]
                    │
                 (Thất bại)
                    │
                    ├── Attempts < 5 ──> [RETRY with Exponential Backoff]
                    └── Attempts >= 5 ──> [DEAD_LETTER] (Cần can thiệp/Replay)
```
- Khi `attempts >= 5`, sự kiện được chuyển trạng thái `DEAD_LETTER` và ghi nhận đầy đủ stack trace vào `last_error`.
- Cung cấp API nội bộ cho phép kỹ thuật viên sau khi fix bug có thể kích hoạt **Replay DLQ Events** theo từng `tenant_id`.

### 6.3. Multi-Worker & Noisy Neighbor Protection
- **Multi-Worker Safety:** Tránh dùng cờ boolean trong RAM (`isProcessing`). Sử dụng mệnh đề an toàn Postgres:
  ```sql
  SELECT id FROM integration_schema.outbox_events
  WHERE published_at IS NULL AND status != 'DEAD_LETTER'
  ORDER BY occurred_at ASC
  LIMIT 50
  FOR UPDATE SKIP LOCKED;
  ```
- **Noisy Neighbor Protection:** Mỗi tenant chỉ được phân bổ xử lý tối đa 25 events trong một batch. Nếu một tenant nạp 50,000 events cũng không gây starvation cho các tenant còn lại.

---

## 7. THIẾT KẾ BACKEND SERVICE (NESTJS) THEO MÔ HÌNH EVENT → COMMAND

Bridge **không trực tiếp chạy raw SQL ghi vào bảng domain khác**, mà dịch Event thành **Domain Command** để tôn trọng Business Rules của domain đó.

*Đường dẫn:* `packages/modules/hrm/src/lib/infrastructure/org-hrm-bridge.consumer.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Pool } from 'pg';

interface OutboxEnvelope {
  id: string;
  tenant_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: {
    eventId: string;
    eventType: string;
    tenantId: string;
    payload: any;
  };
}

@Injectable()
export class OrgHrmBridgeConsumer {
  private readonly logger = new Logger(OrgHrmBridgeConsumer.name);

  constructor(
    private readonly tenantPoolProvider: any,
    private readonly coreOrgService: any,   // Inject Domain Service thay vì raw SQL
    private readonly hrmProfileService: any,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleOutboxBatch() {
    // 1. Chỉ lấy danh sách các Tenant đang CÓ outbox pending (tránh polling rác toàn bộ tenant)
    const activeTenantsWithEvents = await this.tenantPoolProvider.getTenantsWithPendingEvents();

    for (const tenantId of activeTenantsWithEvents) {
      await this.processEventsForTenant(tenantId);
    }
  }

  private async processEventsForTenant(tenantId: string): Promise<void> {
    const pool: Pool = await this.tenantPoolProvider.getPoolForTenant(tenantId);
    
    // Multi-worker an toàn với SKIP LOCKED và giới hạn batch 25 (chống Noisy Neighbor)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const res = await client.query<OutboxEnvelope>(`
        SELECT id, tenant_id, aggregate_type, aggregate_id, event_type, payload
        FROM integration_schema.outbox_events
        WHERE published_at IS NULL
          AND tenant_id = $1
          AND attempts < 5
          AND event_type IN (
            'hrm.employee.offboarded',
            'core.org.assignment.created',
            'core.org.assignment.ended',
            'core.org.position.deleted'
          )
        ORDER BY occurred_at ASC
        LIMIT 25
        FOR UPDATE SKIP LOCKED
      `, [tenantId]);

      for (const record of res.rows) {
        try {
          await this.dispatchCommand(client, tenantId, record);

          await client.query(`
            UPDATE integration_schema.outbox_events 
            SET published_at = now(), status = 'PUBLISHED' 
            WHERE id = $1 AND tenant_id = $2
          `, [record.id, tenantId]);
        } catch (err: any) {
          this.logger.error(`Error processing event ${record.id} for tenant ${tenantId}`, err);

          await client.query(`
            UPDATE integration_schema.outbox_events 
            SET attempts = attempts + 1, 
                last_error = $3,
                status = CASE WHEN attempts + 1 >= 5 THEN 'DEAD_LETTER' ELSE 'RETRYING' END
            WHERE id = $1 AND tenant_id = $2
          `, [record.id, tenantId, String(err.message || err)]);
        }
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      this.logger.error(`Transaction failed for tenant ${tenantId}`, txErr);
    } finally {
      client.release();
    }
  }

  private async dispatchCommand(client: any, tenantId: string, record: OutboxEnvelope): Promise<void> {
    // Idempotency check với bộ 3: (tenant_id, consumer, event_id)
    const exists = await client.query(`
      SELECT 1 FROM integration_schema.inbox_messages 
      WHERE tenant_id = $1 AND consumer = 'org-hrm-bridge' AND event_id = $2
    `, [tenantId, record.id]);

    if (exists.rowCount && exists.rowCount > 0) return;

    const data = record.payload.payload || record.payload;

    switch (record.event_type) {
      // E-04: Dịch sang Domain Command DeactivateAssignments
      case 'hrm.employee.offboarded':
        await this.coreOrgService.executeDeactivateAssignmentsCommand(client, {
          tenantId,
          employeeId: data.employeeId,
          effectiveDate: data.effectiveDate,
        });
        break;

      // E-01: Dịch sang Projection Refresh & Resolve Employee ID
      case 'core.org.assignment.created':
        await this.coreOrgService.executeResolveAssignmentEmployeeCommand(client, {
          tenantId,
          assignmentId: data.assignmentId,
          userId: data.userId,
        });
        break;

      // E-03: Dịch sang Domain Command DeactivatePositionProfile
      case 'core.org.position.deleted':
        await this.hrmProfileService.executeDeactivatePositionCommand(client, {
          tenantId,
          positionNodeId: data.nodeId,
        });
        break;
    }

    // Đánh dấu đã tiêu thụ message
    await client.query(`
      INSERT INTO integration_schema.inbox_messages (tenant_id, consumer, event_id, processed_at)
      VALUES ($1, 'org-hrm-bridge', $2, now())
      ON CONFLICT (tenant_id, consumer, event_id) DO NOTHING
    `, [tenantId, record.id]);
  }
}
```

---

## 8. THIẾT KẾ APIS: CAREER HISTORY & SNAPSHOT

### 8.1. Endpoint Lịch Sử Bổ Nhiệm (HRM Controller)
Thêm vào [hrm-employee.controller.ts](file:///d:/CRM/enterprise-platform/packages/modules/hrm/src/lib/presentation/hrm-employee.controller.ts):

```typescript
@Get('employees/:employeeId/career-history')
async getCareerHistory(
  @Req() req: Request,
  @Param('employeeId') employeeId: string,
) {
  const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.employee.read');
  requireUuid(employeeId, 'employeeId');

  // Đọc từ Projection View, bắt buộc lọc theo tenant_id
  const query = `
    SELECT 
      assignment_id,
      position_node_id,
      position_name,
      position_code,
      unit_node_id,
      unit_name,
      is_primary,
      start_date,
      end_date,
      status,
      note
    FROM core_schema.employee_career_history
    WHERE tenant_id = $1
      AND (
        employee_id = $2 
        OR user_id = (SELECT user_id FROM core_schema.employees WHERE id = $2 AND tenant_id = $1)
      )
    ORDER BY start_date DESC NULLS LAST, created_at DESC;
  `;

  const result = await pool.query(query, [tenantId, employeeId]);

  return {
    data: result.rows.map(row => ({
      assignmentId: row.assignment_id,
      positionNodeId: row.position_node_id,
      positionName: row.position_name,
      positionCode: row.position_code,
      unitNodeId: row.unit_node_id,
      unitName: row.unit_name || 'Hội đồng / Trực thuộc doanh nghiệp',
      isPrimary: Boolean(row.is_primary),
      startDate: row.start_date,
      endDate: row.end_date,
      status: row.status,
      note: row.note,
    }))
  };
}
```

### 8.2. CORE Organization Snapshot Hỗ Trợ Employee Chưa Có User
Nâng cấp `coreOrganizationSnapshot()` tại [platform-identity.service.ts](file:///d:/CRM/enterprise-platform/packages/platform/identity/src/lib/platform-identity.service.ts):
```sql
SELECT 
  e.id AS "employeeId",
  ep.employee_code AS "employeeCode",
  e.full_name AS "fullName",
  e.work_email AS "workEmail",
  e.user_id AS "userId",
  ep.employment_status AS "employmentStatus"
FROM core_schema.employees e
JOIN hrm_schema.employee_profiles ep ON ep.employee_id = e.id AND ep.deleted_at IS NULL
WHERE e.tenant_id = $tenantId 
  AND e.deleted_at IS NULL
  AND ep.employment_status NOT IN ('RESIGNED', 'TERMINATED')
ORDER BY e.full_name ASC;
```

---

## 9. THIẾT KẾ GIAO DIỆN NGƯỜI DÙNG (UI/UX CHUẨN HÓA)

### 9.1. Chuẩn Hóa Thuật Ngữ & Quy Cách
- **Quy chuẩn Icon:** 100% sử dụng icon chuẩn SVG từ `lucide-react` (`Briefcase`, `Calendar`, `Building2`, `CheckCircle2`), tuyệt đối không dùng Emoji.
- **Thuật ngữ chuẩn xác:** `isPrimary` hiển thị là **"Chức danh chính"** (Primary assignment), không dùng chữ "Chính thức" để tránh nhầm lẫn với trạng thái Hợp đồng chính thức.

### 9.2. Cập nhật Tab Quá Trình Công Tác trong `profile-screen.tsx`
Tệp: [packages/features/hrm/src/lib/screens/profile-screen.tsx](file:///d:/CRM/enterprise-platform/packages/features/hrm/src/lib/screens/profile-screen.tsx)

```tsx
{activeTab === 'work_history' && (
  <Card className="p-6 bg-card border-border">
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-2">
        <Briefcase className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Quá trình công tác & Bổ nhiệm chức danh</h3>
      </div>
      <Button 
        variant="outline" 
        size="sm"
        onClick={() => window.open(`/organization?highlight=${employeeId}`, '_blank')}
        className="text-xs"
      >
        Xem trên Sơ đồ tổ chức
      </Button>
    </div>

    {loadingCareer ? (
      <div className="py-8 text-center text-sm text-muted-foreground">Đang tải lịch sử bổ nhiệm...</div>
    ) : careerHistory.length === 0 ? (
      <div className="py-8 text-center text-sm text-muted-foreground">Chưa có thông tin bổ nhiệm chức danh nào.</div>
    ) : (
      <div className="relative pl-6 space-y-8 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[2px] before:bg-border">
        {careerHistory.map((item) => {
          const isActive = item.status === 'active' && !item.endDate;
          return (
            <div key={item.assignmentId} className="relative group">
              <div 
                className={`absolute -left-[27px] top-1.5 h-3.5 w-3.5 rounded-full border-2 bg-background ${
                  isActive ? 'border-primary ring-4 ring-primary/10' : 'border-muted-foreground/40'
                }`} 
              />
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-foreground text-sm">
                    {item.positionName}
                  </span>
                  <Badge variant={isActive ? 'default' : 'secondary'} className="text-[10px] py-0 px-1.5">
                    {isActive ? 'Đang đương nhiệm' : 'Đã kết thúc nhiệm kỳ'}
                  </Badge>
                  {item.isPrimary && (
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-primary border-primary/30">
                      Chức danh chính
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>
                    {item.startDate ? new Date(item.startDate).toLocaleDateString('vi-VN') : '---'}
                    {' → '}
                    {item.endDate ? new Date(item.endDate).toLocaleDateString('vi-VN') : 'Hiện tại'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                <span>{item.unitName}</span>
                {item.positionCode && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted">
                    {item.positionCode}
                  </span>
                )}
              </div>

              {item.note && (
                <p className="mt-2 text-xs text-muted-foreground/90 bg-muted/30 p-2 rounded-md">
                  {item.note}
                </p>
              )}
            </div>
          );
        })}
      </div>
    )}
  </Card>
)}
```

---

## 10. LỘ TRÌNH TRIỂN KHAI CHI TIẾT (PHASE 0 ĐẾN PHASE 5)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 0: CONTRACT & SAAS BOUNDARY DEFINITIONS (Không code trước khi chốt)   │
├─────────────────────────────────────────────────────────────────────────────┤
│ - Thống nhất nguyên tắc Employee != User; employee_id là Authoritative ID. │
│ - Chốt Event Envelope có tenantId, eventVersion, aggregate.                 │
│ - Xác lập Idempotency Key (tenant_id, consumer, event_id).                  │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: DATABASE EVOLUTION & TENANT ISOLATION                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Migration 0007: Thêm employee_id vào assignments + index theo tenant_id.  │
│ 2. Backfill script có báo cáo: Mapped, Unmapped, Invalid.                   │
│ 3. Tạo View `core_schema.employee_career_history` có chứa tenant_id.         │
│ 4. Migration 0008 & 0021: Outbox triggers có tenant_id.                     │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: INTEGRATION INFRASTRUCTURE (RELIABILITY & MULTI-WORKER)            │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Hoàn thiện Outbox Consumer với FOR UPDATE SKIP LOCKED.                   │
│ 2. Triển khai cơ chế Retry với Exponential Backoff và Dead Letter Queue.    │
│ 3. Giới hạn hạn mức batch theo tenant để tránh Noisy Neighbor.              │
│ 4. Xây dựng API Replay sự kiện lỗi trong DLQ cho kỹ thuật viên.             │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: CORE ↔ HRM DOMAIN INTEGRATION (EVENT TO COMMAND)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Triển khai E-04 (Offboarding) -> gọi CoreOrgService.deactivateAssignments│
│ 2. Triển khai E-01 (Assignment created) -> Sync employee reference.         │
│ 3. Triển khai E-02 (Assignment ended) & E-03 (Position deleted).            │
│ 4. Kiểm thử Idempotency khi có duplicate events.                            │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: APIS & FRONTEND ADAPTATION                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Endpoint `GET /v1/employees/:employeeId/career-history`.                 │
│ 2. Cải tiến CORE Organization snapshot hỗ trợ chọn Employee không có User.  │
│ 3. Render dynamic timeline trong `profile-screen.tsx` (xóa hardcode).       │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 5: VALIDATION, OBSERVABILITY & METRICS                                │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Kiểm thử Tenant Isolation: Tuyệt đối không đọc chéo tenant.              │
│ 2. Dashboard Observability: Theo dõi số event pending, DLQ, processing time.│
│ 3. Kiểm thử tải khi 1 tenant có lượng sự kiện đột biến.                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 11. BỘ TIÊU CHÍ NGHIỆM THU TOÀN DIỆN (ACCEPTANCE CRITERIA)

### A. Ranh Giới Danh Tính (Identity)
- [ ] **AC-1:** Nhân viên chưa có tài khoản User (`user_id = null`) vẫn được bổ nhiệm bình thường trên sơ đồ tổ chức thông qua `employee_id`.
- [ ] **AC-2:** Việc khóa hoặc unlink tài khoản User không làm mất hay sai lệch lịch sử bổ nhiệm của nhân sự đó.

### B. Cô Lập Tenant (Tenant Isolation)
- [ ] **AC-3:** Mọi sự kiện phát ra trong `outbox_events` bắt buộc có `tenant_id`.
- [ ] **AC-4:** Worker xử lý event theo từng `tenant_id` độc lập; không thể truy vấn hay cập nhật dữ liệu của tenant khác.
- [ ] **AC-5:** `inbox_messages` xác định duy nhất bằng `(tenant_id, consumer, event_id)`.

### C. Đồng Bộ & Nghiệp Vụ (Synchronization)
- [ ] **AC-6 (Nghỉ việc thu hồi chức danh):** Khi chuyển nhân viên sang trạng thái `RESIGNED` hoặc `TERMINATED`, toàn bộ bổ nhiệm active trên sơ đồ tổ chức tự động chuyển thành `inactive` và gán `end_date`.
- [ ] **AC-7 (Lịch sử bổ nhiệm tức thì):** Bổ nhiệm mới trên cây tổ chức hiển thị ngay lập tức trong Tab Quá trình công tác bên HRM Profile.
- [ ] **AC-8 (Xóa chức danh):** Xóa node chức danh trong CORE làm vô hiệu hóa `position_profiles` bên HRM.

### D. Độ Tin Cậy & Khả Năng Chịu Lỗi (Reliability & Resilience)
- [ ] **AC-9 (Multi-Worker):** Khi chạy nhiều replica backend, không có hiện tượng xử lý trùng lặp nhờ `FOR UPDATE SKIP LOCKED`.
- [ ] **AC-10 (Bridge Downtime):** Nếu Bridge Service tạm dừng hoạt động, các thao tác nghiệp vụ bên HRM và CORE vẫn lưu thành công bình thường vào database; Bridge sẽ xử lý bù sau khi khởi động lại.
- [ ] **AC-11 (DLQ & Replay):** Sự kiện lỗi quá 5 lần được đưa vào trạng thái `DEAD_LETTER`; có thể kích hoạt Replay sau khi khắc phục lỗi.
- [ ] **AC-12 (Noisy Neighbor):** Một tenant có lượng sự kiện lớn không làm nghẽn quá trình xử lý của các tenant khác.

### E. Giao Diện Người Dùng (UI/UX)
- [ ] **AC-13:** Xóa bỏ hoàn toàn timeline hardcoded trong `profile-screen.tsx`.
- [ ] **AC-14:** `isPrimary` được hiển thị rõ ràng là nhãn **"Chức danh chính"**.
- [ ] **AC-15:** Tuân thủ chuẩn UI của dự án: Dark Theme, không dùng Emoji, sử dụng Lucide SVG icons.
