import { acquirePosition, type GpsFix } from './hrm-geolocation';

type Ok = (p: GeolocationPosition) => void;
type Err = (e: GeolocationPositionError) => void;

function fakeGeo() {
  let ok: Ok = () => undefined;
  let err: Err = () => undefined;
  const clearWatch = jest.fn();
  return {
    geo: {
      watchPosition: (success: Ok, failure?: Err | null) => {
        ok = success;
        err = failure ?? (() => undefined);
        return 7;
      },
      clearWatch,
    },
    fix: (accuracy: number, latitude = 10) =>
      ok({ coords: { latitude, longitude: 106, accuracy } } as unknown as GeolocationPosition),
    fail: (code: number) => err({ code } as GeolocationPositionError),
    clearWatch,
  };
}

describe('acquirePosition', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('dừng sớm khi sai số đã đủ tốt và trả lần đo đó, đồng thời ngừng theo dõi', async () => {
    const g = fakeGeo();
    const seen: GpsFix[] = [];
    const result = acquirePosition({ maxAccuracy: 100, geolocation: g.geo, onProgress: (f) => seen.push(f) });
    g.fix(250);
    g.fix(60);
    g.fix(20);
    await expect(result).resolves.toMatchObject({ accuracy: 20 });
    expect(g.clearWatch).toHaveBeenCalledWith(7);
    expect(seen.map((f) => f.accuracy)).toEqual([250, 60, 20]);
  });

  it('không thay lần đo tốt bằng lần đo kém hơn; hết giờ thì dùng lần đo tốt nhất nếu đạt ngưỡng', async () => {
    const g = fakeGeo();
    const result = acquirePosition({ maxAccuracy: 100, geolocation: g.geo, timeoutMs: 10_000 });
    g.fix(80, 11);
    g.fix(95, 12);
    jest.advanceTimersByTime(10_000);
    await expect(result).resolves.toMatchObject({ accuracy: 80, latitude: 11 });
  });

  it('hết giờ mà tốt nhất vẫn vượt ngưỡng thì báo sai số kèm hướng dẫn', async () => {
    const g = fakeGeo();
    const result = acquirePosition({ maxAccuracy: 100, geolocation: g.geo, timeoutMs: 5000 });
    g.fix(480);
    jest.advanceTimersByTime(5000);
    await expect(result).rejects.toThrow(/±480 m, cần không quá 100 m/);
  });

  it('từ chối quyền vị trí thì báo ngay; lỗi tạm thời thì chờ đo tiếp', async () => {
    const denied = fakeGeo();
    const a = acquirePosition({ maxAccuracy: 100, geolocation: denied.geo });
    denied.fail(1);
    await expect(a).rejects.toThrow(/từ chối quyền vị trí/);

    const flaky = fakeGeo();
    const b = acquirePosition({ maxAccuracy: 100, geolocation: flaky.geo });
    flaky.fail(2);
    flaky.fix(12);
    await expect(b).resolves.toMatchObject({ accuracy: 12 });
  });

  it('không có lần đo nào cho đến hết giờ thì báo hết thời gian chờ', async () => {
    const g = fakeGeo();
    const result = acquirePosition({ maxAccuracy: 100, geolocation: g.geo, timeoutMs: 3000 });
    g.fail(3);
    jest.advanceTimersByTime(3000);
    await expect(result).rejects.toThrow(/Hết thời gian chờ định vị/);
  });

  it('trình duyệt không có định vị thì báo không hỗ trợ', async () => {
    await expect(acquirePosition({ maxAccuracy: 100, geolocation: undefined as never })).rejects.toThrow(/không hỗ trợ/);
  });
});
