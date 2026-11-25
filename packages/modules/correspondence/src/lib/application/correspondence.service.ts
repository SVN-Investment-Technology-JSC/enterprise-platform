import type { CorrespondenceStore, FileStore, OrganizationReader } from './ports.js';
import { LetterQueries } from './letters/letter-queries.service.js';
import { LetterIntake } from './letters/letter-intake.service.js';
import { LetterHandling } from './letters/letter-handling.service.js';
import { OutgoingLetters } from './letters/outgoing-letters.service.js';
import { LetterRevocation } from './letters/letter-revocation.service.js';
import { LetterFollowUp } from './letters/letter-follow-up.service.js';
import { LetterAttachments } from './letters/letter-attachments.service.js';
import { CorrespondenceConfiguration } from './letters/correspondence-configuration.service.js';

export { CORRESPONDENCE_FILING_ROOT, catalogCode, flowOf, ownUnits } from './core/letter-helpers.js';

/**
 * Văn thư theo hai luồng, quy trình duyệt cấu hình được:
 *
 * - Công văn đến: văn thư tiếp nhận → phân loại, chọn phòng ban (cả phòng cùng nhận hoặc một
 *   người xử lý) → phòng ban gửi kết quả → các bước duyệt của quy trình → văn thư hoàn tất,
 *   lưu trữ.
 * - Công văn đi: phòng ban soạn thảo → văn thư kiểm tra → các bước duyệt → văn thư đánh số,
 *   ban hành, lưu trữ, theo dõi gửi.
 *
 * Quy trình lấy theo cấu hình (loại văn bản, không có thì quy trình mặc định của luồng).
 * "Không đạt" ở bước nào cũng trả được về bước trước (hay nơi cấu hình cho bước đó). Mỗi thao
 * tác chạy trong một transaction đã khoá dòng công văn và kiểm lại luật quyền trên dữ liệu vừa
 * khoá; sự kiện thông báo ghi vào outbox cùng transaction.
 *
 * Lớp này chỉ là cửa vào chung (controller, test, phân hệ khác dùng nó); nghiệp vụ nằm ở các
 * nhóm trong `letters/`, phần dùng chung ở `core/`. Thêm thao tác mới: viết vào nhóm phù hợp
 * rồi thêm một dòng chuyển tiếp ở đây.
 */
export class CorrespondenceService {
  private readonly queries: LetterQueries;
  private readonly intake: LetterIntake;
  private readonly handling: LetterHandling;
  private readonly outgoing: OutgoingLetters;
  private readonly revocation: LetterRevocation;
  private readonly followUp: LetterFollowUp;
  private readonly attachments: LetterAttachments;
  private readonly configuration: CorrespondenceConfiguration;

  constructor(store: CorrespondenceStore, files: FileStore, organization: OrganizationReader, today?: () => string) {
    this.queries = new LetterQueries(store, files, organization, today);
    this.intake = new LetterIntake(store, files, organization, today);
    this.handling = new LetterHandling(store, files, organization, today);
    this.outgoing = new OutgoingLetters(store, files, organization, today);
    this.revocation = new LetterRevocation(store, files, organization, today);
    this.followUp = new LetterFollowUp(store, files, organization, today);
    this.attachments = new LetterAttachments(store, files, organization, today);
    this.configuration = new CorrespondenceConfiguration(store, files, organization, today);
  }

  /* Tra cứu: trạng thái, cấu hình, danh sách, tổng quan, sổ, báo cáo, kho lưu trữ. */
  readonly status: LetterQueries['status'] = (...args) => this.queries.status(...args);
  readonly config: LetterQueries['config'] = (...args) => this.queries.config(...args);
  readonly directory: LetterQueries['directory'] = (...args) => this.queries.directory(...args);
  readonly list: LetterQueries['list'] = (...args) => this.queries.list(...args);
  readonly overview: LetterQueries['overview'] = (...args) => this.queries.overview(...args);
  readonly stepChoice: LetterQueries['stepChoice'] = (...args) => this.queries.stepChoice(...args);
  readonly ledger: LetterQueries['ledger'] = (...args) => this.queries.ledger(...args);
  readonly report: LetterQueries['report'] = (...args) => this.queries.report(...args);
  readonly archiveTree: LetterQueries['archiveTree'] = (...args) => this.queries.archiveTree(...args);
  readonly detail: LetterQueries['detail'] = (...args) => this.queries.detail(...args);

  /* Tiếp nhận công văn đến, giao xử lý, sửa thông tin công văn. */
  readonly create: LetterIntake['create'] = (...args) => this.intake.create(...args);
  readonly dispatch: LetterIntake['dispatch'] = (...args) => this.intake.dispatch(...args);
  readonly assignHandler: LetterIntake['assignHandler'] = (...args) => this.intake.assignHandler(...args);
  readonly update: LetterIntake['update'] = (...args) => this.intake.update(...args);

  /* Xử lý và duyệt: phản hồi, văn thư kiểm tra, duyệt, trả lại, hoàn tất lưu trữ. */
  readonly respond: LetterHandling['respond'] = (...args) => this.handling.respond(...args);
  readonly complete: LetterHandling['complete'] = (...args) => this.handling.complete(...args);
  readonly submit: LetterHandling['submit'] = (...args) => this.handling.submit(...args);
  readonly approve: LetterHandling['approve'] = (...args) => this.handling.approve(...args);
  readonly returnLetter: LetterHandling['returnLetter'] = (...args) => this.handling.returnLetter(...args);

  /* Công văn đi: soạn, gửi văn thư, đánh số ban hành, theo dõi gửi. */
  readonly createOutgoing: OutgoingLetters['createOutgoing'] = (...args) => this.outgoing.createOutgoing(...args);
  readonly sendToClerk: OutgoingLetters['sendToClerk'] = (...args) => this.outgoing.sendToClerk(...args);
  readonly publish: OutgoingLetters['publish'] = (...args) => this.outgoing.publish(...args);
  readonly updateDelivery: OutgoingLetters['updateDelivery'] = (...args) => this.outgoing.updateDelivery(...args);

  /* Huỷ, thu hồi công văn đã lưu trữ, xoá. */
  readonly cancel: LetterRevocation['cancel'] = (...args) => this.revocation.cancel(...args);
  readonly requestRevoke: LetterRevocation['requestRevoke'] = (...args) => this.revocation.requestRevoke(...args);
  readonly decideRevoke: LetterRevocation['decideRevoke'] = (...args) => this.revocation.decideRevoke(...args);
  readonly withdrawRevoke: LetterRevocation['withdrawRevoke'] = (...args) => this.revocation.withdrawRevoke(...args);
  readonly remove: LetterRevocation['remove'] = (...args) => this.revocation.remove(...args);

  /* Đôn đốc và trao đổi theo bước. */
  readonly remind: LetterFollowUp['remind'] = (...args) => this.followUp.remind(...args);
  readonly comment: LetterFollowUp['comment'] = (...args) => this.followUp.comment(...args);

  /* Tệp đính kèm (lưu qua kho tài liệu của Hệ dùng chung). */
  readonly createAttachment: LetterAttachments['createAttachment'] = (...args) => this.attachments.createAttachment(...args);
  readonly addAttachmentVersion: LetterAttachments['addAttachmentVersion'] = (...args) => this.attachments.addAttachmentVersion(...args);
  readonly completeAttachment: LetterAttachments['completeAttachment'] = (...args) => this.attachments.completeAttachment(...args);
  readonly download: LetterAttachments['download'] = (...args) => this.attachments.download(...args);
  readonly deleteAttachment: LetterAttachments['deleteAttachment'] = (...args) => this.attachments.deleteAttachment(...args);

  /* Cấu hình: cài đặt, danh mục, quy trình, sổ đăng ký. */
  readonly saveSettings: CorrespondenceConfiguration['saveSettings'] = (...args) => this.configuration.saveSettings(...args);
  readonly saveCatalogItem: CorrespondenceConfiguration['saveCatalogItem'] = (...args) => this.configuration.saveCatalogItem(...args);
  readonly quickAddCatalogItem: CorrespondenceConfiguration['quickAddCatalogItem'] = (...args) => this.configuration.quickAddCatalogItem(...args);
  readonly deleteCatalogItem: CorrespondenceConfiguration['deleteCatalogItem'] = (...args) => this.configuration.deleteCatalogItem(...args);
  readonly saveWorkflow: CorrespondenceConfiguration['saveWorkflow'] = (...args) => this.configuration.saveWorkflow(...args);
  readonly deleteWorkflow: CorrespondenceConfiguration['deleteWorkflow'] = (...args) => this.configuration.deleteWorkflow(...args);
  readonly saveRegister: CorrespondenceConfiguration['saveRegister'] = (...args) => this.configuration.saveRegister(...args);
  readonly deleteRegister: CorrespondenceConfiguration['deleteRegister'] = (...args) => this.configuration.deleteRegister(...args);
}
