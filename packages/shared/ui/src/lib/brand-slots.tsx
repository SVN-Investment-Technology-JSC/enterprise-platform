'use client';

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  BRAND_API_BASE,
  toCamelAttr,
  type BrandSlotManifestItem,
  type BrandSlotManifestResponse,
  type IconSlotId,
  type SvgNode,
} from '@enterprise-platform/shared-brand-icon';

export const BRAND_SLOTS_CACHE_KEY = 'ep_brand_slots_manifest_v1';
export const BRAND_SLOTS_CHANGED_EVENT = 'ep:brand-slots-changed';
const DEFAULT_MANIFEST_ENDPOINT = `${BRAND_API_BASE}/slots/manifest`;

/** Phát tín hiệu để mọi `BrandSlotProvider` đang mở (trên cùng tab và xuyên các tab) nạp lại manifest ngay lập tức. */
export function notifyBrandSlotsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BRAND_SLOTS_CHANGED_EVENT));
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(BRAND_SLOTS_CHANGED_EVENT);
      channel.postMessage({ type: BRAND_SLOTS_CHANGED_EVENT });
      channel.close();
    }
  } catch {
    // Bỏ qua nếu môi trường không hỗ trợ BroadcastChannel.
  }
}

export interface BrandSlotContextValue {
  readonly manifest: BrandSlotManifestResponse | null;
  readonly loaded: boolean;
}

const BrandSlotContext = createContext<BrandSlotContextValue>({
  manifest: null,
  loaded: false,
});

export interface BrandSlotProviderProps {
  children: ReactNode;
  endpoint?: string;
  initialManifest?: BrandSlotManifestResponse | null;
}

function isValidManifest(value: unknown): value is BrandSlotManifestResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.hash === 'string' &&
    record.slots !== null &&
    typeof record.slots === 'object'
  );
}

function readCachedManifest(): BrandSlotManifestResponse | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(BRAND_SLOTS_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedManifest(manifest: BrandSlotManifestResponse): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BRAND_SLOTS_CACHE_KEY, JSON.stringify(manifest));
  } catch {
    // Bỏ qua khi trình duyệt chặn storage hoặc hết dung lượng.
  }
}

function toReactSvgAttrs(attrs: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'style') continue;
    const reactName = name === 'class' ? 'className' : toCamelAttr(name);
    result[reactName] = value;
  }
  return result;
}

function renderSvgNode(node: SvgNode, key: string): ReactElement {
  const props: Record<string, unknown> = {
    key,
    ...toReactSvgAttrs(node.attrs),
  };
  const children = node.children?.map((child, index) =>
    renderSvgNode(child, `${key}-${index}`),
  );
  return createElement(node.tag, props, ...(children ?? []));
}

export function BrandSlotProvider({
  children,
  endpoint = DEFAULT_MANIFEST_ENDPOINT,
  initialManifest,
}: BrandSlotProviderProps) {
  const [manifest, setManifest] = useState<BrandSlotManifestResponse | null>(
    () => initialManifest ?? null,
  );
  const [loaded, setLoaded] = useState<boolean>(() => Boolean(initialManifest));

  useEffect(() => {
    if (initialManifest !== undefined) {
      setManifest(initialManifest);
      setLoaded(true);
      if (initialManifest) {
        writeCachedManifest(initialManifest);
      }
    } else {
      const cached = readCachedManifest();
      if (cached) {
        setManifest(cached);
        setLoaded(true);
      }
    }

    if (typeof fetch !== 'function') {
      setLoaded(true);
      return;
    }

    const controller = new AbortController();
    let active = true;

    const loadManifest = async (noStore = false) => {
      try {
        const response = await fetch(endpoint, {
          signal: controller.signal,
          cache: noStore ? 'no-store' : 'default',
        });
        if (!active || !response.ok) return;
        const data: unknown = await response.json();
        if (!active || !isValidManifest(data)) return;

        setManifest((prev) => (prev?.hash === data.hash ? prev : data));
        writeCachedManifest(data);
      } catch {
        // Lỗi mạng hoặc huỷ request: im lặng giữ cache hoặc rơi về fallback.
      } finally {
        if (active) {
          setLoaded(true);
        }
      }
    };

    void loadManifest(false);

    const onSlotsChanged = () => {
      void loadManifest(true);
    };
    let channel: BroadcastChannel | null = null;
    if (typeof window !== 'undefined') {
      window.addEventListener(BRAND_SLOTS_CHANGED_EVENT, onSlotsChanged);
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          channel = new BroadcastChannel(BRAND_SLOTS_CHANGED_EVENT);
          channel.onmessage = () => {
            void loadManifest(true);
          };
        }
      } catch {
        channel = null;
      }
    }

    return () => {
      active = false;
      controller.abort();
      if (typeof window !== 'undefined') {
        window.removeEventListener(BRAND_SLOTS_CHANGED_EVENT, onSlotsChanged);
      }
      channel?.close();
    };
  }, [endpoint, initialManifest]);

  const value = useMemo<BrandSlotContextValue>(
    () => ({ manifest, loaded }),
    [manifest, loaded],
  );

  return (
    <BrandSlotContext.Provider value={value}>
      {children}
    </BrandSlotContext.Provider>
  );
}

export interface UseBrandSlotResult {
  readonly item: BrandSlotManifestItem | undefined;
  readonly hasCustom: boolean;
  readonly loaded: boolean;
}

export function useBrandSlot(slot: IconSlotId): UseBrandSlotResult {
  const { manifest, loaded } = useContext(BrandSlotContext);
  const item = manifest?.slots[slot];
  return {
    item,
    hasCustom: Boolean(item),
    loaded,
  };
}

export interface AppIconFallbackProps {
  className?: string;
  size?: number | string;
  'aria-hidden'?: boolean | 'true' | 'false';
  'aria-label'?: string;
}

export interface AppIconProps {
  slot: IconSlotId;
  fallback: ComponentType<AppIconFallbackProps>;
  size?: number | string;
  className?: string;
  'aria-label'?: string;
}

export function AppIcon({
  slot,
  fallback: Fallback,
  size,
  className,
  'aria-label': ariaLabel,
}: AppIconProps) {
  const { item } = useBrandSlot(slot);
  const ariaHidden = ariaLabel ? undefined : true;

  if (item) {
    const { model } = item;
    const rootAttrs = toReactSvgAttrs(model.rootAttrs);
    const mergedClassName = [className, rootAttrs.className].filter(Boolean).join(' ') || undefined;

    return (
      <svg
        aria-hidden={ariaHidden}
        aria-label={ariaLabel}
        data-brand-slot={slot}
        height={size}
        viewBox={model.viewBox}
        width={size}
        {...rootAttrs}
        className={mergedClassName}
      >
        {model.defs.length > 0 ? (
          <defs>
            {model.defs.map((def, index) =>
              renderSvgNode(def, `${slot}-def-${def.attrs?.id ?? index}`),
            )}
          </defs>
        ) : null}
        {model.children.map((child, index) =>
          renderSvgNode(child, `${slot}-child-${index}`),
        )}
      </svg>
    );
  }

  return (
    <Fallback
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      size={size}
      className={className}
    />
  );
}
