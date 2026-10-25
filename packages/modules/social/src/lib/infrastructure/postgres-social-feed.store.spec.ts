import { whereClause } from './postgres-social-feed.store.js';

const visibility = { viewerId: 'u1', seesAllGroups: false, canModerate: false, memberGroupIds: [] as string[], unitIds: [] as string[] };

describe('whereClause của bảng tin', () => {
  it('mọi bộ lọc đều dùng tham số $n, không nhúng số trần vào mệnh đề', () => {
    const values: unknown[] = [];
    const clause = whereClause(
      {
        visibility,
        source: 'groups',
        groupId: 'g1',
        topicId: 't1',
        groupTopicId: 'gt1',
        authorId: 'a1',
        kind: 'announcement',
      },
      values,
    );
    // Số trần trước `::uuid` (vd `= 4::uuid`) làm Postgres báo "cannot cast type integer to uuid".
    expect(clause).not.toMatch(/(?<!\$)\b\d+::uuid/);
    expect(values).toEqual(expect.arrayContaining(['g1', 't1', 'gt1', 'a1']));
  });

  it('lọc theo chuyên mục dùng đúng chỉ số tham số của giá trị vừa nối', () => {
    const values: unknown[] = ['x'];
    const clause = whereClause({ visibility, source: 'all', topicId: 'topic-1' }, values);
    const index = values.indexOf('topic-1') + 1;
    // Lọc theo mọi chuyên mục của bài (bảng nối), không chỉ chuyên mục chính.
    expect(clause).toContain(`pt.post_id = p.id AND pt.topic_id = $${index}::uuid`);
  });
});
