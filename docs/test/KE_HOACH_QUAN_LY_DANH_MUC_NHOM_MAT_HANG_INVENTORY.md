# Kế Hoạch & Phân Tích Kiến Trúc: Bổ Sung Danh Mục Quản Lý Nhóm Mặt Hàng Cho Phân Hệ Kho (Inventory)

- **Ngày lập:** 20/11/2026
- **Vị trí lưu:** `docs/test/KE_HOACH_QUAN_LY_DANH_MUC_NHOM_MAT_HANG_INVENTORY.md`
- **Mục tiêu:** Mở rộng danh mục nhóm mặt hàng linh hoạt (hỗ trợ tạo nhóm tùy biến mới như "test", "vật tư sản xuất"...) song song với việc bảo vệ 2 nhóm hệ thống cốt lõi ("Hàng hóa" và "Dịch vụ").
- **Mô hình tham chiếu:** Mô hình quản lý danh mục loại đơn và lý do đơn từ của phân hệ HRM (`request_reasons`, `leave_types`).
- **Phạm vi kỹ thuật:**
  - Database Migration: `migrations/tenant/inventory/`
  - Hợp đồng dùng chung: `packages/contracts/inventory`
  - Tầng dịch vụ & API: `packages/modules/inventory`
  - Giao diện người dùng: `packages/features/inventory`

---

## 1. Đặt Vấn Đề & Hiện Trạng Hệ Thống

### 1.1 Hiện trạng hiện tại
- Phân hệ Kho hiện đang **code cứng** hai nhóm cấp 1 duy nhất:
  - `GOODS` (Hàng hóa): Quản lý tồn kho vật lý, có vị trí ngăn kệ, theo dõi số lượng / lô / serial.
  - `SERVICE` (Dịch vụ): Không quản lý tồn kho vật lý, chỉ phục vụ bán hàng (báo giá, hợp đồng CRM).
- Ràng buộc này nằm ở 3 tầng:
  1. Database: Ràng buộc CHECK trong bảng `inventory_schema.materials` (`CHECK (kind IN ('STOCK', 'ASSET', 'SERVICE'))`) và trigger `reject_service_balance` chặn dòng tồn.
  2. Contracts: Kiểu dữ liệu cố định `export type TradeGroup = 'GOODS' | 'SERVICE'`.
  3. Giao diện: Form tạo mặt hàng và bộ lọc chỉ có 2 lựa chọn cố định trong ô chọn "Nhóm".

### 1.2 Yêu cầu nghiệp vụ mới
1. Cho phép Tenant Admin tạo thêm các **Nhóm mặt hàng tùy biến (Custom Groups)**, ví dụ nhóm "test", nhóm "bán thành phẩm", nhóm "nguyên vật liệu thô"...
2. Nhóm tùy biến có đầy đủ các trường thuộc tính tương tự như Hàng hóa và Dịch vụ (mã, tên, mô tả, có quản lý kho hay không, phân loại con, đơn giá...).
3. Tập trung toàn bộ việc quản lý các nhóm (Hàng hóa, Dịch vụ, Test...) vào **một tab danh mục riêng trong Cài đặt Kho (Settings)**.
4. **Phân quyền và bảo vệ tính toàn vẹn dữ liệu:**
   - Hai nhóm mặc định (`Hàng hóa`, `Dịch vụ`): Là nhóm hệ thống (`is_system = true`). **Chỉ có thể Ngưng sử dụng (`active = false`) hoặc Kích hoạt lại (`active = true`), tuyệt đối không được xóa mềm**.
   - Các nhóm mới tạo (Custom): Có cờ `is_system = false`. Cho phép Sửa, Ngưng sử dụng, Tái sử dụng và Xóa mềm (Soft Delete).
   - Nếu nhóm custom đã có mặt hàng liên kết: Hệ thống từ chối xóa mềm và tự động chuyển sang trạng thái Ngưng sử dụng kèm thông báo rõ ràng cho người dùng.

---

## 2. Mô Hình Tham Chiếu Từ Phân Hệ HRM

Trong HRM, việc quản lý danh mục lý do đơn từ (`hrm_schema.request_reasons`) và loại nghỉ phép (`hrm_schema.leave_types`) được thiết kế theo chuẩn:

```
[Bảng Danh mục Cài đặt]
  ├── Cột is_system: Phân biệt mục do hệ sinh thái định nghĩa sẵn vs mục do người dùng tạo.
  ├── Cột active: Bật/tắt trạng thái sử dụng (áp dụng cho cả mục hệ thống lẫn mục custom).
  └── Cột deleted_at: Thời điểm xóa mềm (chỉ áp dụng cho mục custom).
```

### Quy tắc xử lý khi xóa mục:
1. Nếu `is_system = true` -> Chặn xóa từ tầng controller (báo lỗi "Mục hệ thống không thể xóa, chỉ có thể ngưng sử dụng").
2. Nếu `is_system = false`:
   - Đếm số lượng bản ghi phụ thuộc (`usageCount = COUNT(*)`).
   - Nếu `usageCount = 0` -> Ghi nhận `deleted_at = now()`.
   - Nếu `usageCount > 0` -> Không xóa dữ liệu để bảo toàn lịch sử; cập nhật `active = false` (ngưng sử dụng) và phản hồi thông báo cảnh báo cho người dùng.

---

## 3. Thiết Kế Chi Tiết Từng Tầng Kỹ Thuật

### 3.1 Tầng Cơ sở dữ liệu (Database Schema)

Tạo file migration `migrations/tenant/inventory/0029-material-groups-catalog.sql`:

```sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- 1. Bảng danh mục nhóm mặt hàng
CREATE TABLE IF NOT EXISTS inventory_schema.material_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    has_stock BOOLEAN NOT NULL DEFAULT true,  -- Có quản lý tồn kho không
    is_system BOOLEAN NOT NULL DEFAULT false, -- Mục hệ thống hay tùy biến
    active BOOLEAN NOT NULL DEFAULT true,     -- Đang dùng / Ngưng dùng
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_material_groups_code UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_material_groups_active 
    ON inventory_schema.material_groups (tenant_id, active, sort_order) 
    WHERE deleted_at IS NULL;

-- 2. Thêm cột group_code vào bảng materials để liên kết
ALTER TABLE inventory_schema.materials
    ADD COLUMN IF NOT EXISTS group_code VARCHAR(50);

-- Đồng bộ dữ liệu cũ: kind = 'SERVICE' -> group_code = 'SERVICE', còn lại là 'GOODS'
UPDATE inventory_schema.materials
   SET group_code = CASE WHEN kind = 'SERVICE' THEN 'SERVICE' ELSE 'GOODS' END
 WHERE group_code IS NULL;

-- 3. Nạp 2 nhóm hệ thống mặc định cho mọi tenant hiện có
INSERT INTO inventory_schema.material_groups 
    (tenant_id, code, name, description, has_stock, is_system, sort_order)
SELECT id, 'GOODS', 'Hàng hóa', 'Hàng hóa thương mại, phụ tùng, vật tư có quản lý tồn kho', true, true, 10 
  FROM tenant_schema.tenants
 UNION ALL
SELECT id, 'SERVICE', 'Dịch vụ', 'Dịch vụ kỹ thuật, bảo trì, lắp đặt, không quản lý tồn kho', false, true, 20 
  FROM tenant_schema.tenants
ON CONFLICT (tenant_id, code) DO NOTHING;
```

---

### 3.2 Tầng Hợp đồng Giao tiếp (`@enterprise-platform/contracts-inventory`)

Cập nhật file `packages/contracts/inventory/src/lib/contracts-inventory.ts`:

```typescript
export interface MaterialGroup {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly hasStock: boolean;
  readonly isSystem: boolean;
  readonly active: boolean;
  readonly sortOrder: number;
  readonly usageCount?: number;
}

export interface CreateMaterialGroupRequest {
  readonly code?: string;
  readonly name: string;
  readonly description?: string;
  readonly hasStock: boolean;
  readonly sortOrder?: number;
}

export interface UpdateMaterialGroupRequest {
  readonly name?: string;
  readonly description?: string;
  readonly hasStock?: boolean;
  readonly active?: boolean;
  readonly sortOrder?: number;
}

export interface DeleteMaterialGroupResult {
  readonly id: string;
  readonly deleted: boolean;
  readonly active: boolean;
  readonly usageCount: number;
  readonly message: string;
}
```

---

### 3.3 Tầng Nghiệp vụ Backend (`packages/modules/inventory`)

Xây dựng kho lưu trữ `postgres-material-group.store.ts` và tầng ứng dụng:

```typescript
export class MaterialGroupService {
  constructor(
    private readonly groupStore: MaterialGroupStore,
    private readonly materialStore: MaterialStore,
  ) {}

  async list(tenantId: string, includeInactive = false): Promise<MaterialGroup[]> {
    return this.groupStore.list(tenantId, includeInactive);
  }

  async create(tenantId: string, input: CreateMaterialGroupRequest): Promise<MaterialGroup> {
    const code = (input.code?.trim() || `GRP_${Date.now()}`).toUpperCase();
    const existing = await this.groupStore.findByCode(tenantId, code);
    if (existing) throw new BadRequestException(`Mã nhóm "${code}" đã tồn tại.`);

    return this.groupStore.create(tenantId, {
      ...input,
      code,
      isSystem: false,
    });
  }

  async update(tenantId: string, id: string, patch: UpdateMaterialGroupRequest): Promise<MaterialGroup> {
    const current = await this.groupStore.findById(tenantId, id);
    if (!current) throw new NotFoundException('Không tìm thấy nhóm mặt hàng.');

    // Nhóm hệ thống không cho phép đổi cờ quản lý tồn kho
    if (current.isSystem && patch.hasStock !== undefined && patch.hasStock !== current.hasStock) {
      throw new BadRequestException('Không thể thay đổi cờ quản lý tồn kho của nhóm hệ thống.');
    }

    return this.groupStore.update(tenantId, id, patch);
  }

  async delete(tenantId: string, id: string): Promise<DeleteMaterialGroupResult> {
    const group = await this.groupStore.findById(tenantId, id);
    if (!group) throw new NotFoundException('Không tìm thấy nhóm mặt hàng.');

    // 1. Kiểm tra nhóm hệ thống
    if (group.isSystem) {
      throw new BadRequestException('Nhóm hệ thống không thể xóa, chỉ có thể ngưng sử dụng.');
    }

    // 2. Kiểm tra mặt hàng liên kết
    const usageCount = await this.materialStore.countByGroup(tenantId, group.code);
    if (usageCount > 0) {
      await this.groupStore.update(tenantId, id, { active: false });
      return {
        id,
        deleted: false,
        active: false,
        usageCount,
        message: `Nhóm "${group.name}" đã có ${usageCount} mặt hàng sử dụng nên hệ thống chỉ chuyển sang trạng thái ngưng sử dụng.`,
      };
    }

    // 3. Thực hiện xóa mềm
    await this.groupStore.softDelete(tenantId, id);
    return {
      id,
      deleted: true,
      active: false,
      usageCount: 0,
      message: `Đã xóa nhóm mặt hàng "${group.name}".`,
    };
  }
}
```

---

### 3.4 Tầng Giao diện Người dùng (Frontend UI)

#### 1. Tab quản lý nhóm trong Cài đặt Kho
Tạo component `packages/features/inventory/src/lib/components/material-groups-setting-tab.tsx`:
- Giao diện dạng Data Grid (Bảng dữ liệu).
- Cột thông tin:
  - Mã nhóm
  - Tên nhóm
  - Tính chất (Có quản lý tồn kho / Không quản lý tồn kho)
  - Phân loại (Badge `Hệ thống` màu xám / Badge `Tùy biến` màu xanh)
  - Trạng thái (`Đang sử dụng` / `Ngưng sử dụng`)
  - Số lượng mặt hàng đang gắn
  - Thao tác:
    - Nhóm `Hàng hóa` & `Dịch vụ`: Nút **Sửa**, Nút **Ngưng sử dụng / Kích hoạt lại** (Ẩn nút Xóa).
    - Nhóm `Test` (Custom): Nút **Sửa**, Nút **Ngưng sử dụng / Kích hoạt lại**, Nút **Xóa mềm** (Kèm hộp thoại xác nhận).

#### 2. Đồng bộ Form Tạo/Sửa Hàng hóa (`trade-item-form-dialog.tsx`)
- Thay thế biến cố định `TRADE_GROUP_LABEL` bằng dữ liệu tải từ API `loadMaterialGroups()`.
- Ô chọn **Nhóm** sẽ nạp tất cả các nhóm có `active = true`.
- Khi người dùng chọn nhóm `Test`:
  - Nếu nhóm có `hasStock = true`: Hiển thị các trường tồn kho, định mức tối thiểu/tối đa, vị trí ngăn kệ.
  - Nếu nhóm có `hasStock = false`: Ẩn các trường tồn kho (tương tự như hành vi của Dịch vụ).

#### 3. Đồng bộ Bộ lọc trên Danh mục Hàng hóa (`trade-items-page.tsx`)
- Dropdown bộ lọc Nhóm tự động hiển thị danh sách các nhóm đang có trong hệ thống (`Hàng hóa`, `Dịch vụ`, `Test`...).
- Bổ sung đếm số lượng mặt hàng theo từng nhóm.

---

## 4. Ma Trận Quyền Hạn & Hành Vi Giữa Các Nhóm

| Tiêu chí | Hàng hóa (`GOODS`) | Dịch vụ (`SERVICE`) | Nhóm Custom (`test`...) |
|---|:---:|:---:|:---:|
| **Phân loại cờ** | `is_system: true` | `is_system: true` | `is_system: false` |
| **Sửa Tên và Mô tả** | Cho phép | Cho phép | Cho phép |
| **Đổi tính chất có kho / không kho** | Khóa cố định (`true`) | Khóa cố định (`false`) | Cho phép khi tạo mới |
| **Ngưng sử dụng (`active = false`)** | **Cho phép** | **Cho phép** | **Cho phép** |
| **Kích hoạt lại (`active = true`)** | **Cho phép** | **Cho phép** | **Cho phép** |
| **Xóa mềm (`deleted_at = now()`)** | **CHẶN HOÀN TOÀN** | **CHẶN HOÀN TOÀN** | **Cho phép** *(nếu chưa có mặt hàng)* |
| **Xóa khi đã có mặt hàng** | Chặn | Chặn | Chuyển sang ngưng sử dụng |

---

## 5. Lộ Trình Triển Khai (5 Bước Chi Tiết)

1. **Bước 1: Viết Database Migration**
   - Tạo file `migrations/tenant/inventory/0029-material-groups-catalog.sql`.
   - Chạy `node tools/check-migrations.mjs` xác thực không có lỗi checksum.
2. **Bước 2: Cập nhật Contracts & Types**
   - Thêm interface và DTOs vào `packages/contracts/inventory`.
   - Kiểm tra `pnpm nx run contracts-inventory:typecheck`.
3. **Bước 3: Phát triển Tầng Backend (Store, Service, Controller)**
   - Viết unit test cho các ca xóa nhóm hệ thống và kiểm tra ràng buộc `usageCount`.
   - Kiểm tra `pnpm nx run inventory-api:typecheck`.
4. **Bước 4: Phát triển Giao diện Cài đặt & Tích hợp Form**
   - Dựng màn hình quản lý nhóm trong tab Cài đặt Kho.
   - Thay thế hardcode ở `trade-items-page.tsx` và `trade-item-form-dialog.tsx`.
   - Chạy `node tools/check-ui-rules.mjs` bảo đảm tuân thủ SearchableSelect và không có emoji.
5. **Bước 5: Kiểm thử Nghiệp vụ Thực tế (UAT)**
   - Tạo nhóm mới tên là "test" với cờ `hasStock = true`.
   - Tạo mặt hàng thuộc nhóm "test".
   - Thử ngưng sử dụng nhóm "test" -> Kiểm tra form tạo mặt hàng mới không còn nhóm "test".
   - Thử xóa nhóm "test" đã có hàng -> Kiểm tra hệ thống chuyển sang ngưng dùng và hiển thị cảnh báo.
   - Thử bấm nút xóa ở nhóm "Hàng hóa" hoặc "Dịch vụ" -> Xác nhận giao diện không có nút xóa và backend chặn hoàn toàn.
