SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- SỰ KIỆN LỊCH
--
-- Một chuỗi lặp hằng tuần trong hai năm là MỘT dòng, không phải 104 dòng.
-- Quy tắc lặp nằm ở `recurrence_rule`; các lần xuất hiện được khai triển khi
-- truy vấn, bằng hàm thuần ở tầng domain. Chỉ khi một buổi bị tách ra làm
-- ngoại lệ mới sinh thêm dòng dữ liệu.
--
-- Đánh đổi: mọi truy vấn lịch phải đi qua bước khai triển, nên khoảng tra cứu
-- bị giới hạn 366 ngày ở tầng ứng dụng.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.calendar_events (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Nhóm các sự kiện cùng một chuỗi. Sự kiện đơn lẻ để rỗng; dòng tách ra
    -- làm ngoại lệ giữ nguyên series_id của chuỗi gốc.
    series_id          UUID,
    project_id         UUID REFERENCES workspace_schema.projects(id) ON DELETE CASCADE,
    work_item_id       UUID REFERENCES workspace_schema.work_items(id) ON DELETE SET NULL,

    title              VARCHAR(200) NOT NULL,
    description        TEXT,
    -- Địa điểm dạng văn bản tự do. Module không quản lý phòng họp hay thiết bị.
    location           VARCHAR(255),
    -- meeting = Họp · activity = Sinh hoạt · other = Khác. Hạn công việc tự hiện
    -- trên lịch từ planned_end, không cần sự kiện riêng.
    event_type         VARCHAR(32) NOT NULL DEFAULT 'meeting'
                         CHECK (event_type IN ('meeting','activity','other')),

    start_at           TIMESTAMPTZ NOT NULL,
    end_at             TIMESTAMPTZ NOT NULL,
    all_day            BOOLEAN NOT NULL DEFAULT false,
    -- Bắt buộc phải có: khai triển lịch lặp cần biết giờ địa phương, nếu chỉ
    -- cộng 7*24 giờ thì chuỗi sẽ trôi giờ mỗi lần đổi giờ mùa.
    timezone           VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',

    recurrence_rule    TEXT,
    recurrence_until   TIMESTAMPTZ,
    recurrence_count   SMALLINT CHECK (recurrence_count BETWEEN 1 AND 365),

    org_unit_id        UUID,
    -- Không xoá cứng. Huỷ là chuyển `cancelled`.
    status             VARCHAR(32) NOT NULL DEFAULT 'scheduled'
                         CHECK (status IN ('scheduled','cancelled')),
    organizer_user_id  UUID NOT NULL,

    created_by         UUID NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_calendar_events_range CHECK (end_at >= start_at),
    -- Chuỗi vô hạn sẽ khiến mọi truy vấn phải tự nghĩ ra điểm dừng; bắt buộc
    -- có điểm dừng ngay tại tầng dữ liệu.
    CONSTRAINT chk_calendar_events_recurrence_bounded
        CHECK (
            recurrence_rule IS NULL
            OR recurrence_until IS NOT NULL
            OR recurrence_count IS NOT NULL
        )
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_range
    ON workspace_schema.calendar_events (start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_series
    ON workspace_schema.calendar_events (series_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_project
    ON workspace_schema.calendar_events (project_id, start_at);

-- ===========================================================================
-- NGƯỜI THAM DỰ
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.calendar_event_participants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL REFERENCES workspace_schema.calendar_events(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL,
    response_status VARCHAR(32) NOT NULL DEFAULT 'needs_action'
                      CHECK (response_status IN ('needs_action','accepted','declined','tentative')),
    is_organizer    BOOLEAN NOT NULL DEFAULT false,
    responded_at    TIMESTAMPTZ,
    created_by      UUID NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (event_id, user_id)
);

-- Nuôi trực tiếp trang Công việc của tôi: khối "lịch hôm nay" và khối "lời
-- mời chờ phản hồi" đều lọc theo đúng hai cột này.
CREATE INDEX IF NOT EXISTS idx_calendar_participants_user
    ON workspace_schema.calendar_event_participants (user_id, response_status);

-- ===========================================================================
-- NGOẠI LỆ CỦA CHUỖI LẶP
--
-- Khai triển lịch: sinh danh sách lần xuất hiện từ RRULE trong khoảng tra
-- cứu, LOẠI BỎ những ngày có ngoại lệ `cancelled`, và THAY THẾ những ngày có
-- ngoại lệ `moved` bằng sự kiện được trỏ tới.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.calendar_event_exceptions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Không đặt khoá ngoại: `series_id` không phải khoá chính của bảng nào.
    series_id             UUID NOT NULL,
    -- Ngày của lần xuất hiện bị tách, tính theo múi giờ của sự kiện.
    occurrence_date       DATE NOT NULL,
    exception_type        VARCHAR(32) NOT NULL CHECK (exception_type IN ('cancelled','moved')),
    replacement_event_id  UUID REFERENCES workspace_schema.calendar_events(id) ON DELETE CASCADE,
    created_by            UUID NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (series_id, occurrence_date),
    CONSTRAINT chk_exception_replacement
        CHECK (exception_type <> 'moved' OR replacement_event_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_calendar_exceptions_series
    ON workspace_schema.calendar_event_exceptions (series_id, occurrence_date);
