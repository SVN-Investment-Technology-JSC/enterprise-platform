import { notificationDeepLink } from './notification-deep-link.js';

describe('notification routes', () => {
  it.each([
    ['/procedures/instances/instance-a', '/modules/procedure#workspace/instance-a'],
    ['/workspace/work-items/task-a', '/modules/workspace#my-work/work-item/task-a'],
    ['/workspace/calendar/event-a', '/modules/workspace#my-work/calendar/event-a'],
    ['/workspace/projects/project-a', '/modules/workspace?project=project-a#projects'],
    ['/hrm/requests/request-a', '/modules/hrm/requests?request=request-a'],
    ['/hrm/payslips/payslip-a', '/modules/hrm/payslips?selected=payslip-a'],
    ['/maintenance/occurrences/occurrence-a', '/modules/maintenance#history/occurrence-a'],
  ])('resolves %s to the installed module route', (value, expected) => {
    expect(notificationDeepLink(value)).toBe(expected);
  });
  it.each(['https://attacker.test', '//attacker.test', '/\\attacker.test', '/platform', '/unknown-module', 'javascript:alert(1)'])('rejects links outside the notification route allow-list: %s', (value) => {
    expect(notificationDeepLink(value)).toBeUndefined();
  });
  it('keeps an allowed module route with its query and fragment', () => {
    expect(notificationDeepLink('/modules/workspace?project=p#projects/work-item/t')).toBe('/modules/workspace?project=p#projects/work-item/t');
  });
});
