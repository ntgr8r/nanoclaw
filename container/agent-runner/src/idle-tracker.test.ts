/**
 * Idle-timeout guard — the machinery that lets ephemeral sessions exit
 * cleanly instead of riding until host-sweep's absolute ceiling.
 *
 * Behavior leg: the idle tracker with an injected clock (markActivity /
 * shouldExit semantics, including the hasProcessedAtLeastOne gate and the
 * idleTimeoutMs <= 0 disable).
 *
 * AST legs (runPollLoop is an infinite loop — not invocable in a test):
 *   - runPollLoop destructures idleTimeoutMs from loadConfig() (the
 *     destructure may carry other keys; this only pins idleTimeoutMs);
 *   - the empty-poll branch exits via process.exit(0) gated on
 *     idle.shouldExit();
 *   - idle.markActivity() runs after the batch-completion
 *     markCompleted(processingIds) so the idle window restarts per batch;
 *   - the processQuery call site threads idleTimeoutMs as the 5th argument;
 *   - the 'result' event arm calls query.end() gated on
 *     `idleTimeoutMs > 0 && !hasUnwrapped` — never unconditionally, or the
 *     unwrapped-output re-send nudge would be cut off mid-stream;
 *   - loadConfig()'s returned literal carries the idleTimeoutMs field
 *     (RunnerConfig's type is covered by the typecheck leg).
 */
import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import { createIdleTracker } from './idle-tracker.js';

describe('idle tracker behavior', () => {
  it('never exits before the first processed batch, regardless of elapsed time', () => {
    let clock = 0;
    const tracker = createIdleTracker(1000, () => clock);
    clock = 1_000_000;
    expect(tracker.shouldExit()).toBe(false);
  });

  it('exits only after the idle window elapses past the last activity', () => {
    let clock = 0;
    const tracker = createIdleTracker(1000, () => clock);

    tracker.markActivity(); // first batch completes at t=0
    clock = 900;
    expect(tracker.shouldExit()).toBe(false);
    clock = 1001;
    expect(tracker.shouldExit()).toBe(true);

    // New activity re-arms the window.
    tracker.markActivity();
    clock = 1900;
    expect(tracker.shouldExit()).toBe(false);
    clock = 2002;
    expect(tracker.shouldExit()).toBe(true);
  });

  it('idleTimeoutMs <= 0 disables idle exit entirely', () => {
    let clock = 0;
    const tracker = createIdleTracker(0, () => clock);
    tracker.markActivity();
    clock = 10_000_000;
    expect(tracker.shouldExit()).toBe(false);
  });
});

// ── AST legs ──

function parse(file: string): ts.SourceFile {
  const source = fs.readFileSync(path.join(import.meta.dir, file), 'utf8');
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
}

function findAll<T extends ts.Node>(root: ts.Node, pred: (n: ts.Node) => n is T): T[] {
  const out: T[] = [];
  const visit = (n: ts.Node): void => {
    if (pred(n)) out.push(n);
    n.forEachChild(visit);
  };
  visit(root);
  return out;
}

function hasAncestor(node: ts.Node, pred: (n: ts.Node) => boolean): boolean {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (pred(cur)) return true;
    cur = cur.parent;
  }
  return false;
}

describe('poll-loop.ts idle wiring', () => {
  const sf = parse('poll-loop.ts');
  const runPollLoop = findAll(sf, ts.isFunctionDeclaration).find((f) => f.name?.text === 'runPollLoop');

  it('destructures idleTimeoutMs from loadConfig()', () => {
    const decls = findAll(runPollLoop!, ts.isVariableDeclaration).filter(
      (d) =>
        d.initializer !== undefined &&
        ts.isCallExpression(d.initializer) &&
        ts.isIdentifier(d.initializer.expression) &&
        d.initializer.expression.text === 'loadConfig' &&
        ts.isObjectBindingPattern(d.name),
    );
    expect(decls.length).toBeGreaterThanOrEqual(1);
    const hasKey = decls.some((d) =>
      (d.name as ts.ObjectBindingPattern).elements.some(
        (e) => ts.isIdentifier(e.name) && e.name.text === 'idleTimeoutMs',
      ),
    );
    expect(hasKey).toBe(true);
  });

  it('the empty-poll branch exits 0 gated on idle.shouldExit()', () => {
    const exits = findAll(runPollLoop!, ts.isCallExpression).filter(
      (c) =>
        ts.isPropertyAccessExpression(c.expression) &&
        c.expression.getText(sf) === 'process.exit' &&
        c.arguments[0]?.getText(sf) === '0',
    );
    const gated = exits.filter((c) =>
      hasAncestor(
        c,
        (n) => ts.isIfStatement(n) && n.expression.getText(sf).replace(/\s+/g, '') === 'idle.shouldExit()',
      ),
    );
    expect(gated.length).toBe(1);
    // And the gate itself sits inside the messages.length === 0 branch.
    expect(
      hasAncestor(gated[0], (n) => ts.isIfStatement(n) && n.expression.getText(sf).includes('messages.length === 0')),
    ).toBe(true);
  });

  it('marks activity after markCompleted so the idle window restarts per batch', () => {
    const marks = findAll(runPollLoop!, ts.isCallExpression).filter(
      (c) => c.expression.getText(sf).replace(/\s+/g, '') === 'idle.markActivity',
    );
    expect(marks.length).toBe(1);
    // The batch-completion call is markCompleted(processingIds) — the others
    // handle command/skip bookkeeping and must not arm the idle window.
    const completed = findAll(runPollLoop!, ts.isCallExpression).filter(
      (c) =>
        ts.isIdentifier(c.expression) &&
        c.expression.text === 'markCompleted' &&
        c.arguments[0]?.getText(sf) === 'processingIds',
    );
    expect(completed.length).toBe(1);
    expect(marks[0].getStart(sf)).toBeGreaterThan(completed[0].getStart(sf));
  });

  it("threads idleTimeoutMs as processQuery's 5th argument", () => {
    const calls = findAll(runPollLoop!, ts.isCallExpression).filter(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === 'processQuery',
    );
    expect(calls.length).toBe(1);
    expect(calls[0].arguments.length).toBe(5);
    expect(calls[0].arguments[4].getText(sf)).toBe('idleTimeoutMs');
  });

  it("the 'result' event arm ends the stream gated on idleTimeoutMs > 0 && !hasUnwrapped", () => {
    const processQuery = findAll(sf, ts.isFunctionDeclaration).find((f) => f.name?.text === 'processQuery');
    expect(processQuery).toBeDefined();
    const ends = findAll(processQuery!, ts.isCallExpression).filter(
      (c) => c.expression.getText(sf).replace(/\s+/g, '') === 'query.end',
    );
    // The !hasUnwrapped half of the gate is load-bearing: an unconditional
    // (or idleTimeoutMs-only) end would close the stream right after the
    // unwrapped-output nudge was pushed, stranding the re-sent response.
    const gated = ends.filter((c) =>
      hasAncestor(
        c,
        (n) =>
          ts.isIfStatement(n) && n.expression.getText(sf).replace(/\s+/g, '') === 'idleTimeoutMs>0&&!hasUnwrapped',
      ),
    );
    expect(gated.length).toBe(1);
  });
});

describe('config.ts idle wiring', () => {
  const sf = parse('config.ts');

  it('loadConfig returns an idleTimeoutMs field', () => {
    const loadConfig = findAll(sf, ts.isFunctionDeclaration).find((f) => f.name?.text === 'loadConfig');
    expect(loadConfig).toBeDefined();
    const props = findAll(loadConfig!, ts.isPropertyAssignment).filter(
      (p) => ts.isIdentifier(p.name) && p.name.text === 'idleTimeoutMs',
    );
    expect(props.length).toBe(1);
    // Reads the raw container.json key with a 0 default (0 = disabled).
    expect(props[0].initializer.getText(sf).replace(/\s+/g, '')).toContain('raw.idleTimeoutMs');
  });
});
