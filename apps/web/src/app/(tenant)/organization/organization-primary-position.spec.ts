import {
  countHeldPositions,
  findPrimaryElsewhere,
  isConcurrentHolder,
} from './organization-primary-position';

type A = Parameters<typeof countHeldPositions>[0][number];

const row = (
  id: string,
  userId: string,
  nodeId: string,
  isPrimary: boolean,
  status = 'active',
): A => ({ id, userId, nodeId, isPrimary, status }) as A;

describe('organization-primary-position', () => {
  const list: A[] = [
    row('a1', 'u1', 'n1', true),
    row('a2', 'u1', 'n2', false),
    row('a3', 'u2', 'n1', true),
    row('a4', 'u3', 'n2', false),
    row('a5', 'u3', 'n3', false, 'ended'),
  ];

  it('finds the primary position held elsewhere, ignoring the same node', () => {
    expect(findPrimaryElsewhere(list, 'u1', 'n2')?.nodeId).toBe('n1');
    expect(findPrimaryElsewhere(list, 'u1', 'n1')).toBeUndefined();
    expect(findPrimaryElsewhere(list, 'u2', 'n9')?.nodeId).toBe('n1');
  });

  it('ignores inactive assignments and the excluded assignment', () => {
    expect(findPrimaryElsewhere([row('x', 'u1', 'n1', true, 'ended')], 'u1', 'n2')).toBeUndefined();
    expect(findPrimaryElsewhere(list, 'u2', 'n9', 'a3')).toBeUndefined();
  });

  it('counts distinct active positions per user', () => {
    expect(countHeldPositions(list, 'u1')).toBe(2);
    expect(countHeldPositions(list, 'u3')).toBe(1);
  });

  it('marks concurrent holders only when not primary and in 2+ positions', () => {
    expect(isConcurrentHolder(list, list[1])).toBe(true); // u1 at n2, primary at n1
    expect(isConcurrentHolder(list, list[0])).toBe(false); // primary
    expect(isConcurrentHolder(list, list[3])).toBe(false); // u3 only one active position
  });
});
