import { assertCanIssue, availableStock } from './stock.policy.js';
describe('stock policy',()=>{ it('calculates available quantity',()=>expect(availableStock(10,2,1,1)).toBe(6)); it('prevents negative stock',()=>expect(()=>assertCanIssue(2,3)).toThrow('không đủ')); });
