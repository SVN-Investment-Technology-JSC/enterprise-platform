# Danh Sách Người Dùng & Hồ Sơ Nhân Sự Phân Hệ HRM (Tenant SAVINA)

> **Thông tin cơ bản môi trường kết nối:**
> - **Tenant Slug:** `savina`
> - **Tenant ID (UUID):** `c0195fb2-3073-445c-9768-b6d3aabaa7a8`
> - **Tenant Database URL:** `postgresql://tenant:tenant@localhost:55436/savina`
> - **Mật khẩu mặc định:** `ChangeMe-Docker-Tenant-123`

---

## 1. Cơ Chế Liên Kết Dữ Liệu (Core Schema ↔ HRM Schema)

1. **Khóa liên kết người dùng:**
   - Trường `hrm_schema.employee_profiles.employee_id` là Foreign Key liên kết trực tiếp với `core_schema.users.id`.
   - Khi tạo nhân viên mới trong HRM, `employee_id` **bắt buộc** phải khớp với `id` của một user đã tồn tại trong `core_schema.users`.

2. **Cơ cấu phòng ban / Chức danh:**
   - Dữ liệu phòng ban được gán qua bảng trung gian `core_schema.organization_node_assignments` trỏ tới `core_schema.organization_nodes.name`.

---

## 2. Bảng Danh Sách 45 Người Dùng (Users) Hiện Có

| STT | Họ và tên | Email | Phòng ban / Vị trí (`organization_nodes`) | Mã NV (`employee_code`) | Trạng thái HRM | User ID (`core_schema.users.id`) |
|:---:|---|---|---|:---:|:---:|---|
| 1 | **Bùi Công Quyền** | `bui.cong.quyen@savina.local` | Nhân viên thí nghiệm | _Chưa tạo_ | - | `fe5f4c6c-7881-4fe6-b882-481c352ba066` |
| 2 | **Bùi Duy Khánh** | `bui.duy.khanh@savina.local` | Nhân viên kỹ thuật | _Chưa tạo_ | - | `15cd0221-6271-4cfb-8d1f-551bd8e49813` |
| 3 | **Bùi Hữu Vân** | `bui.huu.van@savina.local` | Phó Trưởng phòng Kinh doanh | _Chưa tạo_ | - | `6aceef31-4e30-4c9e-913e-4811567802de` |
| 4 | **Bùi Long Quốc Huy** | `bui.long.quoc.huy@savina.local` | Nhân viên kỹ thuật | _Chưa tạo_ | - | `d028d861-f925-44e5-a3a4-aee8181f54c2` |
| 5 | **Cao Khánh Ngọc** | `cao.khanh.ngoc@savina.local` | Nhân viên marketing | _Chưa tạo_ | - | `f908a0e0-eb3f-449b-9d1b-9f7381851e76` |
| 6 | **Huỳnh Kim Việt** | `huynh.kim.viet@savina.local` | Chuyên viên kinh doanh | _Chưa tạo_ | - | `7de23cce-95d8-4474-b6f5-b1c58fd9d876` |
| 7 | **Huỳnh Thị Hồng Nhung** | `huynh.thi.hong.nhung@savina.local` | Nhân viên hành chính - văn thư | _Chưa tạo_ | - | `787a53ce-5919-44cb-9a01-7c5863035ced` |
| 8 | **Huỳnh Thị Đông** | `huynh.thi.dong@savina.local` | Tạp vụ | _Chưa tạo_ | - | `4186b444-c94b-40d7-9aaa-d2617f7e9c69` |
| 9 | **Huỳnh Văn Trọng** | `huynh.van.trong@savina.local` | Nhân viên thí nghiệm | _Chưa tạo_ | - | `496d94c5-6c5d-41c6-b198-eb9bf1791acd` |
| 10 | **Hà Nguyên Hoàng** | `ha.nguyen.hoang@savina.local` | Tổng Giám đốc | _Chưa tạo_ | - | `8d8f5536-d2d0-4517-be7f-de58201cb96f` |
| 11 | **Lê Minh Trí** | `le.minh.tri@savina.local` | Trưởng phòng Vận hành - Bảo trì | _Chưa tạo_ | - | `52dff3c5-9881-4d5c-9dce-d0662f896646` |
| 12 | **Lê Thị Tố Nga** | `le.thi.to.nga@savina.local` | Chuyên viên tài chính | _Chưa tạo_ | - | `b23cf60e-e039-4adc-b426-7f148aea4a38` |
| 13 | **Nguyễn Duy Thuận** | `nguyen.duy.thuan@savina.local` | Phó Tổng Giám đốc, Trưởng Văn phòng Đại diện | _Chưa tạo_ | - | `7059e3dd-b561-4d57-a2d5-54465d127f5c` |
| 14 | **Nguyễn Gia Bảo** | `nguyen.gia.bao@savina.local` | Kỹ thuật viên bảo trì | _Chưa tạo_ | - | `e9e5b1ca-d06c-4d3a-adcc-ac2bf3453341` |
| 15 | **Nguyễn Hồng Sang** | `nguyen.hong.sang@savina.local` | Chủ tịch Hội đồng Quản trị, Tổng Giám đốc | `KT-042` | `OFFICIAL` | `212b7280-7607-4607-ac02-4d8663ed718a` |
| 16 | **Nguyễn Hữu Hưng** | `nguyen.huu.hung@savina.local` | Nhân viên kinh doanh | _Chưa tạo_ | - | `1d372e76-1883-43ab-95a1-35b21dcd8556` |
| 17 | **Nguyễn Minh Ý** | `nguyen.minh.y@savina.local` | Nhân viên hành chính - văn thư | _Chưa tạo_ | - | `ee9394e7-92d6-4dac-80dd-9c670c2f841d` |
| 18 | **Nguyễn Thị Diễm My** | `nguyen.thi.diem.my@savina.local` | Nhân viên kinh doanh | _Chưa tạo_ | - | `3dfa9fe9-12b0-4a6c-b438-44f968b44c8f` |
| 19 | **Nguyễn Thị Thủy** | `nguyen.thi.thuy@savina.local` | Nhân viên hành chính - văn thư | _Chưa tạo_ | - | `666441b9-f705-4975-82dd-685f6283c13a` |
| 20 | **Nguyễn Trần Như Quỳnh** | `nguyen.tran.nhu.quynh@savina.local` | Trưởng phòng Hành chính - Tổng hợp | _Chưa tạo_ | - | `eed9c1c7-d7ab-413a-b528-3ac43e6f978c` |
| 21 | **Nguyễn Tấn Thịnh** | `nguyen.tan.thinh@savina.local` | Trưởng phòng Thí nghiệm | _Chưa tạo_ | - | `d33002a0-020e-4b7b-bf63-6fdbb2831422` |
| 22 | **Nguyễn Vũ Bảo Cường** | `nguyen.vu.bao.cuong@savina.local` | Phó Giám đốc Trung tâm | _Chưa tạo_ | - | `40d91d33-4551-441f-95b8-a6ad88346f19` |
| 23 | **Nguyễn Vũ Hậu** | `nguyen.vu.hau@savina.local` | Nhân viên kỹ thuật | _Chưa tạo_ | - | `ec6de1cd-094c-45fe-999c-7d5f738fe080` |
| 24 | **Ngô Tấn Trinh** | `ngo.tan.trinh@savina.local` | Phó Tổng Giám đốc | _Chưa tạo_ | - | `2117b844-dd30-43ef-90d2-0ab4b7394a5b` |
| 25 | **Phan Thị Diệu Thúy** | `phan.thi.dieu.thuy@savina.local` | Nhân viên | _Chưa tạo_ | - | `2bfcb59b-347a-4d1e-a986-42975e0d4ad2` |
| 26 | **Phan Trung Kiên** | `phan.trung.kien@savina.local` | Nhân viên kỹ thuật | _Chưa tạo_ | - | `21e285a2-85a6-40de-9ebc-12c731813298` |
| 27 | **Phan Đức Thắng** | `phan.duc.thang@savina.local` | Nhân viên thí nghiệm | _Chưa tạo_ | - | `56887b34-a1d0-46de-bfa7-e893bc70380b` |
| 28 | **Phạm Việt Quân** | `pham.viet.quan@savina.local` | Lái xe cơ quan | _Chưa tạo_ | - | `d67d4be6-d6b4-4f0d-9e55-749403db205f` |
| 29 | **Quách Văn Quý** | `quach.van.quy@savina.local` | Chuyên gia kỹ thuật | _Chưa tạo_ | - | `c90e24c8-ebd7-4c38-90cf-7796565a5b0d` |
| 30 | **Quản trị SAVINA** | `admin@savina.local` | Quản trị viên hệ thống | `EMP-ADMIN` | `OFFICIAL` | `36096049-fcf3-436a-bc08-77e28edaeb00` |
| 31 | **Trương Quang Bảo Vương** | `truong.quang.bao.vuong@savina.local` | Phó phòng Kỹ thuật - Dịch vụ | _Chưa tạo_ | - | `97662992-0da0-46de-8824-f8ae5768c64c` |
| 32 | **Trần Cao Vũ** | `tran.cao.vu@savina.local` | Lễ tân VPĐD Đắk Lắk | _Chưa tạo_ | - | `4ff035ab-c466-4241-9318-8ddb5f04c0c4` |
| 33 | **Trần Quang Bình** | `tran.quang.binh@savina.local` | Phó Trưởng phòng Thí nghiệm | _Chưa tạo_ | - | `cf326e70-683b-4e91-8846-d591885e146b` |
| 34 | **Trần Quốc Vương** | `tran.quoc.vuong@savina.local` | Nhân viên thí nghiệm | _Chưa tạo_ | - | `c3e4c3b6-6f1c-4bf7-aba7-5069fec4de1e` |
| 35 | **Trần Thúy Uyên** | `tran.thuy.uyen@savina.local` | Kế toán trưởng | _Chưa tạo_ | - | `10d57632-2e90-4fd8-9a8d-cdf52fef2441` |
| 36 | **Trần Thị Tố Uyên** | `tran.thi.to.uyen@savina.local` | Chuyên viên kế toán | _Chưa tạo_ | - | `559b3c2f-cba5-4f73-9368-3049dab03157` |
| 37 | **Trần Văn Cường** | `tran.van.cuong@savina.local` | Bảo vệ | _Chưa tạo_ | - | `9d7e87bb-98d4-48f7-8ee3-8515813dbf27` |
| 38 | **Trần Văn Quốc** | `tran.van.quoc@savina.local` | Nhân viên tư vấn thiết kế | _Chưa tạo_ | - | `811ad8c2-fd5e-4ae4-9b7a-5061c0c816f4` |
| 39 | **Trần Văn Thìn** | `tran.van.thin@savina.local` | Chuyên viên thí nghiệm | _Chưa tạo_ | - | `8b379879-519f-446e-a741-59471d10e4eb` |
| 40 | **Tạ Quang Hoàng** | `ta.quang.hoang@savina.local` | Nhân viên tư vấn thiết kế | _Chưa tạo_ | - | `9d6e8029-a643-42ed-8ce4-a06f2f70fd96` |
| 41 | **Võ Tuấn Kiệt** | `vo.tuan.kiet@savina.local` | Nhân viên kỹ thuật | _Chưa tạo_ | - | `1a1b971c-45d6-4a70-9af1-6a3bb5c08957` |
| 42 | **Đậu Bá Kiên** | `dau.ba.kien@savina.local` | Chuyên viên thí nghiệm | _Chưa tạo_ | - | `2a375134-1582-4361-b290-f8d43b4d1401` |
| 43 | **Đậu Xuân Thanh** | `dau.xuan.thanh@savina.local` | Phó Tổng Giám đốc, Trưởng VPĐD | _Chưa tạo_ | - | `f9485fd9-30ce-4ae4-a126-c9cc46f5a472` |
| 44 | **Đồng Trịnh Bảo** | `dong.trinh.bao@savina.local` | Nhân viên tư vấn thiết kế | _Chưa tạo_ | - | `cf5d7154-37c9-4110-a55b-d042e6cc6b7e` |
| 45 | **Đỗ Thanh Phong** | `do.thanh.phong@savina.local` | Kỹ thuật viên vận hành | _Chưa tạo_ | - | `10f01b25-6bf0-4185-ac9d-626daf58f8df` |

---

## 3. Cấu Trúc Bảng `hrm_schema.employee_profiles` Khi Viết Seed Script

```sql
INSERT INTO hrm_schema.employee_profiles (
  employee_id,                   -- UUID (phải bằng id từ core_schema.users)
  tenant_id,                     -- UUID 'c0195fb2-3073-445c-9768-b6d3aabaa7a8'
  employee_code,                 -- VARCHAR(50) duy nhất, ví dụ: 'EMP-001', 'EMP-002'...
  personal_email,                -- VARCHAR(255)
  phone,                         -- VARCHAR(50)
  date_of_birth,                 -- DATE
  gender,                        -- VARCHAR(20) 'MALE' | 'FEMALE' | 'OTHER'
  identity_card_number,          -- VARCHAR(50)
  identity_card_issued_date,     -- DATE
  identity_card_issued_place,    -- VARCHAR(255)
  tax_code,                      -- VARCHAR(50)
  social_insurance_number,       -- VARCHAR(50)
  bank_account_number,           -- VARCHAR(50)
  bank_name,                     -- VARCHAR(255)
  bank_branch,                   -- VARCHAR(255)
  current_address,               -- TEXT
  permanent_address,             -- TEXT
  emergency_contact_name,        -- VARCHAR(255)
  emergency_contact_phone,       -- VARCHAR(50)
  emergency_contact_relationship,-- VARCHAR(100)
  join_date,                     -- DATE
  official_date,                 -- DATE
  employment_status,             -- VARCHAR(50) 'PROBATION' | 'OFFICIAL' | 'RESIGNED' | 'TERMINATED'
  note                           -- TEXT
) VALUES ( ... );
```
