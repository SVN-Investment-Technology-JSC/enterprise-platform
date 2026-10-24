import { PermanentMessageError, TransientConsumerError } from '@enterprise-platform/adapter-events';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type { SocialAttachmentPurpose } from '@enterprise-platform/contracts-social';
import type { VideoProcessor } from '@enterprise-platform/module-social';

export interface VideoMessageHandlerDeps {
  readonly processor: VideoProcessor;
  /** Tenant còn hoạt động và đã bật module social; sai thì bỏ qua (ack) vì không có ai nhận kết quả. */
  readonly canProcess: (tenantId: string) => Promise<boolean>;
  /** Tín hiệu tắt máy: đang tắt thì không ném lỗi tạm thời (broker tự giao lại tin chưa ack). */
  readonly signal: AbortSignal;
}

function isPurpose(value: unknown): value is SocialAttachmentPurpose {
  return value === 'comment' || value === 'post';
}

/**
 * Tin hỏng (thiếu trường) ném `PermanentMessageError` để vào DLQ ngay thay vì thử lại vô hạn.
 * Kết quả `retry` của dịch vụ thành `TransientConsumerError` để consumer chờ rồi gửi lại có độ trễ.
 */
export function createVideoMessageHandler(deps: VideoMessageHandlerDeps) {
  return async (event: IntegrationEventEnvelope): Promise<void> => {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const attachmentId = payload['attachmentId'];
    const purpose = payload['purpose'];
    if (
      typeof event.tenantId !== 'string' ||
      event.tenantId === '' ||
      typeof attachmentId !== 'string' ||
      attachmentId === '' ||
      !isPurpose(purpose)
    ) {
      throw new PermanentMessageError('Tin yêu cầu chuyển mã video thiếu tenantId, attachmentId hoặc purpose hợp lệ.');
    }
    if (!(await deps.canProcess(event.tenantId))) return;
    const outcome = await deps.processor.process({ tenantId: event.tenantId, attachmentId, purpose }, deps.signal);
    if (outcome === 'retry' && !deps.signal.aborted) {
      throw new TransientConsumerError(`Chuyển mã video ${attachmentId} gặp lỗi tạm thời.`);
    }
  };
}
