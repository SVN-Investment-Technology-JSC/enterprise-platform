'use client';

import type { Pipeline } from '@enterprise-platform/contracts-crm';
import { useEffect, useState } from 'react';
import { listPipelines } from '../crm-api';

/** Các luồng bán hàng của tenant (kèm giai đoạn, bước chuyển). Lỗi tải thì trả danh sách rỗng. */
export function usePipelines(): { pipelines: readonly Pipeline[]; loaded: boolean } {
  const [state, setState] = useState<{ pipelines: readonly Pipeline[]; loaded: boolean }>({ pipelines: [], loaded: false });
  useEffect(() => {
    let alive = true;
    listPipelines()
      .then((pipelines) => alive && setState({ pipelines, loaded: true }))
      .catch(() => alive && setState({ pipelines: [], loaded: true }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
