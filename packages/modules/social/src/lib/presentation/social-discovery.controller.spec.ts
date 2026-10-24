import { HttpException } from '@nestjs/common';
import type { SocialActor } from '../application/social-actor.js';
import { SocialPersonNotFoundError } from '../domain/social-discovery.error.js';
import { SocialValidationError } from '../domain/social.error.js';
import { SocialDiscoveryController } from './social-discovery.controller.js';

const actor: SocialActor = {
  tenantId: 't1',
  userId: '20000000-0000-4000-8000-000000000001',
  displayName: 'Tôi',
  isTenantAdmin: false,
  canRead: true,
  canWrite: true,
  canModerate: false,
  canManage: false,
};
const request = { socialActor: actor };

function controller(overrides: Record<string, unknown> = {}) {
  const services = {
    profiles: { profile: jest.fn() },
    birthdays: {
      birthdays: jest.fn(async () => ({ today: [], upcoming: [] })),
      upcoming: jest.fn(async () => ({ today: '2026-10-21', groups: [], total: 0 })),
    },
    search: {
      overview: jest.fn(),
      posts: jest.fn(async () => ({ items: [] })),
      people: jest.fn(),
      groups: jest.fn(),
    },
    realtimeAccess: { canJoinGroupRoom: jest.fn(async () => true) },
    ...overrides,
  };
  return {
    services,
    instance: new SocialDiscoveryController(
      services.profiles as never,
      services.birthdays as never,
      services.search as never,
      services.realtimeAccess as never,
    ),
  };
}

async function statusOf(promise: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return { status: error.getStatus(), body: error.getResponse() };
    throw error;
  }
  throw new Error('Expected an HttpException.');
}

describe('SocialDiscoveryController', () => {
  it('maps business errors to the shared { statusCode, code, message } frame', async () => {
    const { instance, services } = controller();
    services.profiles.profile.mockRejectedValue(new SocialPersonNotFoundError());
    expect(await statusOf(instance.profile(request, 'x'))).toEqual({
      status: 404,
      body: { statusCode: 404, code: 'PERSON_NOT_FOUND', message: 'Không tìm thấy người này.' },
    });

    services.search.overview.mockRejectedValue(new SocialValidationError('Từ khoá tìm kiếm cần có chữ hoặc số.'));
    expect((await statusOf(instance.overview(request, '!!'))).body).toMatchObject({ code: 'VALIDATION', statusCode: 400 });
  });

  it('passes query strings through as typed requests', async () => {
    const { instance, services } = controller();
    await instance.listBirthdays(request, '14');
    expect(services.birthdays.birthdays).toHaveBeenCalledWith(actor, { days: 14 });
    await instance.listBirthdays(request);
    expect(services.birthdays.birthdays).toHaveBeenLastCalledWith(actor, { days: undefined });
    await instance.upcomingBirthdays(request, '6', 'kế toán');
    expect(services.birthdays.upcoming).toHaveBeenCalledWith(actor, { months: 6, q: 'kế toán' });

    await instance.searchPosts(request, 'họp', undefined, 'g1', '', '2026-10-01', undefined, undefined, '10');
    expect(services.search.posts).toHaveBeenCalledWith(actor, {
      q: 'họp',
      topicId: undefined,
      groupId: 'g1',
      authorId: undefined,
      from: '2026-10-01',
      to: undefined,
      cursor: undefined,
      limit: 10,
    });
  });

  it('needs the guard-provided actor', async () => {
    const { instance } = controller();
    expect((await statusOf(instance.listBirthdays({}))).status).toBe(401);
  });

  it('answers 204 for members and 404 for everyone else on the group room access check', async () => {
    const { instance, services } = controller();
    await expect(instance.groupRoomAccess(request, 'g1')).resolves.toBeUndefined();
    services.realtimeAccess.canJoinGroupRoom.mockResolvedValue(false);
    expect((await statusOf(instance.groupRoomAccess(request, 'g1'))).status).toBe(404);
  });
});
