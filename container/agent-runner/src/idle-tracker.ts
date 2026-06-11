/**
 * Idle-exit tracker for ephemeral sessions.
 *
 * The poll loop creates one tracker per run and makes two one-line calls:
 *
 *   - `markActivity()` after a batch completes — records the last time the
 *     agent did real work and arms the tracker (an agent that never processed
 *     anything must not idle-exit before its first trigger arrives).
 *   - `shouldExit()` in the empty-poll branch — true once idleTimeoutMs > 0,
 *     at least one batch has been processed, and the idle window has elapsed.
 *
 * `idleTimeoutMs` comes from the group's container.json (RunnerConfig),
 * materialized from the `container_configs.idle_timeout_ms` column. A value
 * of 0 (the default) disables idle exit entirely — the container then rides
 * until host-sweep's absolute ceiling, exactly as before this tracker existed.
 */

export interface IdleTracker {
  /** Record activity: arms the tracker and resets the idle window. */
  markActivity(): void;
  /** True when the session has been idle past the timeout and may exit 0. */
  shouldExit(): boolean;
}

export function createIdleTracker(idleTimeoutMs: number, now: () => number = Date.now): IdleTracker {
  let lastActivityAt = now();
  let hasProcessedAtLeastOne = false;

  return {
    markActivity(): void {
      lastActivityAt = now();
      hasProcessedAtLeastOne = true;
    },
    shouldExit(): boolean {
      if (idleTimeoutMs <= 0) return false;
      if (!hasProcessedAtLeastOne) return false;
      return now() - lastActivityAt > idleTimeoutMs;
    },
  };
}
