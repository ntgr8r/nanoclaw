#!/usr/bin/env python3
"""Conservative cache cleanup for common home-directory cache roots.

Dry-run by default:
    python3 Clean_Up.py

Apply deletions:
    python3 Clean_Up.py --apply

Optionally prune Docker-managed cache too:
    python3 Clean_Up.py --apply --docker-prune
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


HOME = Path.home().resolve()

TARGET_ROOTS = [
    HOME / ".cache",
    HOME / ".config",
    HOME / ".local",
    HOME / ".docker",
    HOME / ".npm",
]

CACHE_DIR_NAMES = {
    ".cache",
    "_cacache",
    "_logs",
    "_npx",
    "blob_storage",
    "cache",
    "caches",
    "cacheddata",
    "cachestorage",
    "code cache",
    "dawncache",
    "gpucache",
    "logs",
    "shadercache",
}

EXPLICIT_CACHE_DIRS = [
    HOME / ".npm" / "_cacache",
    HOME / ".npm" / "_logs",
    HOME / ".npm" / "_npx",
    HOME / ".local" / "share" / "pnpm" / "store",
    HOME / ".local" / "share" / "bun" / "install" / "cache",
    HOME / ".local" / "share" / "Trash" / "files",
    HOME / ".local" / "share" / "Trash" / "info",
]

PROTECTED_DIRS = {
    HOME,
    HOME / ".config",
    HOME / ".docker",
    HOME / ".local",
    HOME / ".local" / "bin",
    HOME / ".local" / "share",
    HOME / ".local" / "share" / "keyrings",
    HOME / ".config" / "git",
    HOME / ".config" / "gh",
    HOME / ".config" / "systemd",
    HOME / ".config" / "nanoclaw",
}

PROTECTED_FILES = {
    HOME / ".docker" / "config.json",
}


@dataclass(frozen=True)
class Candidate:
    path: Path
    reason: str


def is_under_home(path: Path) -> bool:
    try:
        path.resolve().relative_to(HOME)
        return True
    except ValueError:
        return False


def is_protected(path: Path) -> bool:
    resolved = path.resolve()
    if resolved in {p.resolve() for p in PROTECTED_FILES}:
        return True
    return any(resolved == p.resolve() for p in PROTECTED_DIRS)


def dir_size(path: Path) -> int:
    if path.is_symlink():
        return 0
    if path.is_file():
        try:
            return path.stat().st_size
        except OSError:
            return 0
    total = 0
    for root, dirs, files in os.walk(path, topdown=True, followlinks=False):
        root_path = Path(root)
        dirs[:] = [d for d in dirs if not (root_path / d).is_symlink()]
        for name in files:
            p = root_path / name
            if p.is_symlink():
                continue
            try:
                total += p.stat().st_size
            except OSError:
                pass
    return total


def human_size(num: int) -> str:
    units = ["B", "K", "M", "G", "T"]
    value = float(num)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f}{unit}" if unit != "B" else f"{int(value)}B"
        value /= 1024
    return f"{value:.1f}T"


def add_candidate(candidates: dict[Path, Candidate], path: Path, reason: str) -> None:
    if not path.exists():
        return
    if path.is_symlink():
        return
    resolved = path.resolve()
    if not is_under_home(resolved):
        return
    if is_protected(resolved):
        return
    candidates[resolved] = Candidate(resolved, reason)


def collect_candidates() -> list[Candidate]:
    candidates: dict[Path, Candidate] = {}

    cache_root = HOME / ".cache"
    if cache_root.exists() and cache_root.is_dir() and not cache_root.is_symlink():
        for child in cache_root.iterdir():
            add_candidate(candidates, child, "contents of ~/.cache")

    for path in EXPLICIT_CACHE_DIRS:
        add_candidate(candidates, path, "known package/tool cache")

    for root in [HOME / ".config", HOME / ".local", HOME / ".docker", HOME / ".npm"]:
        if not root.exists() or root.is_symlink():
            continue
        for current, dirs, _files in os.walk(root, topdown=True, followlinks=False):
            current_path = Path(current)
            if is_protected(current_path):
                dirs[:] = []
                continue
            kept_dirs: list[str] = []
            for dirname in dirs:
                path = current_path / dirname
                if path.is_symlink() or is_protected(path):
                    continue
                if dirname.lower() in CACHE_DIR_NAMES:
                    add_candidate(candidates, path, f"cache-like directory name: {dirname}")
                    continue
                kept_dirs.append(dirname)
            dirs[:] = kept_dirs

    # Remove nested candidates when their parent is already being removed.
    ordered = sorted(candidates.values(), key=lambda c: len(c.path.parts))
    kept: list[Candidate] = []
    kept_paths: list[Path] = []
    for candidate in ordered:
        if any(parent in candidate.path.parents for parent in kept_paths):
            continue
        kept.append(candidate)
        kept_paths.append(candidate.path)
    return kept


def delete_path(path: Path) -> None:
    if path.is_symlink():
        return
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()


def run_docker_prune(apply: bool) -> None:
    commands = [
        ["docker", "builder", "prune", "-af"],
        ["docker", "container", "prune", "-f"],
        ["docker", "image", "prune", "-af"],
        ["docker", "volume", "prune", "-f"],
    ]
    for command in commands:
        print("$ " + " ".join(command))
        if apply:
            subprocess.run(command, check=False)


def main() -> int:
    parser = argparse.ArgumentParser(description="Clean cache-like files from home cache roots.")
    parser.add_argument("--apply", action="store_true", help="actually delete files; default is dry-run")
    parser.add_argument("--docker-prune", action="store_true", help="also run Docker prune commands")
    args = parser.parse_args()

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"Mode: {mode}")
    print(f"Home: {HOME}")
    print()

    candidates = collect_candidates()
    total = 0
    for candidate in candidates:
        size = dir_size(candidate.path)
        total += size
        print(f"{human_size(size):>8}  {candidate.path}  [{candidate.reason}]")
        if args.apply:
            try:
                delete_path(candidate.path)
            except OSError as exc:
                print(f"  failed: {exc}")

    print()
    print(f"Candidate total: {human_size(total)}")
    if not args.apply:
        print("No files deleted. Re-run with --apply to delete these paths.")

    if args.docker_prune:
        print()
        print("Docker prune:")
        run_docker_prune(args.apply)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
