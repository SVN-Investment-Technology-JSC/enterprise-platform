import { RequestMethod } from '@nestjs/common';
import { CorrespondenceConfigController } from './correspondence-config.controller.js';
import { LetterAttachmentsController } from './letter-attachments.controller.js';
import { LetterFlowController } from './letter-flow.controller.js';
import { LetterQueriesController } from './letter-queries.controller.js';
import { LetterRevocationController } from './letter-revocation.controller.js';

/** Khoá metadata Nest ghi cho `@Controller`, `@Get`… (giá trị của `PATH_METADATA`, `METHOD_METADATA`). */
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

/**
 * Bảng route của API Văn thư (sau tiền tố `api/correspondence/v1`). Giao diện và phân hệ khác gọi
 * đúng các đường dẫn này: tách hay gộp controller không được làm đổi bảng.
 */
const ROUTES = [
  'GET status', 'GET directory', 'GET overview', 'GET archive-tree', 'GET reports', 'GET ledger', 'GET config',
  'PUT settings', 'POST catalog', 'PUT catalog/:id', 'POST catalog/quick', 'DELETE catalog/:id',
  'POST workflows', 'PUT workflows/:id', 'DELETE workflows/:id', 'POST registers', 'PUT registers/:id', 'DELETE registers/:id',
  'GET letters', 'POST letters', 'POST outgoing', 'GET letters/:id', 'GET letters/:id/step-choice', 'PATCH letters/:id',
  'POST letters/:id/dispatch', 'POST letters/:id/assignments/:assignmentId/handler',
  'POST letters/:id/assignments/:assignmentId/respond', 'POST letters/:id/send-to-clerk', 'POST letters/:id/submit',
  'POST letters/:id/approve', 'POST letters/:id/return', 'POST letters/:id/complete', 'POST letters/:id/publish',
  'POST letters/:id/delivery', 'POST letters/:id/cancel', 'POST letters/:id/remind', 'POST letters/:id/revoke',
  'POST letters/:id/revoke/decision', 'POST letters/:id/revoke/withdraw', 'DELETE letters/:id', 'POST letters/:id/comments',
  'POST letters/:id/attachments', 'POST letters/:id/attachments/:attachmentId/versions',
  'POST letters/:id/attachments/:attachmentId/complete', 'GET letters/:id/attachments/:attachmentId/download',
  'DELETE letters/:id/attachments/:attachmentId',
];

describe('Bảng route Văn thư', () => {
  it('đủ và đúng các route, không trùng, cùng tiền tố v1', () => {
    const controllers = [
      LetterQueriesController,
      CorrespondenceConfigController,
      LetterFlowController,
      LetterRevocationController,
      LetterAttachmentsController,
    ];
    const found: string[] = [];
    for (const controller of controllers) {
      expect(Reflect.getMetadata(PATH_METADATA, controller)).toBe('v1');
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = (controller.prototype as unknown as Record<string, unknown>)[name];
        if (typeof handler !== 'function' || name === 'constructor') continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (path === undefined) continue;
        found.push(`${RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number]} ${path}`);
      }
    }
    expect(new Set(found).size).toBe(found.length);
    expect([...found].sort()).toEqual([...ROUTES].sort());
  });
});
