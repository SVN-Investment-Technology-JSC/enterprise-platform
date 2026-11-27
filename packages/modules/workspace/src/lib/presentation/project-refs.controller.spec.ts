import { HttpException } from '@nestjs/common';
import type { WorkspaceStore } from '../application/workspace-store.port.js';
import { PROJECT_REFS_MAX, ProjectRefsController, parseRefIds } from './project-refs.controller.js';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const W1 = '33333333-3333-4333-8333-333333333333';

describe('mã, tên dự án theo lô cho module khác (GET v1/project-refs)', () => {
  it('đọc danh sách id: bỏ giá trị lạ và trùng, chuẩn chữ thường, có trần', () => {
    expect(parseRefIds(`${P1}, ${P1.toUpperCase()},abc,,${P2}`)).toEqual([P1, P2]);
    expect(parseRefIds(undefined)).toEqual([]);
    expect(parseRefIds('   ')).toEqual([]);
    const many = Array.from({ length: PROJECT_REFS_MAX + 5 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(parseRefIds(many.join(','))).toHaveLength(PROJECT_REFS_MAX);
  });

  it('gọi kho một lần với id đã lọc của tenant người gọi', async () => {
    const refs = jest.fn().mockResolvedValue({ projects: [{ id: P1, code: 'DA-1', name: 'Dự án 1' }], workItems: [] });
    const controller = new ProjectRefsController({ project: { refs } } as unknown as WorkspaceStore, {} as never);
    const result = await controller.refs({ workspaceActor: { tenantId: 't-1' } as never }, `${P1},x`, W1);
    expect(refs).toHaveBeenCalledWith('t-1', [P1], [W1]);
    expect(result.projects[0]?.name).toBe('Dự án 1');
  });

  it('thiếu ngữ cảnh người dùng đã xác minh thì 401', async () => {
    const controller = new ProjectRefsController({ project: { refs: jest.fn() } } as unknown as WorkspaceStore, {} as never);
    await expect(controller.refs({}, P1, undefined)).rejects.toBeInstanceOf(HttpException);
  });
});
