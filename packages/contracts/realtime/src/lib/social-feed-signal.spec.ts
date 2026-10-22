import { REALTIME_SERVER_EVENTS } from './contracts-realtime.js';
import {
  SOCIAL_FEED_SOURCE_EVENT_TYPES,
  isSocialFeedSourceEvent,
  socialFeedDeliveryFromEvent,
  socialGroupRoom,
} from './social-feed-signal.js';

describe('social feed signal', () => {
  it('registers the socket event name', () => {
    expect(REALTIME_SERVER_EVENTS).toContain('social.feed.changed');
  });

  it('sends wall posts to the whole tenant and group posts to the group only', () => {
    expect(
      socialFeedDeliveryFromEvent('social.post.published', { postId: 'p1', authorId: 'u1' }),
    ).toEqual({ audience: { kind: 'tenant' }, signal: { change: 'post.created', postId: 'p1', actorUserId: 'u1' } });

    expect(
      socialFeedDeliveryFromEvent('social.post.published', { postId: 'p2', authorId: 'u1', groupId: 'g1' }),
    ).toEqual({
      audience: { kind: 'group', groupId: 'g1' },
      signal: { change: 'post.created', postId: 'p2', groupId: 'g1', actorUserId: 'u1' },
    });
  });

  it('maps edits, deletes, comments, reactions and polls to their signal kinds', () => {
    const change = (type: string, payload: Record<string, unknown>) =>
      socialFeedDeliveryFromEvent(type, { postId: 'p1', ...payload })?.signal.change;
    expect(change('social.post.changed', { actorId: 'u1', change: 'updated' })).toBe('post.updated');
    expect(change('social.post.changed', { actorId: 'u1', change: 'pinned' })).toBe('post.updated');
    expect(change('social.post.changed', { actorId: 'u1', change: 'deleted' })).toBe('post.deleted');
    expect(change('social.comment.created', { authorId: 'u1', commentId: 'c1' })).toBe('comment.changed');
    expect(change('social.reaction.changed', { actorId: 'u1' })).toBe('reaction.changed');
    expect(change('social.poll.changed', { actorId: 'u1', change: 'voted' })).toBe('poll.changed');
  });

  it('carries ids only, never post content', () => {
    const delivery = socialFeedDeliveryFromEvent('social.comment.created', {
      postId: 'p1', commentId: 'c1', authorId: 'u1', authorName: 'Lan', postTitle: 'Bí mật', body: 'nội dung',
    });
    expect(Object.keys(delivery?.signal ?? {}).sort()).toEqual(['actorUserId', 'change', 'postId']);
  });

  it('rejects events without a post, without an actor, or of another type', () => {
    expect(socialFeedDeliveryFromEvent('social.post.published', { authorId: 'u1' })).toBeUndefined();
    expect(socialFeedDeliveryFromEvent('social.post.published', { postId: 'p1' })).toBeUndefined();
    expect(socialFeedDeliveryFromEvent('social.post.pending', { postId: 'p1', authorId: 'u1' })).toBeUndefined();
    expect(socialFeedDeliveryFromEvent('social.post.published', 'x')).toBeUndefined();
  });

  it('keeps tenant inside the group room name and lists only fan-out source events', () => {
    expect(socialGroupRoom('t1', 'g1')).toBe('tenant:t1:social-group:g1');
    expect(socialGroupRoom('t1', 'g1')).not.toBe(socialGroupRoom('t2', 'g1'));
    expect(isSocialFeedSourceEvent('social.reaction.changed')).toBe(true);
    expect(isSocialFeedSourceEvent('social.post.moderated')).toBe(false);
    expect(SOCIAL_FEED_SOURCE_EVENT_TYPES).not.toContain('social.mention.created');
  });
});
