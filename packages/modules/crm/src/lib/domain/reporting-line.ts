/**
 * Quan hệ "Báo cáo cho" rút từ cơ cấu tổ chức của Tenant Core, chỉ giữ phần
 * cần để tính cấp dưới. Thuần dữ liệu: không HTTP, không DB.
 */
export interface ReportingLineSnapshot {
  /** Mọi node (đơn vị và chức danh) kèm chức danh mà node đó báo cáo cho. */
  readonly positions: readonly ReportingPosition[];
  /** Ai đang giữ node nào; một người có thể giữ nhiều node. */
  readonly assignments: readonly ReportingAssignment[];
}

export interface ReportingPosition {
  readonly id: string;
  readonly reportsToPositionId?: string | null;
}

export interface ReportingAssignment {
  readonly userId: string;
  /** Node được bổ nhiệm: thường là chức danh, dữ liệu cũ có thể là đơn vị. */
  readonly positionId: string;
  /** Ô ghi đè "Báo cáo cho" riêng của phân công này; thắng giá trị của chức danh. */
  readonly reportsToOverrideId?: string | null;
}

/** Chuỗi báo cáo sâu hơn mức này coi như dữ liệu hỏng và dừng, như HRM. */
const MAX_CHAIN_DEPTH = 50;

/**
 * Cấp dưới của `actorUserId`: mọi người có chuỗi "Báo cáo cho" đi qua một chức
 * danh mà actor đang giữ. Không gồm chính actor.
 *
 * Cùng cách tính với `computeSubordinateUserIds` của HRM để "nhóm" ở Bán hàng
 * và "cấp dưới" ở HRM là một: bắt đầu từ chức danh của mỗi người, bước đầu dùng
 * ô ghi đè của phân công nếu có, sau đó leo theo "Báo cáo cho" của chức danh.
 * Trưởng đơn vị không được tính nếu không nằm trên chuỗi báo cáo. Vòng lặp
 * trong dữ liệu (A báo cáo B, B báo cáo A) dừng ở node đã đi qua.
 */
export function computeSubordinateUserIds(
  snapshot: ReportingLineSnapshot,
  actorUserId: string,
): Set<string> {
  const reportsTo = new Map<string, string | null | undefined>();
  for (const position of snapshot.positions) reportsTo.set(position.id, position.reportsToPositionId);

  const heldPositions = new Set(
    snapshot.assignments
      .filter((assignment) => assignment.userId === actorUserId)
      .map((assignment) => assignment.positionId),
  );
  const result = new Set<string>();
  if (heldPositions.size === 0) return result;

  for (const assignment of snapshot.assignments) {
    if (assignment.userId === actorUserId || result.has(assignment.userId)) continue;
    const start = assignment.positionId;
    const seen = new Set<string>([start]);
    let cursor = assignment.reportsToOverrideId ?? reportsTo.get(start);
    let depth = 0;
    while (cursor && !seen.has(cursor) && depth++ < MAX_CHAIN_DEPTH) {
      if (heldPositions.has(cursor)) {
        result.add(assignment.userId);
        break;
      }
      seen.add(cursor);
      cursor = reportsTo.get(cursor);
    }
  }

  result.delete(actorUserId);
  return result;
}
