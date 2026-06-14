# Cleanup Plan

Goal: reclaim disk space from cache-like data under:

- `~/.cache`
- `~/.config`
- `~/.local`
- `~/.docker`
- `~/.npm`

The cleanup should remove generated caches and logs while preserving configuration, credentials, project files, and application state.

## Safety Rules

- Default to dry-run. No files are deleted unless `--apply` is passed.
- Never follow symlinks.
- Never delete the top-level roots themselves.
- Never delete known credential/config files such as `.env`, Docker auth config, SSH/Git/GPG files, or application settings.
- Prefer deleting directories named like caches: `cache`, `Cache`, `Code Cache`, `GPUCache`, `DawnCache`, `ShaderCache`, `CachedData`, `CacheStorage`, `_cacache`, `_npx`, `_logs`.
- Treat `~/.config` and `~/.local` conservatively because they often contain real settings and installed binaries, not just caches.

## Recommended Commands

Preview what would be deleted:

```bash
python3 Clean_Up.py
```

Apply filesystem cleanup:

```bash
python3 Clean_Up.py --apply
```

Also prune Docker build/container/image cache:

```bash
python3 Clean_Up.py --apply --docker-prune
```

Measure before/after:

```bash
du -sh ~/.cache ~/.config ~/.local ~/.docker ~/.npm 2>/dev/null
```

## What The Script Removes

- Contents of `~/.cache`
- npm cache/log/temp directories under `~/.npm`
- cache/log directories found under `~/.config`, `~/.local`, and `~/.docker`
- common local package/tool caches, when present:
  - `~/.local/share/pnpm/store`
  - `~/.local/share/bun/install/cache`
  - `~/.local/share/Trash/files`
  - `~/.local/share/Trash/info`

## What The Script Avoids

- `~/.docker/config.json`
- `~/.config/git`, `~/.config/gh`, `~/.config/systemd`, `~/.config/nanoclaw`
- `~/.local/bin`
- `~/.local/share/keyrings`
- Any symlink target

## Notes

- Browser and desktop apps may recreate cache folders after launch.
- Docker’s largest usage is often outside `~/.docker`; use `--docker-prune` for Docker-managed cache and stopped containers.
- If a file is in use, the script reports the failure and continues.

## Current Observation

On this machine, `du` showed the largest requested directories are:

- `~/.config/Code` around 3.2G
- `~/.docker/desktop` around 3.0G
- `~/.config/google-chrome` around 2.0G
- `~/.local/share` around 4.0G

Those are not automatically deleted because they can contain application state, installed extensions, browser profiles, Docker Desktop VM state, and other non-cache data.

The script dry-run found about 247M of clearly cache-like filesystem paths. Separately, `docker system df` showed Docker build cache around 9.3G with about 7.8G reclaimable, so `--docker-prune` is the high-impact cleanup path.
