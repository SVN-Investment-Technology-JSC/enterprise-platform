'use client';

import type { SocialReactionType } from '@enterprise-platform/contracts-social';
import type { AnimationItem } from 'lottie-web';
import { useEffect, useRef, useState } from 'react';
import { SOCIAL_BASE_PATH } from '../social.model';

// Hoạt hình: Google Noto Animated Emoji (CC BY 4.0), tự host ở apps/social-web/public/reactions.
const REACTION_ASSET_DIR = `${SOCIAL_BASE_PATH}/reactions`;

export function reactionAssetUrl(type: SocialReactionType): string {
  return `${REACTION_ASSET_DIR}/${type}.json`;
}

type LottieModule = typeof import('lottie-web').default;

// Cache mức module: mỗi loại chỉ tải JSON một lần, mọi instance dùng chung (null khi lỗi).
const jsonCache = new Map<string, Promise<string | null>>();
let playerPromise: Promise<LottieModule> | null = null;

function loadJson(type: SocialReactionType): Promise<string | null> {
  let entry = jsonCache.get(type);
  if (!entry) {
    entry = fetch(reactionAssetUrl(type))
      .then((response) => (response.ok ? response.text() : null))
      .catch(() => null);
    jsonCache.set(type, entry);
  }
  return entry;
}

function loadPlayer(): Promise<LottieModule> {
  playerPromise ??= import('lottie-web/build/player/lottie_light').then((m) => m.default);
  return playerPromise;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function ReactionIcon({
  type,
  size = 24,
  playing = false,
  className,
}: {
  type: SocialReactionType;
  size?: number;
  playing?: boolean;
  className?: string;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const animation = useRef<AnimationItem | null>(null);
  const [ready, setReady] = useState(false);
  const shouldPlay = playing && !prefersReducedMotion();
  const shouldPlayRef = useRef(shouldPlay);
  shouldPlayRef.current = shouldPlay;

  useEffect(() => {
    let cancelled = false;
    let item: AnimationItem | null = null;
    void Promise.all([loadJson(type), loadPlayer().catch(() => null)]).then(([json, player]) => {
      if (cancelled || !json || !player || !host.current) return;
      try {
        // Mỗi instance parse bản riêng vì lottie-web có thể sửa dữ liệu hoạt hình.
        item = player.loadAnimation({
          container: host.current,
          renderer: 'svg',
          loop: true,
          autoplay: false,
          animationData: JSON.parse(json),
          rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
        });
        animation.current = item;
        if (shouldPlayRef.current) item.play();
        else item.goToAndStop(0, true);
        setReady(true);
      } catch {
        setReady(false);
      }
    });
    return () => {
      cancelled = true;
      animation.current = null;
      item?.destroy();
    };
  }, [type]);

  useEffect(() => {
    const item = animation.current;
    if (!item || !ready) return;
    if (shouldPlay) item.play();
    else item.goToAndStop(0, true);
  }, [shouldPlay, ready]);

  return (
    <span
      ref={host}
      aria-hidden="true"
      className={className}
      style={{ display: 'inline-block', width: size, height: size, flexShrink: 0, lineHeight: 0 }}
    />
  );
}
