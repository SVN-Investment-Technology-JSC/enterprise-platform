'use client';

import { useEffect } from 'react';

/** Tạm dừng mọi video đang phát trong `root` trừ `active`. Trả về số video đã dừng. */
export function pauseOtherVideos(active: EventTarget | null, root: ParentNode = document): number {
  let paused = 0;
  for (const video of Array.from(root.querySelectorAll('video'))) {
    if (video !== active && !video.paused && !video.ended) {
      video.pause();
      paused += 1;
    }
  }
  return paused;
}

let listeners = 0;

function onPlay(event: Event) {
  if (event.target instanceof HTMLVideoElement) pauseOtherVideos(event.target);
}

/**
 * Chỉ một video phát tại một thời điểm trong trang. Sự kiện `play` không nổi bọt nên nghe ở pha bắt
 * (capture) trên tài liệu; một bộ nghe dùng chung cho mọi video, gỡ khi video cuối cùng bị huỷ.
 */
export function useExclusiveVideoPlayback(): void {
  useEffect(() => {
    if (listeners === 0) document.addEventListener('play', onPlay, true);
    listeners += 1;
    return () => {
      listeners -= 1;
      if (listeners === 0) document.removeEventListener('play', onPlay, true);
    };
  }, []);
}
