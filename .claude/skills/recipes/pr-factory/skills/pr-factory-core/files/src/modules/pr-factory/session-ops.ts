/**
 * Session operations exposed to the supervisor via MCP tools.
 *
 * Both functions are keyed by (repo, pr_number) — the natural identifiers
 * visible in every worker message. Internally they look up the PR via the
 * pr_threads table and operate on the worker's per-thread session.
 */
import { getPrThreadByRepoPr, deletePrThread } from '../../db/pr-threads.js';
import { getSession, deleteSession } from '../../db/sessions.js';
import { killContainer } from '../../container-runner.js';
import { log } from '../../log.js';
import { prLog } from './activity-log.js';

import { rebootstrapPrSession } from './handler.js';

export interface SessionOpResult {
  ok: boolean;
  message: string;
}

/**
 * Wipe the worker's per-thread session for a PR. Kills the running
 * container, deletes the session row, and removes the pr_threads index
 * entry so a future retrigger re-bootstraps cleanly.
 */
export function clearWorkerSession(repo: string, prNumber: number): SessionOpResult {
  const pr = getPrThreadByRepoPr(repo, prNumber);
  if (!pr) return { ok: false, message: `No PR thread for ${repo}#${prNumber}` };

  const session = getSession(pr.session_id);
  if (session) {
    killContainer(session.id, 'cleared by supervisor');
    deleteSession(session.id);
  }
  deletePrThread(pr.channel_id, pr.thread_ts);
  prLog(prNumber, repo, 'session_cleared', { sessionId: pr.session_id });
  log.info('Worker session cleared', { repo, prNumber, sessionId: pr.session_id });
  return { ok: true, message: `Cleared session for PR #${prNumber} (${repo})` };
}

/**
 * Re-trigger PR triage with a freshly fetched diff. Keeps the same Slack
 * thread + session id; the worker re-runs its triage workflow against the
 * latest GitHub state.
 */
export async function retriggerWorker(repo: string, prNumber: number): Promise<SessionOpResult> {
  const pr = getPrThreadByRepoPr(repo, prNumber);
  if (!pr) return { ok: false, message: `No PR thread for ${repo}#${prNumber}` };

  const session = getSession(pr.session_id);
  if (!session) {
    return { ok: false, message: `Session ${pr.session_id} for PR #${prNumber} not found` };
  }

  killContainer(session.id, 'retriggered by supervisor');
  await rebootstrapPrSession(pr.channel_id, pr.thread_ts, session.agent_group_id, repo, prNumber);
  prLog(prNumber, repo, 'session_retriggered', { sessionId: pr.session_id });
  log.info('Worker session retriggered', { repo, prNumber, sessionId: pr.session_id });
  return { ok: true, message: `Retriggered PR #${prNumber} (${repo})` };
}
