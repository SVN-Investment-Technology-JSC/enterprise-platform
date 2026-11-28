import { DEFAULT_PROCEDURE_LINK_SETTINGS, type ProcedureLinkSettings } from '@enterprise-platform/contracts-workspace';

/** Một lựa chọn của một cài đặt: nhãn ngắn cho ô chọn, một dòng hệ quả hiện dưới ô khi đang chọn. */
export interface LinkOption {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

export interface LinkField {
  readonly key: keyof ProcedureLinkSettings;
  readonly label: string;
  readonly hint: string;
  readonly options: readonly LinkOption[];
  /** Cài đặt ít dùng: nằm trong mục "Nâng cao" của phần. */
  readonly advanced?: boolean;
  /** Luật do module Quy trình thực thi (khoá engine*), áp dụng chậm tối đa khoảng 30 giây. */
  readonly engine?: boolean;
  /** Vắng thì luôn hiện; trả false thì ẩn vì cài đặt này không còn nghĩa với lựa chọn hiện tại. */
  readonly visibleWhen?: (link: ProcedureLinkSettings) => boolean;
}

export interface LinkSection {
  readonly id: string;
  readonly title: string;
  readonly fields: readonly LinkField[];
}

const NONE: LinkOption = { value: 'none', label: 'Không làm gì', description: 'Công việc giữ nguyên trạng thái.' };

const ON_ENDED: readonly LinkOption[] = [
  NONE,
  { value: 'blocked', label: 'Chuyển sang Bị chặn', description: 'Ghi sẵn lý do có mã hồ sơ quy trình.' },
  { value: 'todo', label: 'Đưa về Chưa làm', description: 'Công việc quay lại trạng thái Chưa làm.' },
  { value: 'cancelled', label: 'Huỷ công việc', description: 'Công việc chuyển sang Đã huỷ.' },
];

const STATUS_GATES: readonly LinkOption[] = [
  { value: 'any', label: 'Mọi trạng thái', description: 'Không giới hạn theo trạng thái công việc.' },
  {
    value: 'open_only',
    label: 'Chỉ việc chưa đóng',
    description: 'Không cho thao tác khi công việc đã Hoàn thành hoặc Đã huỷ.',
  },
];

export const LINK_SECTIONS: readonly LinkSection[] = [
  {
    id: 'ended',
    title: 'Khi hồ sơ kết thúc',
    fields: [
      {
        key: 'onCompletedWorkItem',
        label: 'Hồ sơ hoàn thành: công việc dự án',
        hint: 'Việc xảy ra với công việc dự án khi hồ sơ gắn kèm hoàn thành.',
        options: [
          NONE,
          { value: 'progress100', label: 'Chỉ đặt tiến độ 100%', description: 'Tiến độ lên 100%, trạng thái giữ nguyên.' },
          { value: 'review', label: 'Chuyển sang Chờ duyệt', description: 'Tiến độ 100% và chờ người có quyền xác nhận.' },
          { value: 'done', label: 'Chuyển sang Hoàn thành', description: 'Tiến độ 100% và đóng công việc ngay.' },
        ],
      },
      {
        key: 'completedGuards',
        label: 'Điều kiện của công việc khi hoàn thành',
        hint: 'Chỉ có nghĩa khi hồ sơ hoàn thành tự đổi trạng thái công việc.',
        options: [
          {
            value: 'respect',
            label: 'Tôn trọng điều kiện',
            description: 'Chưa đủ điều kiện thì chỉ đặt 100%, không đổi trạng thái.',
          },
          {
            value: 'force',
            label: 'Bỏ qua điều kiện',
            description: 'Vẫn không đóng việc còn việc con chưa xong.',
          },
        ],
        visibleWhen: (link) => link.onCompletedWorkItem === 'review' || link.onCompletedWorkItem === 'done',
      },
      {
        key: 'onCompletedStandalone',
        label: 'Hồ sơ hoàn thành: việc cá nhân',
        hint: 'Việc xảy ra với việc cá nhân khi hồ sơ gắn kèm hoàn thành.',
        options: [
          {
            value: 'review_root_done_child',
            label: 'Gốc chờ duyệt, con hoàn thành',
            description: 'Việc cá nhân cấp gốc sang Chờ duyệt, việc con sang Hoàn thành.',
          },
          {
            value: 'always_review',
            label: 'Luôn chuyển sang Chờ duyệt',
            description: 'Mọi việc cá nhân đều chờ người giao xác nhận.',
          },
          { value: 'always_done', label: 'Luôn chuyển sang Hoàn thành', description: 'Mọi việc cá nhân đóng ngay.' },
          { value: 'none', label: 'Không làm gì', description: 'Việc cá nhân giữ nguyên trạng thái.' },
        ],
      },
      { key: 'onRejected', label: 'Hồ sơ bị từ chối', hint: 'Áp cho cả công việc dự án và việc cá nhân.', options: ON_ENDED },
      { key: 'onCancelled', label: 'Hồ sơ bị huỷ', hint: 'Áp cho cả công việc dự án và việc cá nhân.', options: ON_ENDED },
    ],
  },
  {
    id: 'start',
    title: 'Mở và đổi quy trình',
    fields: [
      {
        key: 'onStarted',
        label: 'Hồ sơ bắt đầu',
        hint: 'Việc xảy ra với công việc Chưa làm khi hồ sơ được tạo và gắn vào.',
        options: [
          { value: 'none', label: 'Không làm gì', description: 'Công việc giữ trạng thái Chưa làm.' },
          { value: 'in_progress', label: 'Chuyển sang Đang làm', description: 'Công việc Chưa làm tự sang Đang làm.' },
        ],
      },
      {
        key: 'startProcedureStatusGate',
        label: 'Bắt đầu quy trình',
        hint: 'Công việc ở trạng thái nào thì được bắt đầu quy trình.',
        options: STATUS_GATES,
      },
      {
        key: 'changeProcedureStatusGate',
        label: 'Đổi sang quy trình khác',
        hint: 'Công việc ở trạng thái nào thì được đổi quy trình.',
        options: STATUS_GATES,
      },
      {
        key: 'engineChangeEligibility',
        label: 'Khi nào được đổi quy trình',
        hint: 'Mức xử lý dở dang của hồ sơ mà vẫn cho đổi quy trình.',
        engine: true,
        options: [
          {
            value: 'untouched',
            label: 'Chỉ khi hồ sơ còn nguyên',
            description: 'Chưa có bước xử lý, trao đổi, uỷ quyền, vật tư, dữ liệu nhập hay tệp đính kèm.',
          },
          {
            value: 'no_step_handled',
            label: 'Đến khi có bước được xử lý',
            description: 'Chặn khi đã có bước hoàn thành, trả lại hoặc từ chối.',
          },
          { value: 'never', label: 'Không cho đổi', description: 'Ẩn và chặn hoàn toàn thao tác Đổi quy trình.' },
        ],
      },
      {
        key: 'engineChangeWho',
        label: 'Ai được đổi quy trình',
        hint: 'Người có quyền đổi quy trình của công việc.',
        advanced: true,
        engine: true,
        options: [
          {
            value: 'creator_approver_admin',
            label: 'Người tạo, người duyệt, quản trị',
            description: 'Người tạo hồ sơ, người giữ vai A hoặc quản trị tenant.',
          },
          {
            value: 'approver_admin',
            label: 'Người duyệt và quản trị',
            description: 'Người tạo hồ sơ không giữ vai A thì không được đổi.',
          },
          { value: 'admin_only', label: 'Chỉ quản trị', description: 'Chỉ quản trị tenant được đổi quy trình.' },
        ],
      },
      {
        key: 'engineChangeOldInstanceFate',
        label: 'Hồ sơ cũ sau khi đổi',
        hint: 'Số phận của hồ sơ cũ khi công việc chuyển sang quy trình mới.',
        advanced: true,
        engine: true,
        options: [
          {
            value: 'delete',
            label: 'Xoá mềm hồ sơ cũ',
            description: 'Hồ sơ cũ bị huỷ và ẩn khỏi danh sách.',
          },
          {
            value: 'cancel_keep',
            label: 'Huỷ nhưng giữ để tra cứu',
            description: 'Hồ sơ cũ sang Đã huỷ, vẫn hiện trong danh sách và nhật ký.',
          },
        ],
      },
      {
        key: 'engineStartWithoutOrgChart',
        label: 'Người tạo chưa có trong sơ đồ tổ chức',
        hint: 'Cách xử lý khi mở hồ sơ cho người chưa có chức danh hoặc đơn vị.',
        advanced: true,
        engine: true,
        options: [
          {
            value: 'block',
            label: 'Chặn mở hồ sơ',
            description: 'Báo lỗi nếu người tạo không có trong sơ đồ tổ chức (quản trị được bỏ qua).',
          },
          {
            value: 'allow_if_role_matches',
            label: 'Vẫn thử, theo vai S',
            description: 'Quy trình không cho người đó khởi tạo thì báo thiếu vai S.',
          },
        ],
      },
    ],
  },
  {
    id: 'progress',
    title: 'Tiến độ',
    fields: [
      {
        key: 'progressPull',
        label: 'Lấy tiến độ từ hồ sơ',
        hint: 'Có tự lấy tiến độ của hồ sơ về công việc hay không.',
        options: [
          { value: 'on_open', label: 'Cập nhật khi mở công việc', description: 'Mỗi lần mở, tiến độ lấy theo hồ sơ quy trình.' },
          { value: 'off', label: 'Không tự cập nhật', description: 'Tiến độ công việc không bị hồ sơ ghi đè.' },
        ],
      },
      {
        key: 'progressPullClosedItems',
        label: 'Công việc đã đóng',
        hint: 'Xử lý việc Hoàn thành, Chờ duyệt, Đã huỷ hoặc bị đảo ngược khi lấy tiến độ.',
        options: [
          { value: 'skip', label: 'Bỏ qua', description: 'Việc đã đóng giữ nguyên tiến độ.' },
          { value: 'overwrite', label: 'Vẫn ghi đè', description: 'Tiến độ của hồ sơ ghi đè cả việc đã đóng.' },
        ],
        visibleWhen: (link) => link.progressPull !== 'off',
      },
      {
        key: 'progressPullDirection',
        label: 'Chiều thay đổi tiến độ',
        hint: 'Tiến độ lấy từ hồ sơ được tăng và giảm hay chỉ tăng.',
        advanced: true,
        options: [
          { value: 'two_way', label: 'Tăng và giảm', description: 'Tiến độ công việc luôn bằng tiến độ hồ sơ.' },
          { value: 'increase_only', label: 'Chỉ tăng', description: 'Không hạ tiến độ đã có xuống thấp hơn.' },
        ],
        visibleWhen: (link) => link.progressPull !== 'off',
      },
      {
        key: 'manualProgressWhenLinked',
        label: 'Nhập tiến độ tay',
        hint: 'Người làm có được tự sửa tiến độ khi công việc làm theo quy trình.',
        options: [
          { value: 'allow', label: 'Cho nhập tay', description: 'Người làm vẫn sửa hoặc báo tiến độ được.' },
          { value: 'block', label: 'Chặn nhập tay', description: 'Tiến độ chỉ lấy từ hồ sơ quy trình.' },
        ],
      },
      {
        key: 'onAllChildrenDone',
        label: 'Khi mọi công việc con đã xong, công việc cha',
        hint: 'Không tính công việc con đã huỷ.',
        options: [
          {
            value: 'done',
            label: 'Tự Hoàn thành',
            description: 'Trừ công việc cha cần người xác nhận.',
          },
          {
            value: 'review',
            label: 'Tự chuyển sang Chờ duyệt',
            description: 'Công việc cha tự chuyển sang Chờ duyệt để người có quyền xác nhận.',
          },
          {
            value: 'none',
            label: 'Không tự đổi trạng thái',
            description: 'Người dùng hoặc hồ sơ quy trình tự đóng.',
          },
        ],
      },
      {
        key: 'parentWaitsForProcedure',
        label: 'Công việc cha có hồ sơ quy trình riêng',
        hint: 'Chỉ áp cho công việc cha đang gắn hồ sơ.',
        options: [
          {
            value: 'no_wait',
            label: 'Không chờ',
            description: 'Cha đóng ngay dù hồ sơ của cha chưa hoàn tất.',
          },
          {
            value: 'wait',
            label: 'Chờ hồ sơ quy trình của công việc cha hoàn tất mới đóng',
            description: 'Cha đóng khi con xong hết và hồ sơ của cha hoàn tất.',
          },
        ],
        // Cha không tự đóng thì không có gì để chờ.
        visibleWhen: (link) => link.onAllChildrenDone !== 'none',
      },
      {
        key: 'parentProcedureEnded',
        label: 'Khi hồ sơ quy trình của công việc cha bị từ chối hoặc bị hủy',
        hint: 'Hồ sơ kết thúc mà không hoàn tất thì công việc cha có chờ tiếp hay không.',
        options: [
          {
            value: 'keep_waiting',
            label: 'Tiếp tục chờ hồ sơ của công việc cha',
            description: 'Cha không tự đóng cho đến khi có hồ sơ hoàn tất.',
          },
          {
            value: 'stop_waiting',
            label: 'Thôi chờ, đóng công việc cha như bình thường',
            description: 'Cha đóng theo lựa chọn trên như khi không có hồ sơ.',
          },
        ],
        // Chỉ có nghĩa khi cha chờ hồ sơ và tự đóng.
        visibleWhen: (link) => link.parentWaitsForProcedure === 'wait' && link.onAllChildrenDone !== 'none',
      },
    ],
  },
  {
    id: 'cleanup',
    title: 'Xoá, đảo ngược và tệp đính kèm',
    fields: [
      {
        key: 'onInstanceDeleted',
        label: 'Hồ sơ bị xoá',
        hint: 'Việc xảy ra với công việc đang gắn hồ sơ đã bị xoá.',
        options: [
          { value: 'delete_item', label: 'Xoá công việc', description: 'Công việc bị xoá cùng hồ sơ quy trình.' },
          { value: 'unlink_keep', label: 'Giữ lại, gỡ liên kết', description: 'Công việc còn nguyên, chỉ không gắn hồ sơ nữa.' },
          { value: 'cancel_item', label: 'Huỷ công việc', description: 'Gỡ liên kết và chuyển công việc sang Đã huỷ.' },
        ],
      },
      {
        key: 'onReversed',
        label: 'Hồ sơ bị đảo ngược',
        hint: 'Công việc có bị đảo ngược theo hay không.',
        options: [
          { value: 'cascade', label: 'Đảo ngược theo hồ sơ', description: 'Hồ sơ bị đảo ngược thì công việc cũng bị đảo ngược.' },
          { value: 'none', label: 'Không làm gì', description: 'Công việc giữ nguyên dù hồ sơ bị đảo ngược.' },
        ],
      },
      {
        key: 'engineAttachmentMirror',
        label: 'Tệp đính kèm sang tài liệu công việc',
        hint: 'Tệp thêm vào hồ sơ có được đưa vào tài liệu của công việc không.',
        engine: true,
        options: [
          { value: 'all', label: 'Tất cả tệp', description: 'Mọi tệp thêm vào hồ sơ đều vào tài liệu công việc.' },
          {
            value: 'final_step_only',
            label: 'Chỉ tệp của bước cuối',
            description: 'Chỉ tệp ở bước cuối của quy trình được đưa sang.',
          },
          { value: 'none', label: 'Không đưa sang', description: 'Tệp chỉ nằm trong hồ sơ quy trình.' },
        ],
      },
      {
        key: 'engineDeleteLinkedWho',
        label: 'Ai được xoá hồ sơ gắn công việc',
        hint: 'Người có quyền xoá hồ sơ đang gắn với công việc.',
        advanced: true,
        engine: true,
        options: [
          {
            value: 'initiator_approver_admin',
            label: 'Người tạo, người duyệt, quản trị',
            description: 'Người tạo chỉ xoá được trước lần duyệt đầu tiên.',
          },
          {
            value: 'approver_admin',
            label: 'Người duyệt và quản trị',
            description: 'Người tạo hồ sơ không tự xoá được.',
          },
          { value: 'admin_only', label: 'Chỉ quản trị', description: 'Chỉ quản trị tenant được xoá hồ sơ gắn công việc.' },
        ],
      },
      {
        key: 'engineReverseWho',
        label: 'Ai được huỷ hiệu lực hồ sơ',
        hint: 'Người có quyền huỷ hiệu lực hồ sơ đã kết thúc.',
        advanced: true,
        engine: true,
        options: [
          { value: 'admin_only', label: 'Chỉ quản trị', description: 'Chỉ quản trị tenant huỷ hiệu lực được hồ sơ.' },
          {
            value: 'admin_or_approver',
            label: 'Quản trị hoặc người duyệt',
            description: 'Người giữ vai A của hồ sơ cũng huỷ hiệu lực được.',
          },
        ],
      },
      {
        key: 'engineReverseStatuses',
        label: 'Trạng thái được huỷ hiệu lực',
        hint: 'Hồ sơ ở trạng thái nào thì được huỷ hiệu lực.',
        advanced: true,
        engine: true,
        options: [
          {
            value: 'completed_or_rejected',
            label: 'Đã hoàn thành hoặc từ chối',
            description: 'Cả hồ sơ hoàn thành lẫn bị từ chối.',
          },
          { value: 'completed_only', label: 'Chỉ đã hoàn thành', description: 'Hồ sơ bị từ chối không còn huỷ hiệu lực được.' },
        ],
      },
      {
        key: 'engineReasonRequired',
        label: 'Bắt buộc ghi lý do',
        hint: 'Khi xoá hoặc huỷ hiệu lực hồ sơ.',
        advanced: true,
        engine: true,
        options: [
          { value: 'required', label: 'Bắt buộc (từ 3 ký tự)', description: 'Phải ghi lý do xoá và lý do huỷ hiệu lực.' },
          {
            value: 'optional',
            label: 'Không bắt buộc',
            description: 'Cho để trống; lý do (nếu có) lưu vào nhật ký.',
          },
        ],
      },
    ],
  },
];

/** Tên của lựa chọn đang chọn; giá trị lạ thì trả chính giá trị đó để vẫn thấy được. */
export function optionLabel(field: LinkField, link: ProcedureLinkSettings): string {
  const value = link[field.key];
  return field.options.find((option) => option.value === value)?.label ?? String(value);
}

export const visibleFields = (section: LinkSection, link: ProcedureLinkSettings): readonly LinkField[] =>
  section.fields.filter((field) => !field.visibleWhen || field.visibleWhen(link));

/** Một dòng tóm tắt các cài đặt thường dùng của phần, hiện cả khi phần đang gập. */
export function summarizeSection(section: LinkSection, link: ProcedureLinkSettings): string {
  return visibleFields(section, link)
    .filter((field) => !field.advanced)
    .map((field) => optionLabel(field, link))
    .join(' · ');
}

/** Số cài đặt của phần khác mặc định; cài đặt đang ẩn không được tính. */
export const changedCount = (section: LinkSection, link: ProcedureLinkSettings): number =>
  visibleFields(section, link).filter((field) => link[field.key] !== DEFAULT_PROCEDURE_LINK_SETTINGS[field.key]).length;

/** Gán lại các khoá của phần về mặc định (không lưu). */
export function resetSection(section: LinkSection, link: ProcedureLinkSettings): ProcedureLinkSettings {
  const next: Record<string, string> = { ...link };
  for (const field of section.fields) next[field.key] = DEFAULT_PROCEDURE_LINK_SETTINGS[field.key];
  return next as unknown as ProcedureLinkSettings;
}
