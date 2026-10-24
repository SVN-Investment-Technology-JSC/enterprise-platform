/**
 * Lấy vị trí để chấm công trên web. Một lần `getCurrentPosition` thường trả về vị trí thô (theo Wi-Fi hoặc IP) với sai số
 * hàng trăm mét; GPS cần vài giây để "bắt" vệ tinh nên sai số giảm dần. Vì vậy ta theo dõi liên tục (`watchPosition`), giữ
 * lần đo chính xác nhất và dừng sớm khi đã đủ tốt hoặc hết thời gian chờ.
 */

export interface GpsFix {
  latitude: number;
  longitude: number;
  /** Sai số ước tính, đơn vị mét. */
  accuracy: number;
}

export interface AcquireOptions {
  /** Sai số tối đa mà chính sách chấp nhận (mét). Vượt ngưỡng này thì không dùng để chấm công. */
  maxAccuracy: number;
  /** Dừng sớm khi sai số không quá giá trị này. Mặc định: một phần ba ngưỡng chính sách, tối thiểu 15 m. */
  goodAccuracy?: number;
  /** Thời gian chờ tối đa (ms). */
  timeoutMs?: number;
  /** Gọi mỗi khi có lần đo tốt hơn, để hiển thị sai số đang đạt được. */
  onProgress?: (fix: GpsFix) => void;
  /** Cho kiểm thử; mặc định là `navigator.geolocation`. */
  geolocation?: Pick<Geolocation, 'watchPosition' | 'clearWatch'>;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export const gpsAccuracyMessage = (accuracy: number, maxAccuracy: number) =>
  `Độ chính xác vị trí hiện tại ±${Math.round(accuracy)} m, cần không quá ${Math.round(maxAccuracy)} m. ` +
  'Hãy bật GPS (hoặc Wi-Fi), ra gần cửa sổ hoặc nơi thoáng rồi thử lại; trên máy tính bàn thường không đủ chính xác, nên dùng điện thoại.';

function errorMessage(code: number): string {
  if (code === 1) return 'Bạn đã từ chối quyền vị trí. Hãy cho phép trang này truy cập vị trí trong cài đặt trình duyệt rồi thử lại.';
  if (code === 2) return 'Thiết bị không xác định được vị trí. Kiểm tra GPS hoặc kết nối mạng rồi thử lại.';
  return 'Hết thời gian chờ định vị. Hãy ra nơi thoáng hơn rồi thử lại.';
}

/** Trả về lần đo tốt nhất trong thời gian chờ; từ chối (kèm thông báo tiếng Việt) khi không đo được hoặc sai số vượt ngưỡng. */
export function acquirePosition(options: AcquireOptions): Promise<GpsFix> {
  const geo = options.geolocation ?? (typeof navigator === 'undefined' ? undefined : navigator.geolocation);
  if (!geo) return Promise.reject(new Error('Trình duyệt không hỗ trợ định vị GPS.'));
  // Ngưỡng "đủ tốt" không được lỏng hơn ngưỡng chính sách: chính sách ±10 m mà dừng ở lần đo ±14 m sẽ bị từ chối dù chờ thêm có thể đạt.
  const good = Math.min(options.maxAccuracy, options.goodAccuracy ?? Math.max(15, options.maxAccuracy / 3));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise<GpsFix>((resolve, reject) => {
    let best: GpsFix | null = null;
    let lastError: GeolocationPositionError | null = null;
    let watchId: number | null = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (watchId !== null) geo.clearWatch(watchId);
      if (best && best.accuracy <= options.maxAccuracy) resolve(best);
      else if (best) reject(new Error(gpsAccuracyMessage(best.accuracy, options.maxAccuracy)));
      else reject(new Error(errorMessage(lastError?.code ?? 3)));
    };
    const timer = setTimeout(finish, timeoutMs);
    watchId = geo.watchPosition(
      (position) => {
        const fix = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        if (!best || fix.accuracy < best.accuracy) {
          best = fix;
          options.onProgress?.(fix);
        }
        if (best.accuracy <= good) finish();
      },
      (error) => {
        lastError = error;
        // Từ chối quyền là lỗi dứt khoát; các lỗi khác (không xác định, hết giờ) có thể tự hết khi đo tiếp.
        if (error.code === 1) finish();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
  });
}
