"""In-process memo cache for expensive AI / CV results.

The API analyses the same drone frame from several endpoints
(`/detect/buildings`, `/detect/features`, `/detect/parcels`,
`/detect/changes`), and the one-click frontend pipeline calls several of
them back to back. Every one of those re-decoded the file and re-ran the
same inference, so a single "full analysis" paid for YOLO inference and
the classical rooftop pass twice.

Inference here is deterministic for a given (file content, parameters,
loaded model), so results are cached under a content fingerprint — not a
path — because every endpoint stores its own timestamped copy of an upload.

The cache is tiny (default 8 entries), process-local and thread-safe.
Entries are deep-copied in and out so callers may freely mutate the
dicts/lists they receive.
"""

from __future__ import annotations

import copy
import hashlib
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List, Tuple

# A few concurrent uploads stay cached; anything older is dropped.
MAX_ENTRIES = 8

_lock = threading.Lock()
_cache: Dict[Tuple[Any, ...], Any] = {}
_order: List[Tuple[Any, ...]] = []
_hits = 0
_misses = 0

# Fingerprints are themselves cached per (path, mtime, size) so hashing a
# 100 MB frame four times in a row only reads it once.
_fp_lock = threading.Lock()
_fp_cache: Dict[Tuple[str, int, int], Tuple[int, str]] = {}


def file_fingerprint(path: str | Path) -> Tuple[int, str]:
    """Return ``(size_bytes, blake2b_digest)`` for a file, hashing it once.

    Two copies of the same upload share a fingerprint, which is what lets
    `/detect/buildings` and `/detect/features` reuse one inference result.
    """
    p = Path(path)
    st = p.stat()
    key = (str(p), st.st_mtime_ns, st.st_size)
    with _fp_lock:
        hit = _fp_cache.get(key)
    if hit is not None:
        return hit

    h = hashlib.blake2b(digest_size=16)
    size = 0
    with p.open("rb") as fh:
        while True:
            chunk = fh.read(1 << 20)
            if not chunk:
                break
            size += len(chunk)
            h.update(chunk)
    value = (size, h.hexdigest())

    with _fp_lock:
        if len(_fp_cache) > 64:  # bound memory; fingerprints are tiny
            _fp_cache.clear()
        _fp_cache[key] = value
    return value


def cached(
    key: Tuple[Any, ...],
    factory: Callable[[], Any],
) -> Tuple[Any, bool]:
    """Return ``(value, cache_hit)`` for ``key``, calling ``factory()`` on a miss.

    ``factory`` runs outside the lock so slow inference never blocks other
    requests. If two requests miss simultaneously, the first result to be
    stored wins and the other caller receives that copy.
    """
    global _hits, _misses

    with _lock:
        if key in _cache:
            try:
                _order.remove(key)
            except ValueError:
                pass
            _order.append(key)
            _hits += 1
            return copy.deepcopy(_cache[key]), True

    value = factory()

    with _lock:
        _misses += 1
        if key in _cache:  # lost a race — keep the stored result
            try:
                _order.remove(key)
            except ValueError:
                pass
            _order.append(key)
            return copy.deepcopy(_cache[key]), True
        _cache[key] = copy.deepcopy(value)
        _order.append(key)
        while len(_order) > MAX_ENTRIES:
            _cache.pop(_order.pop(0), None)
    return value, False


def invalidate() -> int:
    """Drop every cached result (used when models change). Returns entries removed."""
    global _order
    with _lock:
        removed = len(_cache)
        _cache.clear()
        _order = []
        return removed


def stats() -> Dict[str, Any]:
    """Hit/miss counters, exposed by the API for verification."""
    with _lock:
        total = _hits + _misses
        return {
            "entries": len(_cache),
            "max_entries": MAX_ENTRIES,
            "hits": _hits,
            "misses": _misses,
            "hit_rate": round(_hits / total, 4) if total else 0.0,
        }
