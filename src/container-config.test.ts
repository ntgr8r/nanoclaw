/**
 * idle_timeout_ms threading — migration 016 column → `ContainerConfigRow` →
 * `configFromDb()` → `materializeContainerJson()` → `container.json`.
 *
 * The default leg is load-bearing: a NULL column must keep `idleTimeoutMs`
 * out of container.json entirely, so groups that never set the value get
 * today's behavior byte-identical (the container-side loadConfig then
 * defaults to 0 = idle exit disabled).
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./config.js', async () => {
  const actual = await vi.importActual('./config.js');
  return { ...actual, GROUPS_DIR: '/tmp/nanoclaw-test-container-config/groups' };
});

const TEST_DIR = '/tmp/nanoclaw-test-container-config';
const GROUPS_DIR = path.join(TEST_DIR, 'groups');

import { initTestDb, closeDb, runMigrations } from './db/index.js';
import { createAgentGroup, getAgentGroup } from './db/agent-groups.js';
import { ensureContainerConfig, getContainerConfig, updateContainerConfigScalars } from './db/container-configs.js';
import { configFromDb, materializeContainerJson } from './container-config.js';

const GID = 'ag-idle';

function now(): string {
  return new Date().toISOString();
}

describe('container config idle_timeout_ms threading', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(GROUPS_DIR, { recursive: true });

    const db = initTestDb();
    runMigrations(db);

    createAgentGroup({ id: GID, name: 'idle-group', folder: 'idle-group', agent_provider: null, created_at: now() });
    ensureContainerConfig(GID);
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  });

  it('updateContainerConfigScalars persists idle_timeout_ms and configFromDb threads it', () => {
    updateContainerConfigScalars(GID, { idle_timeout_ms: 300000 });

    const row = getContainerConfig(GID)!;
    expect(row.idle_timeout_ms).toBe(300000);

    const config = configFromDb(row, getAgentGroup(GID)!);
    expect(config.idleTimeoutMs).toBe(300000);
  });

  it('materializeContainerJson writes idleTimeoutMs into container.json', () => {
    updateContainerConfigScalars(GID, { idle_timeout_ms: 300000 });

    const config = materializeContainerJson(GID);
    expect(config.idleTimeoutMs).toBe(300000);

    const written = JSON.parse(fs.readFileSync(path.join(GROUPS_DIR, 'idle-group', 'container.json'), 'utf8'));
    expect(written.idleTimeoutMs).toBe(300000);
  });

  it('NULL column (the default) keeps idleTimeoutMs out of container.json — feature off', () => {
    const row = getContainerConfig(GID)!;
    expect(row.idle_timeout_ms).toBeNull();

    const config = configFromDb(row, getAgentGroup(GID)!);
    expect(config.idleTimeoutMs).toBeUndefined();

    materializeContainerJson(GID);
    const written = JSON.parse(fs.readFileSync(path.join(GROUPS_DIR, 'idle-group', 'container.json'), 'utf8'));
    // JSON.stringify drops undefined — the key must be absent, not null/0.
    expect('idleTimeoutMs' in written).toBe(false);
  });
});
