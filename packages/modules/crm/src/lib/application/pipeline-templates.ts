import type { PipelineProfile, PipelineTemplate } from '@enterprise-platform/contracts-crm';

/**
 * Mẫu luồng có sẵn (GĐ G, P2G-04). Dữ liệu thuần; `PipelineConfigService.createFromTemplate` kiểm lại (mã loại tài
 * liệu phải có thật) rồi tạo luồng mới cho tenant. "Chào thầu" khớp luồng `TENDER_STANDARD` nạp ở migration 0024.
 */

const REASON = (text: string) => ({ kind: 'REASON' as const, ref: '', required: true, message: text });

export const PIPELINE_TEMPLATES: readonly PipelineTemplate[] = [
  {
    id: 'SALES_SIMPLE',
    name: 'Bán hàng đơn giản',
    description: 'Mới, Báo giá, Đàm phán, Thắng, Thua. Vào Thắng cần báo giá Khách chấp nhận, vào Thua cần lý do.',
    profile: 'STANDARD',
    stages: [
      { code: 'NEW', name: 'Mới', semantic: 'OPEN', defaultProbability: 0, skippable: false, assigneeRule: 'PROJECT_OWNER' },
      { code: 'QUOTING', name: 'Báo giá', semantic: 'OPEN', defaultProbability: 40, skippable: false, assigneeRule: 'PROJECT_OWNER' },
      { code: 'NEGOTIATION', name: 'Đàm phán', semantic: 'OPEN', defaultProbability: 70, skippable: false, assigneeRule: 'PROJECT_OWNER' },
      { code: 'WON', name: 'Thắng', semantic: 'WON', defaultProbability: 100, skippable: false, assigneeRule: 'NONE' },
      { code: 'LOST', name: 'Thua', semantic: 'LOST', defaultProbability: 0, skippable: false, assigneeRule: 'NONE' },
    ],
    transitions: [
      ['NEW', 'QUOTING'], ['NEW', 'LOST'],
      ['QUOTING', 'NEW'], ['QUOTING', 'NEGOTIATION'], ['QUOTING', 'LOST'],
      ['NEGOTIATION', 'QUOTING'], ['NEGOTIATION', 'WON'], ['NEGOTIATION', 'LOST'],
    ],
    requirements: [
      { stageCode: 'WON', kind: 'QUOTE_APPROVED', ref: '', required: true, message: 'Cần có báo giá Khách chấp nhận trước khi chuyển sang Thắng.' },
      { stageCode: 'LOST', ...REASON('Phải ghi lý do thua.') },
    ],
  },
  {
    id: 'SALES_WITH_BUSINESS_PLAN',
    name: 'Bán hàng có PAKD',
    description:
      'Thêm bước lập và duyệt phương án kinh doanh (PAKD) trước Đàm phán: vào Duyệt PAKD cần tài liệu PAKD, vào Thắng cần báo giá Khách chấp nhận.',
    profile: 'STANDARD',
    stages: [
      { code: 'NEW', name: 'Mới', semantic: 'OPEN', defaultProbability: 0, skippable: false, assigneeRule: 'PROJECT_OWNER' },
      { code: 'QUOTING', name: 'Báo giá', semantic: 'OPEN', defaultProbability: 30, skippable: false, assigneeRule: 'PROJECT_OWNER' },
      { code: 'PAKD_DRAFT', name: 'Lập PAKD', semantic: 'OPEN', defaultProbability: 45, skippable: false, assigneeRule: 'PROJECT_OWNER' },
      { code: 'PAKD_REVIEW', name: 'Duyệt PAKD', semantic: 'OPEN', defaultProbability: 60, skippable: false, assigneeRule: 'DIRECT_MANAGER' },
      { code: 'NEGOTIATION', name: 'Đàm phán', semantic: 'OPEN', defaultProbability: 75, skippable: false, assigneeRule: 'PROJECT_OWNER' },
      { code: 'WON', name: 'Thắng', semantic: 'WON', defaultProbability: 100, skippable: false, assigneeRule: 'NONE' },
      { code: 'LOST', name: 'Thua', semantic: 'LOST', defaultProbability: 0, skippable: false, assigneeRule: 'NONE' },
    ],
    transitions: [
      ['NEW', 'QUOTING'], ['NEW', 'LOST'],
      ['QUOTING', 'NEW'], ['QUOTING', 'PAKD_DRAFT'], ['QUOTING', 'LOST'],
      ['PAKD_DRAFT', 'QUOTING'], ['PAKD_DRAFT', 'PAKD_REVIEW'], ['PAKD_DRAFT', 'LOST'],
      ['PAKD_REVIEW', 'PAKD_DRAFT'], ['PAKD_REVIEW', 'NEGOTIATION'], ['PAKD_REVIEW', 'LOST'],
      ['NEGOTIATION', 'PAKD_REVIEW'], ['NEGOTIATION', 'WON'], ['NEGOTIATION', 'LOST'],
    ],
    requirements: [
      { stageCode: 'PAKD_REVIEW', kind: 'DOCUMENT_TYPE', ref: 'BUSINESS_PLAN', required: true, message: 'Cần có tài liệu Phương án kinh doanh trước khi chuyển sang Duyệt PAKD.' },
      { stageCode: 'WON', kind: 'QUOTE_APPROVED', ref: '', required: true, message: 'Cần có báo giá Khách chấp nhận trước khi chuyển sang Thắng.' },
      { stageCode: 'LOST', ...REASON('Phải ghi lý do thua.') },
    ],
  },
  {
    id: 'TENDER',
    name: 'Chào thầu',
    description:
      'Thu thập HSMT, Chuẩn bị hồ sơ, Chờ duyệt phương án, Đã nộp, Trúng, Trượt; giống luồng chào thầu có sẵn của hệ thống.',
    profile: 'TENDER',
    stages: [
      { code: 'HSMT', name: 'Thu thập HSMT', semantic: 'OPEN', defaultProbability: 5, skippable: false, assigneeRule: 'PROJECT_OWNER' },
      { code: 'PREPARE', name: 'Chuẩn bị hồ sơ', semantic: 'OPEN', defaultProbability: 20, skippable: false, assigneeRule: 'PROJECT_OWNER' },
      { code: 'PLAN_REVIEW', name: 'Chờ duyệt phương án', semantic: 'OPEN', defaultProbability: 40, skippable: false, assigneeRule: 'PROJECT_OWNER' },
      { code: 'SUBMITTED', name: 'Đã nộp', semantic: 'OPEN', defaultProbability: 60, skippable: false, assigneeRule: 'PROJECT_OWNER' },
      { code: 'WON', name: 'Trúng', semantic: 'WON', defaultProbability: 100, skippable: false, assigneeRule: 'NONE' },
      { code: 'LOST', name: 'Trượt', semantic: 'LOST', defaultProbability: 0, skippable: false, assigneeRule: 'NONE' },
    ],
    transitions: [
      ['HSMT', 'PREPARE'], ['HSMT', 'LOST'],
      ['PREPARE', 'HSMT'], ['PREPARE', 'PLAN_REVIEW'], ['PREPARE', 'LOST'],
      ['PLAN_REVIEW', 'PREPARE'], ['PLAN_REVIEW', 'SUBMITTED'], ['PLAN_REVIEW', 'LOST'],
      ['SUBMITTED', 'WON'], ['SUBMITTED', 'LOST'],
    ],
    requirements: [
      { stageCode: 'PLAN_REVIEW', kind: 'DOCUMENT_TYPE', ref: 'LEGAL_DOSSIER', required: true, message: 'Cần có hồ sơ pháp lý trước khi chuyển sang Chờ duyệt phương án.' },
      { stageCode: 'PLAN_REVIEW', kind: 'DOCUMENT_TYPE', ref: 'ESTIMATE', required: true, message: 'Cần có dự toán trước khi chuyển sang Chờ duyệt phương án.' },
      { stageCode: 'SUBMITTED', kind: 'TENDER_PLAN_APPROVED', ref: '', required: true, message: 'Phương án chào thầu cần được duyệt trước khi chuyển sang Đã nộp.' },
      { stageCode: 'SUBMITTED', kind: 'TENDER_FIELD', ref: 'submissionMethod', required: true, message: 'Cần chọn hình thức nộp thầu trước khi chuyển sang Đã nộp.' },
      { stageCode: 'WON', kind: 'TENDER_FIELD', ref: 'winningPrice', required: true, message: 'Cần ghi giá trúng thầu khi chuyển sang Trúng.' },
      { stageCode: 'LOST', ...REASON('Phải ghi lý do trượt thầu.') },
    ],
  },
];

export function findPipelineTemplate(id: string): PipelineTemplate | undefined {
  return PIPELINE_TEMPLATES.find((template) => template.id === id);
}

/**
 * Khung luồng trống khi tạo không theo mẫu: Mới, Thắng, Thua (đủ để thoả quy tắc "mỗi luồng có OPEN, WON, LOST");
 * người dùng thêm giai đoạn sau.
 */
export function blankPipelineTemplate(profile: PipelineProfile): PipelineTemplate {
  const tender = profile === 'TENDER';
  return {
    id: 'BLANK',
    name: 'Luồng trống',
    description: 'Khung gồm giai đoạn đầu, giai đoạn thắng và giai đoạn thua.',
    profile,
    stages: [
      { code: 'NEW', name: 'Mới', semantic: 'OPEN', defaultProbability: 0, skippable: false, assigneeRule: 'PROJECT_OWNER' },
      { code: 'WON', name: tender ? 'Trúng' : 'Thắng', semantic: 'WON', defaultProbability: 100, skippable: false, assigneeRule: 'NONE' },
      { code: 'LOST', name: tender ? 'Trượt' : 'Thua', semantic: 'LOST', defaultProbability: 0, skippable: false, assigneeRule: 'NONE' },
    ],
    transitions: [['NEW', 'WON'], ['NEW', 'LOST']],
    requirements: [{ stageCode: 'LOST', ...REASON(tender ? 'Phải ghi lý do trượt thầu.' : 'Phải ghi lý do thua.') }],
  };
}
