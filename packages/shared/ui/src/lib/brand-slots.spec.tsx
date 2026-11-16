import { render, screen, waitFor } from '@testing-library/react';
import type { BrandSlotManifestResponse } from '@enterprise-platform/shared-brand-icon';
import {
  AppIcon,
  BRAND_SLOTS_CACHE_KEY,
  BrandSlotProvider,
  useBrandSlot,
  type AppIconFallbackProps,
} from './brand-slots';

function FallbackIcon({
  className,
  size,
  'aria-hidden': ariaHidden,
  'aria-label': ariaLabel,
}: AppIconFallbackProps) {
  return (
    <span
      data-testid="fallback-icon"
      data-size={size}
      className={className}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
    />
  );
}

function SlotProbe() {
  const state = useBrandSlot('brand.logo');
  return (
    <div
      data-testid="slot-probe"
      data-has-custom={String(state.hasCustom)}
      data-loaded={String(state.loaded)}
      data-icon-id={state.item?.iconId ?? ''}
    />
  );
}

function createManifest(hash = 'hash-v1'): BrandSlotManifestResponse {
  return {
    hash,
    slots: {
      'brand.logo': {
        slot: 'brand.logo',
        iconId: 'logo-main',
        version: 2,
        colorMode: 'brand',
        model: {
          viewBox: '0 0 32 32',
          rootAttrs: {
            fill: 'none',
            'stroke-width': '2',
            class: 'brand-root',
          },
          defs: [
            {
              tag: 'linearGradient',
              attrs: {
                id: 'grad-1',
                x1: '0',
                y1: '0',
                x2: '32',
                y2: '32',
                gradientUnits: 'userSpaceOnUse',
              },
              children: [
                {
                  tag: 'stop',
                  attrs: { offset: '0', 'stop-color': '#112233' },
                },
                {
                  tag: 'stop',
                  attrs: { offset: '1', 'stop-color': '#445566' },
                },
              ],
            },
          ],
          children: [
            {
              tag: 'g',
              attrs: { 'fill-opacity': '0.9' },
              children: [
                {
                  tag: 'path',
                  attrs: { d: 'M0 0h32v32H0z', fill: 'url(#grad-1)' },
                },
              ],
            },
          ],
        },
      },
      'module.hrm': {
        slot: 'module.hrm',
        iconId: 'hrm-icon',
        version: 1,
        colorMode: 'brand',
        model: {
          viewBox: '0 0 24 24',
          rootAttrs: { fill: 'none' },
          defs: [
            // Trùng id với defs của brand.logo để kiểm tra khử trùng lặp.
            {
              tag: 'linearGradient',
              attrs: { id: 'grad-1', x1: '0', y1: '0', x2: '24', y2: '24' },
              children: [],
            },
          ],
          children: [
            {
              tag: 'circle',
              attrs: { cx: '12', cy: '12', r: '10', stroke: '#000000' },
            },
          ],
        },
      },
    },
  };
}

describe('brand-slots', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('hiển thị fallback khi không có BrandSlotProvider', () => {
    render(
      <AppIcon
        slot="brand.logo"
        fallback={FallbackIcon}
        size={24}
        className="custom-cls"
      />,
    );

    const fallback = screen.getByTestId('fallback-icon');
    expect(fallback).toBeTruthy();
    expect(fallback.getAttribute('data-size')).toBe('24');
    expect(fallback.getAttribute('class')).toBe('custom-cls');
    expect(fallback.getAttribute('aria-hidden')).toBe('true');
  });

  it('hiển thị fallback khi slot chưa có trong manifest và giữ aria-label khi truyền vào', () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => createManifest(),
    } as Response);

    render(
      <BrandSlotProvider initialManifest={createManifest()}>
        <AppIcon
          slot="nav.dashboard"
          fallback={FallbackIcon}
          size={18}
          aria-label="Bảng điều khiển"
        />
      </BrandSlotProvider>,
    );

    const fallback = screen.getByTestId('fallback-icon');
    expect(fallback.getAttribute('aria-label')).toBe('Bảng điều khiển');
    expect(fallback.getAttribute('aria-hidden')).toBeNull();
  });

  it('dựng <symbol>, gom <defs> không trùng id và render <use href="#ep-slot-...">', async () => {
    const manifest = createManifest();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => manifest,
    } as Response);

    const { container } = render(
      <BrandSlotProvider endpoint="/custom/brand/manifest">
        <AppIcon
          slot="brand.logo"
          fallback={FallbackIcon}
          size={32}
          className="logo-icon"
          aria-label="Logo"
        />
        <SlotProbe />
      </BrandSlotProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('slot-probe').getAttribute('data-has-custom'),
      ).toBe('true');
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/custom/brand/manifest',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    const symbol = container.querySelector('symbol#ep-slot-brand-logo');
    expect(symbol).toBeTruthy();
    expect(symbol?.getAttribute('viewBox')).toBe('0 0 32 32');
    expect(symbol?.getAttribute('stroke-width')).toBe('2');
    expect(symbol?.getAttribute('class')).toBe('brand-root');
    expect(symbol?.querySelector('g[fill-opacity="0.9"] path')).toBeTruthy();

    // Chỉ có 1 linearGradient#grad-1 trong <defs> dù 2 slot cùng khai báo id này.
    const gradients = container.querySelectorAll('defs linearGradient#grad-1');
    expect(gradients.length).toBe(1);
    expect(gradients[0]?.querySelectorAll('stop').length).toBe(2);

    const useEl = container.querySelector('svg.logo-icon use');
    expect(useEl).toBeTruthy();
    expect(useEl?.getAttribute('href')).toBe('#ep-slot-brand-logo');
    expect(useEl?.parentElement?.getAttribute('width')).toBe('32');
    expect(useEl?.parentElement?.getAttribute('height')).toBe('32');
    expect(useEl?.parentElement?.getAttribute('aria-label')).toBe('Logo');
    expect(useEl?.parentElement?.getAttribute('aria-hidden')).toBeNull();
  });

  it('đọc cache từ localStorage ngay lập tức và cập nhật ngầm khi hash mới', async () => {
    const cached = createManifest('hash-old');
    window.localStorage.setItem(BRAND_SLOTS_CACHE_KEY, JSON.stringify(cached));

    const baseUpdated = createManifest('hash-new');
    const updated: BrandSlotManifestResponse = {
      ...baseUpdated,
      slots: {
        ...baseUpdated.slots,
        'brand.logo': {
          ...baseUpdated.slots['brand.logo'],
          iconId: 'logo-updated',
        },
      },
    };

    let resolveFetch!: (value: Response) => void;
    global.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { container } = render(
      <BrandSlotProvider>
        <AppIcon slot="brand.logo" fallback={FallbackIcon} size={32} />
        <SlotProbe />
      </BrandSlotProvider>,
    );

    // Render ngay từ cache trước khi fetch xong.
    expect(container.querySelector('use')?.getAttribute('href')).toBe(
      '#ep-slot-brand-logo',
    );
    expect(screen.getByTestId('slot-probe').getAttribute('data-icon-id')).toBe(
      'logo-main',
    );

    resolveFetch({
      ok: true,
      json: async () => updated,
    } as Response);

    await waitFor(() => {
      expect(
        screen.getByTestId('slot-probe').getAttribute('data-icon-id'),
      ).toBe('logo-updated');
    });

    const stored = JSON.parse(
      window.localStorage.getItem(BRAND_SLOTS_CACHE_KEY) ?? 'null',
    ) as BrandSlotManifestResponse | null;
    expect(stored?.hash).toBe('hash-new');
  });

  it('rơi về fallback an toàn và không ném lỗi khi fetch thất bại', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network down'));

    render(
      <BrandSlotProvider>
        <AppIcon slot="brand.logo" fallback={FallbackIcon} size={20} />
        <SlotProbe />
      </BrandSlotProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('slot-probe').getAttribute('data-loaded')).toBe(
        'true',
      );
    });

    expect(screen.getByTestId('fallback-icon')).toBeTruthy();
    expect(
      screen.getByTestId('slot-probe').getAttribute('data-has-custom'),
    ).toBe('false');
  });
});
