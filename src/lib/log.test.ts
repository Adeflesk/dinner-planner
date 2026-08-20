import { afterEach, describe, expect, it, vi } from 'vitest';
import { logEvent, logWarn } from './log';

afterEach(() => vi.restoreAllMocks());

describe('logEvent', () => {
  it('writes one line of JSON to stdout with the event name first', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logEvent('plan.summary', { filled: 5, gaps: 2 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toEqual({
      evt: 'plan.summary', filled: 5, gaps: 2,
    });
  });
  it('works with no fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logEvent('plan.started');
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toEqual({ evt: 'plan.started' });
  });
});

describe('logWarn', () => {
  it('writes to stderr, not stdout', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    logWarn('recipe.timeout', { cuisine: 'thai', attempt: 0 });
    expect(log).not.toHaveBeenCalled();
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toEqual({
      evt: 'recipe.timeout', cuisine: 'thai', attempt: 0,
    });
  });
  it('never throws on a value JSON cannot serialise', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logWarn('recipe.ai_error', circular)).not.toThrow();
  });
});
