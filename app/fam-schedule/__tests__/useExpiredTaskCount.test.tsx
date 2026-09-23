/**
 * useExpiredTaskCount å•å…ƒæµ‹è¯• â€” T-US015-1
 *
 * è¦†ç›–èŒƒå›´(ä»»åŠ¡ brief Â§D):
 *   1. family null â†’ count 0 + loading=false(æ—  supabase è°ƒç”¨)
 *   2. family settings off â†’ count 0(filterExpiredTasks èµ° off åˆ†æ”¯è¿” 0)
 *   3. family settings yesterday_today â†’ è®¡ç®—æ˜¨æ—¥+ä»Šæ—¥æœªå®Œæˆè¿‡æœŸä»»åŠ¡æ•°
 *   4. åˆ‡ view è§¦å‘é‡æ–°è®¡ç®—(tasks å¼•ç”¨å˜åŒ– â†’ useEffect é‡è·‘)
 *   5. loading state(åˆå§‹ true â†’ å¼‚æ­¥å®ŒæˆåŽ false)+ service throw å…œåº•
 *
 * æµ‹è¯•ç­–ç•¥(å¯¹é½ codeInput.test.tsx hook harness æ¨¡å¼):
 *   - jest-expo + React 19 + jsxImportSource: tamagui â†’ ä¸æŒ‚ RN ç»„ä»¶æ ‘
 *   - ç”¨ react-test-renderer + <HookHarness /> æ•èŽ· hook è¿”å›žå€¼(ref é—´æŽ¥è¯»)
 *   - mock useTasks + useFamilyValue + getExpiredTasksSummary;éªŒè¯ hook è°ƒç”¨å¥‘çº¦
 *   - å®žé™…ä¸šåŠ¡é€»è¾‘ç”± ExpiryService.test.tsx å•ç‹¬è¦†ç›–(filterExpiredTasks + makeExpiryWindowPredicate)
 *
 * ä¸¥æ ¼ scope:
 *   - åªæµ‹ hook è¡Œä¸ºå¥‘çº¦(family / tasks / today å˜åŒ– â†’ è°ƒç”¨ service / è®¾ state)
 *   - ä¸æµ‹ service å†…éƒ¨(ç”± ExpiryService.test.tsx è¦†ç›–)
 *   - ä¸æµ‹ UI æ¸²æŸ“(ç•™ T-US015-2)
 */

import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import type { Task } from '../src/lib/LocalStore';
import type { FamilyContextValue } from '../src/services/FamilyService';

// ---- Mock supabase + SyncManager + useTasks + useFamilyValue ----

jest.mock('../src/lib/supabase', () => {
  const mockChain = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(),
  };
  return { supabase: mockChain };
});

jest.mock('../src/hooks/useTasks', () => ({
  useTasks: jest.fn(),
}));

jest.mock('../src/contexts/FamilyContext', () => ({
  useFamilyValue: jest.fn(),
}));

jest.mock('../src/services/ExpiryService', () => ({
  getExpiredTasksSummary: jest.fn(),
}));

// ---- Imports (mock ä¹‹åŽ) ----

import { useTasks } from '../src/hooks/useTasks';
import { useFamilyValue } from '../src/contexts/FamilyContext';
import { getExpiredTasksSummary } from '../src/services/ExpiryService';
import {
  useExpiredTaskCount,
  type ExpiredTaskCountState,
} from '../src/hooks/useExpiredTaskCount';

const mockUseTasks = useTasks as jest.Mock;
const mockUseFamilyValue = useFamilyValue as jest.Mock;
const mockGetExpiredTasksSummary = getExpiredTasksSummary as jest.Mock;

// ---- Test fixtures ----------------------------------------------------

const TODAY = '2026-09-23';
const YESTERDAY = '2026-09-22';
const FAMILY_ID = 'family-uuid-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CREATOR_ID = 'creator-uuid-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeFamilyValue(): FamilyContextValue {
  return {
    family: {
      id: FAMILY_ID,
      created_by: CREATOR_ID,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    members: [],
    myRole: 'creator',
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-uuid',
    template_id: null,
    family_id: FAMILY_ID,
    title: 'å–‚å¥¶ç²‰',
    description: null,
    task_date: YESTERDAY,
    task_time: '10:00:00',
    assignee_id: CREATOR_ID,
    co_executor_ids: [],
    is_shared_view: false,
    created_by: CREATOR_ID,
    completed_at: null,
    completed_by: null,
    is_makeup: false,
    cancelled: false,
    created_at: '2026-09-22T00:00:00.000Z',
    updated_at: '2026-09-22T00:00:00.000Z',
    ...overrides,
  };
}

// ---- Hook harness(react-test-renderer æ¸²æŸ“æœ€å°åŒ– React tree) ----

interface HookProbe {
  current: ExpiredTaskCountState | null;
}

/**
 * æžç®€ harness:æŠŠ hook è¿”å›žå†™åˆ° probeRef.current,ç»„ä»¶æœ¬èº« render `<div />` â€”
 * TestRenderer ä¸ä¼šå›  jsxImportSource: tamagui æŠ¥é”™(æœ¬ç»„ä»¶æ—  Tamagui å…ƒç´ )ã€‚
 */
function HookHarness({
  probeRef,
  today,
}: {
  probeRef: React.MutableRefObject<HookProbe>;
  today: string;
}): React.ReactElement {
  const state = useExpiredTaskCount(today);
  probeRef.current = { current: state };
  return React.createElement('div');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseTasks.mockReturnValue([]);
  mockUseFamilyValue.mockReturnValue(null);
  mockGetExpiredTasksSummary.mockResolvedValue({
    count: 0,
    tasks: [],
    window: 'yesterday_today',
  });
});

// =====================================================================
// 1. family null â†’ count 0 + loading=false, no service call
// =====================================================================

describe('useExpiredTaskCount â€” family null defense', () => {
  it('returns {count:0, loading:false} when family is null (no service call)', async () => {
    mockUseFamilyValue.mockReturnValue(null);

    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    await act(async () => {
      TestRenderer.create(React.createElement(HookHarness, { probeRef, today: TODAY }));
    });

    const state = probeRef.current!.current!;
    expect(state.count).toBe(0);
    expect(state.loading).toBe(false);
    expect(mockGetExpiredTasksSummary).not.toHaveBeenCalled();
  });
});

// =====================================================================
// 2. family settings off â†’ count 0
// =====================================================================

describe('useExpiredTaskCount â€” settings off â†’ count 0', () => {
  it('returns count=0 when family settings.expiry_window = "off"', async () => {
    mockUseFamilyValue.mockReturnValue(makeFamilyValue());
    mockUseTasks.mockReturnValue([makeTask(), makeTask()]);
    mockGetExpiredTasksSummary.mockResolvedValue({
      count: 0,
      tasks: [],
      window: 'off',
    });

    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    await act(async () => {
      TestRenderer.create(React.createElement(HookHarness, { probeRef, today: TODAY }));
      // æŽ¨å¾®ä»»åŠ¡è®© promise.then å®Œæˆ
      await Promise.resolve();
    });

    const state = probeRef.current!.current!;
    expect(state.count).toBe(0);
    expect(state.loading).toBe(false);
    expect(mockGetExpiredTasksSummary).toHaveBeenCalledWith(
      FAMILY_ID,
      expect.any(Array),
      TODAY,
    );
  });
});

// =====================================================================
// 3. family settings yesterday_today â†’ è®¡ç®—è¿‡æœŸä»»åŠ¡æ•°
// =====================================================================

describe('useExpiredTaskCount â€” yesterday_today window counts expired tasks', () => {
  it('returns count from service.summary.count (yesterday_today)', async () => {
    mockUseFamilyValue.mockReturnValue(makeFamilyValue());
    mockUseTasks.mockReturnValue([
      makeTask({ id: 't1', task_date: YESTERDAY }),
      makeTask({ id: 't2', task_date: YESTERDAY }),
      makeTask({ id: 't3', task_date: TODAY }), // ä¸ç®—è¿‡æœŸ
    ]);
    mockGetExpiredTasksSummary.mockResolvedValue({
      count: 2,
      tasks: [],
      window: 'yesterday_today',
    });

    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    await act(async () => {
      TestRenderer.create(React.createElement(HookHarness, { probeRef, today: TODAY }));
      await Promise.resolve();
    });

    const state = probeRef.current!.current!;
    expect(state.count).toBe(2);
    expect(state.loading).toBe(false);
    expect(mockGetExpiredTasksSummary).toHaveBeenCalledWith(
      FAMILY_ID,
      expect.arrayContaining([
        expect.objectContaining({ id: 't1' }),
        expect.objectContaining({ id: 't2' }),
        expect.objectContaining({ id: 't3' }),
      ]),
      TODAY,
    );
  });
});

// =====================================================================
// 4. tasks / today å˜åŒ–è§¦å‘é‡æ–°è®¡ç®—
// =====================================================================

describe('useExpiredTaskCount â€” re-computation triggers', () => {
  it('re-computes when tasks reference changes (Realtime push simulation)', async () => {
    mockUseFamilyValue.mockReturnValue(makeFamilyValue());

    // ç¬¬ 1 æ¬¡ render:tasks = [t1], count=1
    mockUseTasks.mockReturnValue([makeTask({ id: 't1' })]);
    mockGetExpiredTasksSummary.mockResolvedValueOnce({
      count: 1,
      tasks: [],
      window: 'yesterday_today',
    });

    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    let renderer: TestRenderer.ReactTestRenderer | null = null;

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(HookHarness, { probeRef, today: TODAY }),
      );
      await Promise.resolve();
    });

    expect(probeRef.current!.current!.count).toBe(1);

    // ç¬¬ 2 æ¬¡ render:tasks = [t1, t2](Realtime æŽ¨ t2)â€” æ–°å¼•ç”¨è§¦å‘é‡ç®—
    mockUseTasks.mockReturnValue([makeTask({ id: 't1' }), makeTask({ id: 't2' })]);
    mockGetExpiredTasksSummary.mockResolvedValueOnce({
      count: 2,
      tasks: [],
      window: 'yesterday_today',
    });

    await act(async () => {
      renderer!.update(
        React.createElement(HookHarness, { probeRef, today: TODAY }),
      );
      await Promise.resolve();
    });

    expect(probeRef.current!.current!.count).toBe(2);
    expect(mockGetExpiredTasksSummary).toHaveBeenCalledTimes(2);

    // æ¸…ç†
    renderer!.unmount();
  });

  it('re-computes when today changes (cross-day boundary)', async () => {
    mockUseFamilyValue.mockReturnValue(makeFamilyValue());
    mockGetExpiredTasksSummary.mockResolvedValue({
      count: 1,
      tasks: [],
      window: 'yesterday_today',
    });

    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    let renderer: TestRenderer.ReactTestRenderer | null = null;

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(HookHarness, { probeRef, today: TODAY }),
      );
      await Promise.resolve();
    });

    expect(mockGetExpiredTasksSummary).toHaveBeenLastCalledWith(
      FAMILY_ID,
      expect.any(Array),
      TODAY,
    );

    // today åˆ‡åˆ° next day
    await act(async () => {
      renderer!.update(
        React.createElement(HookHarness, { probeRef, today: '2026-09-24' }),
      );
      await Promise.resolve();
    });

    expect(mockGetExpiredTasksSummary).toHaveBeenLastCalledWith(
      FAMILY_ID,
      expect.any(Array),
      '2026-09-24',
    );

    renderer!.unmount();
  });
});

// =====================================================================
// 5. loading state + service throw å…œåº•
// =====================================================================

describe('useExpiredTaskCount â€” loading state & error defense', () => {
  it('starts with loading=true before first service call resolves', async () => {
    mockUseFamilyValue.mockReturnValue(makeFamilyValue());
    // ç”¨ resolve æŽ¨è¿Ÿ â€” è®© loading=true çŠ¶æ€å¯è§‚å¯Ÿ
    let resolveFn: (v: { count: number; tasks: unknown[]; window: 'yesterday_today' }) => void =
      () => undefined;
    mockGetExpiredTasksSummary.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );

    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(HookHarness, { probeRef, today: TODAY }),
      );
      // ä¸ await resolveFn â€” ä¿æŒ loading=true
    });

    expect(probeRef.current!.current!.loading).toBe(true);

    // é‡Šæ”¾ promise
    await act(async () => {
      resolveFn({ count: 3, tasks: [], window: 'yesterday_today' });
      await Promise.resolve();
    });

    expect(probeRef.current!.current!.loading).toBe(false);
    expect(probeRef.current!.current!.count).toBe(3);

    renderer!.unmount();
  });

  it('handles service throwing without breaking (defense)', async () => {
    mockUseFamilyValue.mockReturnValue(makeFamilyValue());
    mockGetExpiredTasksSummary.mockRejectedValueOnce(new Error('boom'));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    await act(async () => {
      TestRenderer.create(React.createElement(HookHarness, { probeRef, today: TODAY }));
      await Promise.resolve();
    });

    // å…œåº•:throw æ—¶ count=0, loading=false,ä¸æŠ›é”™
    expect(probeRef.current!.current!.count).toBe(0);
    expect(probeRef.current!.current!.loading).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns {count, loading} state with correct types (interface contract)', async () => {
    mockUseFamilyValue.mockReturnValue(null);

    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    await act(async () => {
      TestRenderer.create(React.createElement(HookHarness, { probeRef, today: TODAY }));
    });

    const state = probeRef.current!.current!;
    expect(typeof state.count).toBe('number');
    expect(typeof state.loading).toBe('boolean');
  });
});
