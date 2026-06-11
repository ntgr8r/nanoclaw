# Remove the PR Factory (recipe)

Reverse apply order. Each component's REMOVE.md reverses everything that component installed (files, barrel lines, dependencies, env keys); follow them in this order, skipping components that were never applied:

1. `skills/slack-canvas/REMOVE.md`
2. `skills/vm-test-orchestrator/REMOVE.md`
3. `skills/gh-action-approval/REMOVE.md`
4. `skills/pr-factory-core/REMOVE.md`
5. `skills/slack-bots/REMOVE.md`
6. `/add-slack`'s removal steps, only if the worker Slack channel itself is being removed.

Then delete the recipe-owned files:

```bash
rm -f docs/pr-factory.md
rm -f src/recipe-pr-factory-stack.test.ts
```

Leave `scripts/sync-skill-files.sh` and `src/skill-sync.test.ts` in place if any other skill in the install uses a `files.txt` manifest; if this recipe was the only consumer, remove them too:

```bash
rm -f scripts/sync-skill-files.sh src/skill-sync.test.ts
```

Operator data is not deleted by any of the above — `data/gh-users.json`, `data/pr-activity/`, the repo mirror dir, `groups/pr-factory-worker/`, `groups/pr-factory-supervisor/`, and `groups/pr-tester/` are yours to keep or remove. The `pr_threads` table and the recorded component migrations stay in the central DB (migrations are forward-only); they are inert without the module.

Validate: `pnpm run build && pnpm test` — both green.
