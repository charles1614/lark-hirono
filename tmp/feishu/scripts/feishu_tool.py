#!/usr/bin/env python3
"""Standalone Feishu wiki tool for Claude Code skills.

Self-contained script for all Feishu wiki operations.
Only requires: requests, python-dotenv, and a .env file with credentials.

Usage:
    python feishu_tool.py read   URL [--no-title]
    python feishu_tool.py diff   LEFT_URL RIGHT_URL [--no-title] [--context N] [--normalize]
    python feishu_tool.py write  PARENT_URL [--title TITLE]
    python feishu_tool.py copy   SOURCE_URL TARGET_URL [-r] [-n] [--fix-refs] [--title T]
    python feishu_tool.py sync   SOURCE_URL TARGET_URL [-n] [--no-fix-refs] [--title T]
    python feishu_tool.py export SOURCE_URL [-o DIR]
    python feishu_tool.py info   URL
"""

from __future__ import annotations

import argparse
import copy as _copy
import concurrent.futures
import difflib
import hashlib
import io
import json
import logging
import os
import re
import sys
import time
import urllib.parse
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
except ImportError:
    print("Missing dependency: pip install requests", file=sys.stderr)
    raise SystemExit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    print("Missing dependency: pip install python-dotenv", file=sys.stderr)
    raise SystemExit(1)

log = logging.getLogger("feishu_tool")


@dataclass
class WriteResult:
    """Structured result returned by write_blocks_to_doc()."""
    blocks_created: int = 0
    blocks_failed: int = 0
    bg_patches_ok: int = 0
    bg_patches_failed: int = 0
    table_patches_ok: int = 0
    table_patches_failed: int = 0
    images_uploaded: int = 0
    images_failed: int = 0
    cleanup_deleted: int = 0


@dataclass
class MarkdownNormalizationReport:
    metadata_blocks_removed: int = 0
    table_separator_rows_normalized: int = 0
    warnings: list[str] = field(default_factory=list)


# ── Config ────────────────────────────────────────────────────────────────────

BASE_URL = "https://open.feishu.cn"
REDIRECT_URI = "http://localhost:7777/callback"

_CONFIG_DIR = os.path.join(Path.home(), ".config", "feishu_tools")
TOKEN_CACHE = os.path.join(_CONFIG_DIR, "token_cache.json")

_LOG_DIR = os.path.join(Path.home(), "log", "feishu_tools", "sync_logs")

# ── HTTP helpers ──────────────────────────────────────────────────────────────

_TIMEOUT = 60
_MAX_RETRIES = 8
_RATE_LIMIT_CODES = {99991400, 99991429}
_WRITE_RETRIES = 6
_WRITE_BATCH_SIZE = 5
_WRITE_BATCH_DELAY = 1.0
_WRITE_QUEUE_DELAY = 0.5
_WRITE_PATCH_DELAY = 0.5
_CREATE_CHILDREN_TIMEOUT = 90
_FINALIZE_RETRIES = 6


def api_request(method: str, url: str, **kwargs) -> requests.Response:
    kwargs.setdefault("timeout", _TIMEOUT)
    backoff = 1
    for attempt in range(_MAX_RETRIES):
        try:
            files = kwargs.get("files")
            if isinstance(files, dict):
                for value in files.values():
                    if isinstance(value, tuple) and len(value) >= 2:
                        stream = value[1]
                        if hasattr(stream, "seek"):
                            stream.seek(0)
            resp = requests.request(method, url, **kwargs)
        except (requests.ConnectionError, requests.Timeout) as exc:
            if attempt < _MAX_RETRIES - 1:
                log.warning("Request failed (%s), retrying in %ds …", exc, backoff)
                time.sleep(backoff)
                backoff = min(backoff * 2, 60)
                continue
            raise
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", backoff))
            log.warning("Rate limited (HTTP 429), retrying in %ds …", retry_after)
            time.sleep(retry_after)
            backoff = min(backoff * 2, 60)
            continue
        try:
            data = resp.json()
            if data.get("code") in _RATE_LIMIT_CODES:
                log.warning("Rate limited (code=%d), retrying in %ds …", data["code"], backoff)
                time.sleep(backoff)
                backoff = min(backoff * 2, 60)
                continue
        except ValueError:
            pass
        return resp
    return resp


def _is_retryable_write_error(exc: Exception) -> bool:
    if isinstance(exc, (requests.ConnectionError, requests.Timeout)):
        return True
    msg = str(exc).lower()
    return any(token in msg for token in (
        "timed out",
        "timeout",
        "connection aborted",
        "connection reset",
        "temporarily unavailable",
        "rate limited",
        "429",
        "max retries exceeded",
    ))


_RAW_METADATA_LINE_RE = re.compile(
    r"^\s*\*\*(作者|机构|发表|发表/预印|分析日期)\*\*:\s*.*$"
)
_TABLE_METADATA_LABEL_RE = re.compile(
    r"\|\s*\*\*(作者|机构|发表|发表/预印|分析日期)\*\*\s*\|"
)
_UNICODE_DASH_CELL_RE = re.compile(r"[—–]+")


def _normalize_table_separator_row(line: str) -> str:
    stripped = line.strip()
    if not stripped.startswith("|"):
        return line
    cells = [c.strip() for c in stripped.strip("|").split("|")]
    if not cells:
        return line
    if not all(c and _UNICODE_DASH_CELL_RE.fullmatch(c) for c in cells):
        return line
    return "|" + "|".join("-" * max(3, len(c)) for c in cells) + "|"


def _remove_duplicate_loose_metadata_block(md_text: str, report: MarkdownNormalizationReport) -> str:
    lines = md_text.splitlines()
    has_metadata_table = any(_TABLE_METADATA_LABEL_RE.search(ln) for ln in lines)
    if not has_metadata_table:
        return md_text

    # Remove a loose metadata paragraph block near the top if a structured metadata
    # table already exists later. This prevents duplicated author/venue display.
    start = None
    end = None
    for i, line in enumerate(lines[:80]):
        if _RAW_METADATA_LINE_RE.match(line):
            start = i
            j = i
            while j < len(lines):
                cur = lines[j]
                if _RAW_METADATA_LINE_RE.match(cur) or not cur.strip():
                    j += 1
                    continue
                break
            end = j
            break

    if start is not None and end is not None:
        lines = lines[:start] + lines[end:]
        report.metadata_blocks_removed += 1
        # Collapse leading extra blank lines after removal.
        while len(lines) >= 2 and not lines[0].strip() and not lines[1].strip():
            lines.pop(0)
    return "\n".join(lines) + ("\n" if md_text.endswith("\n") else "")


def _normalize_markdown_tables(md_text: str, report: MarkdownNormalizationReport) -> str:
    lines = md_text.splitlines()
    out: list[str] = []
    for line in lines:
        norm = _normalize_table_separator_row(line)
        if norm != line:
            report.table_separator_rows_normalized += 1
        out.append(norm)
    return "\n".join(out) + ("\n" if md_text.endswith("\n") else "")


def _lint_markdown_for_feishu(md_text: str, report: MarkdownNormalizationReport) -> None:
    red_count = md_text.count("{red:") + md_text.count("{red:**")
    green_count = md_text.count("{green:") + md_text.count("{green:**")
    if green_count and red_count > green_count * 6:
        report.warnings.append(
            f"red/green balance is skewed ({red_count} red vs {green_count} green)"
        )
    if "{yellow:" not in md_text and ("限制" in md_text or "局限" in md_text or "caveat" in md_text.lower()):
        report.warnings.append("document discusses limitations/tradeoffs but has no yellow highlights")

    formula_in_quoted_context = re.search(
        r"(?m)^(?:>\s.*(?:\$\$|\$[^$\n]+\$).*|\|>\s.*(?:\$\$|\$[^$\n]+\$).*)$",
        md_text,
    )
    if formula_in_quoted_context:
        report.warnings.append(
            "inline/display LaTeX inside blockquote/callout/quote container may render poorly in Feishu; "
            "move formula-bearing summaries or insights to a normal numbered subsection or plain paragraph"
        )


def normalize_markdown_for_feishu(md_text: str) -> tuple[str, MarkdownNormalizationReport]:
    report = MarkdownNormalizationReport()
    normalized = md_text
    normalized = _remove_duplicate_loose_metadata_block(normalized, report)
    normalized = _normalize_markdown_tables(normalized, report)
    _lint_markdown_for_feishu(normalized, report)
    return normalized, report


# ── Auth ──────────────────────────────────────────────────────────────────────


def _load_token_cache() -> dict:
    if os.path.exists(TOKEN_CACHE):
        with open(TOKEN_CACHE) as f:
            return json.load(f)
    return {}


def _save_token_cache(data: dict) -> None:
    os.makedirs(os.path.dirname(TOKEN_CACHE), exist_ok=True)
    fd = os.open(TOKEN_CACHE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2)


def _get_app_access_token(app_id: str, app_secret: str) -> str:
    resp = api_request(
        "POST", f"{BASE_URL}/open-apis/auth/v3/app_access_token/internal",
        json={"app_id": app_id, "app_secret": app_secret},
    )
    data = resp.json()
    if data.get("code") != 0:
        raise Exception(f"Failed to get app token: {data}")
    return data["app_access_token"]


def _refresh_user_token(app_token: str, refresh_token: str) -> tuple:
    resp = api_request(
        "POST", f"{BASE_URL}/open-apis/authen/v1/refresh_access_token",
        json={
            "app_access_token": app_token,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        },
    )
    data = resp.json()
    if data.get("code") != 0:
        return None, None, None
    d = data["data"]
    return d["access_token"], d.get("expires_in", 7200), d.get("refresh_token")


def _get_user_token_by_code(app_token: str, code: str) -> tuple:
    resp = api_request(
        "POST", f"{BASE_URL}/open-apis/authen/v1/access_token",
        json={
            "app_access_token": app_token,
            "code": code,
            "grant_type": "authorization_code",
        },
    )
    data = resp.json()
    if data.get("code") != 0:
        raise Exception(f"Failed to get user token: {data}")
    d = data["data"]
    return d["access_token"], d.get("expires_in", 7200), d.get("refresh_token")


def get_valid_user_token(app_id: str, app_secret: str) -> str:
    """Get a valid user access token, refreshing or re-authenticating as needed."""
    cache = _load_token_cache()
    app_token = _get_app_access_token(app_id, app_secret)

    # Try cached access token
    if cache.get("access_token") and cache.get("expires_at", 0) > time.time() + 60:
        return cache["access_token"]

    # Try refresh token
    if cache.get("refresh_token"):
        at, expires_in, rt = _refresh_user_token(app_token, cache["refresh_token"])
        if at:
            _save_token_cache({
                "access_token": at,
                "refresh_token": rt or cache["refresh_token"],
                "expires_at": time.time() + (expires_in or 7200),
            })
            return at

    # Full OAuth login
    auth_url = (
        f"{BASE_URL}/open-apis/authen/v1/authorize"
        f"?app_id={app_id}&redirect_uri={urllib.parse.quote(REDIRECT_URI)}"
        f"&scope=wiki:wiki docx:document drive:drive"
    )
    print(f"\nOpen this URL to authorize:\n{auth_url}\n", file=sys.stderr)
    print("After login, copy the 'code' parameter from the callback URL.", file=sys.stderr)
    code = input("Paste the code here: ").strip()

    at, expires_in, rt = _get_user_token_by_code(app_token, code)
    _save_token_cache({
        "access_token": at,
        "refresh_token": rt,
        "expires_at": time.time() + (expires_in or 7200),
    })
    return at


class TokenManager:
    """Wraps user token with automatic refresh before expiry."""

    def __init__(self, app_id: str, app_secret: str) -> None:
        self._app_id = app_id
        self._app_secret = app_secret
        self._token: str | None = None
        self._expires_at: float = 0

    def get(self) -> str:
        """Return a valid user token, refreshing if needed."""
        if self._token and time.time() < self._expires_at - 300:
            return self._token
        self._token = get_valid_user_token(self._app_id, self._app_secret)
        self._expires_at = time.time() + 7200
        return self._token

    def invalidate(self) -> None:
        """Force token refresh on next get() call."""
        self._token = None


# ── Wiki API ──────────────────────────────────────────────────────────────────


def parse_node_token(url_or_token: str) -> str:
    m = re.search(r"/wiki/([A-Za-z0-9]+)", url_or_token)
    if m:
        return m.group(1)
    return url_or_token.strip().split("/")[-1].split("?")[0]


def get_wiki_node(user_token: str, node_token: str) -> dict:
    resp = api_request(
        "GET", f"{BASE_URL}/open-apis/wiki/v2/spaces/get_node",
        headers={"Authorization": f"Bearer {user_token}"},
        params={"token": node_token},
    )
    data = resp.json()
    if data.get("code") != 0:
        raise Exception(f"Failed to get wiki node: {data}")
    return data["data"]["node"]


def get_all_blocks(user_token: str, document_id: str) -> list[dict]:
    blocks: list[dict] = []
    page_token = None
    while True:
        params: dict = {"page_size": 500}
        if page_token:
            params["page_token"] = page_token
        resp = api_request(
            "GET", f"{BASE_URL}/open-apis/docx/v1/documents/{document_id}/blocks",
            headers={"Authorization": f"Bearer {user_token}"},
            params=params,
        )
        data = resp.json()
        if data.get("code") != 0:
            raise Exception(f"Failed to get blocks: {data}")
        blocks.extend(data["data"]["items"])
        if not data["data"].get("has_more"):
            break
        page_token = data["data"].get("page_token")
    return blocks


def create_wiki_node(
    user_token: str, space_id: str, parent_node_token: str, title: str,
) -> tuple[str, str]:
    resp = api_request(
        "POST", f"{BASE_URL}/open-apis/wiki/v2/spaces/{space_id}/nodes",
        headers={"Authorization": f"Bearer {user_token}"},
        json={
            "obj_type": "docx",
            "parent_node_token": parent_node_token,
            "node_type": "origin",
            "title": title,
        },
    )
    data = resp.json()
    if data.get("code") != 0:
        raise Exception(f"Create wiki node failed: {data}")
    node = data["data"]["node"]
    return node["node_token"], node["obj_token"]


def create_children(
    user_token: str, doc_id: str, parent_id: str, blocks: list[dict], index: int = 0,
) -> list[dict]:
    if not blocks:
        return []
    resp = api_request(
        "POST", f"{BASE_URL}/open-apis/docx/v1/documents/{doc_id}/blocks/{parent_id}/children",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"children": blocks, "index": index},
        timeout=30,
    )
    data = resp.json()
    if data.get("code") != 0:
        raise Exception(
            f"Create blocks failed [code={data.get('code')}]: {data.get('msg', '')}"
        )
    return data["data"].get("children", [])


def get_wiki_children(user_token: str, space_id: str, parent_node_token: str) -> list[dict]:
    nodes: list[dict] = []
    page_token = None
    while True:
        params: dict = {"parent_node_token": parent_node_token, "page_size": 50}
        if page_token:
            params["page_token"] = page_token
        resp = api_request(
            "GET", f"{BASE_URL}/open-apis/wiki/v2/spaces/{space_id}/nodes",
            headers={"Authorization": f"Bearer {user_token}"},
            params=params,
        )
        data = resp.json()
        if data.get("code") != 0:
            raise Exception(f"Failed to list children: {data}")
        nodes.extend(data["data"].get("items", []))
        if not data["data"].get("has_more"):
            break
        page_token = data["data"].get("page_token")
    return nodes


def download_media(user_token: str, file_token: str) -> bytes:
    resp = api_request(
        "GET", f"{BASE_URL}/open-apis/drive/v1/medias/{file_token}/download",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    if resp.status_code != 200:
        raise Exception(f"Media download failed: {resp.status_code}")
    return resp.content


def get_block(user_token: str, doc_id: str, block_id: str) -> dict:
    resp = api_request(
        "GET", f"{BASE_URL}/open-apis/docx/v1/documents/{doc_id}/blocks/{block_id}",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    data = resp.json()
    if data.get("code") != 0:
        raise Exception(f"Failed to get block: {data}")
    return data["data"]["block"]


def delete_children_tail(
    user_token: str, doc_id: str, parent_id: str, start_index: int, end_index: int,
) -> None:
    api_request(
        "DELETE",
        f"{BASE_URL}/open-apis/docx/v1/documents/{doc_id}/blocks/{parent_id}/children/batch_delete",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"start_index": start_index, "end_index": end_index},
    )


def update_block_elements(
    user_token: str, doc_id: str, block_id: str, elements: list[dict],
) -> None:
    resp = api_request(
        "PATCH", f"{BASE_URL}/open-apis/docx/v1/documents/{doc_id}/blocks/{block_id}",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"replace_text": {"elements": elements}},
    )
    data = resp.json()
    if data.get("code") != 0:
        raise Exception(f"Update block failed: {data}")


def patch_block(user_token: str, doc_id: str, block_id: str, body: dict) -> None:
    resp = api_request(
        "PATCH", f"{BASE_URL}/open-apis/docx/v1/documents/{doc_id}/blocks/{block_id}",
        headers={"Authorization": f"Bearer {user_token}"},
        params={"document_revision_id": -1},
        json=body,
    )
    data = resp.json()
    if data.get("code") != 0:
        log.warning("Patch block %s failed: %s", block_id, data.get("msg", ""))


def upload_media(user_token: str, data_bytes: bytes, parent_node: str = "", filename: str = "image.png") -> str:
    resp = api_request(
        "POST", f"{BASE_URL}/open-apis/drive/v1/medias/upload_all",
        headers={"Authorization": f"Bearer {user_token}"},
        data={"file_name": filename, "parent_type": "docx_image", "parent_node": parent_node, "size": str(len(data_bytes))},
        files={"file": (filename, io.BytesIO(data_bytes))},
        timeout=60,
    )
    data = resp.json()
    if data.get("code") != 0:
        raise Exception(f"Upload failed: {data}")
    return data["data"]["file_token"]


# ── Block utilities ──────────────────────────────────────────────────────────

CONTENT_KEY = {
    2: "text", 3: "heading1", 4: "heading2", 5: "heading3",
    6: "heading4", 7: "heading5", 8: "heading6", 9: "heading7",
    10: "heading8", 11: "heading9", 12: "bullet", 13: "ordered",
    14: "code", 15: "quote", 16: "equation", 17: "todo",
    18: "table", 19: "callout", 22: "divider", 24: "grid",
    25: "grid_column", 27: "image", 31: "table", 32: "table_cell",
    34: "quote_container",
}

def clean(obj: object) -> object:
    """Deep-copy, removing known read-only fields."""
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items() if k not in ("comment_ids",)}
    if isinstance(obj, list):
        return [clean(v) for v in obj]
    return obj


def safe_name(title: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", title)
    return name.strip().strip(".")[:200] or "untitled"


def compute_heading_numbers(src_blocks: list[dict]) -> dict[str, str]:
    bmap = {b["block_id"]: b for b in src_blocks}
    root = next((b for b in src_blocks if b["block_type"] == 1), None)
    if not root:
        return {}

    has_headings = any(3 <= b["block_type"] <= 11 for b in src_blocks)
    if not has_headings:
        return {}

    counters = [0] * 10
    result: dict[str, str] = {}

    def walk(block_ids: list[str]) -> None:
        for bid in block_ids:
            b = bmap.get(bid)
            if not b:
                continue
            bt = b["block_type"]
            if 3 <= bt <= 11:
                level = bt - 2
                counters[level] += 1
                for deeper in range(level + 1, 10):
                    counters[deeper] = 0
                parts = [str(counters[i]) for i in range(1, level + 1)]
                while parts and parts[0] == "0":
                    parts.pop(0)
                result[bid] = ".".join(parts) + " " if parts else ""
            if b.get("children"):
                walk(b["children"])

    walk(root.get("children", []))
    return result


def prepare(
    src: dict,
    image_cache: dict[str, tuple[bytes, int, int]],
    heading_numbers: dict[str, str] | None = None,
) -> dict | None:
    """Convert a read-API block to create-API format."""
    bt = src["block_type"]
    if bt in (1, 25, 32):
        return None  # auto-created

    key = CONTENT_KEY.get(bt)
    if key is None:
        return None

    block = {"block_type": bt}
    if key in src:
        content = clean(json.loads(json.dumps(src[key])))

        # Prepend heading number if available
        if 3 <= bt <= 11 and heading_numbers:
            num = heading_numbers.get(src.get("block_id", ""))
            if num:
                elements = content.get("elements", [])
                # Strip existing manual numbers (e.g., "1.1.4.1. ") from first element
                if elements and "text_run" in elements[0]:
                    first = elements[0]["text_run"]
                    old = first.get("content", "")
                    stripped = re.sub(r"^(\d+\.)+\d*\s*", "", old)
                    if stripped != old:
                        first["content"] = stripped
                num_element = {
                    "text_run": {
                        "content": num,
                        "text_element_style": {"text_color": 5},
                    }
                }
                content["elements"] = [num_element] + elements

        if bt in (18, 31):  # Table: drop source-specific cell IDs
            cells = content.get("cells")
            if bt == 18 and cells and isinstance(cells[0], list):
                content["cells"] = [[None for _ in row] for row in cells]
            elif bt == 31 and cells:
                content["cells"] = [None for _ in cells]
            # column_width and merge_info are read-only for create API
            prop = content.get("property")
            if prop:
                col_width = prop.get("column_width")
                merge_info = prop.get("merge_info")
                content["property"] = {
                    k: v for k, v in prop.items()
                    if k in ("column_size", "row_size", "header_row", "header_column")
                }
                if col_width:
                    block["_table_column_width"] = col_width
                if merge_info:
                    block["_table_merge_info"] = merge_info

        if bt == 27:  # Image: look up pre-downloaded data
            old_token = content.get("token", "")
            if old_token and old_token in image_cache:
                raw, w, h = image_cache[old_token]
                block["_image_data"] = raw
                block["_image_width"] = w
                block["_image_height"] = h
            elif old_token:
                log.warning("    Image not in cache [%s…], skipping", old_token[:12])
                return None
            # Save align and scale for the replace_image PATCH call
            if content.get("align") is not None:
                block["_image_align"] = content["align"]
            if content.get("scale") and content["scale"] != 1:
                block["_image_scale"] = content["scale"]
            content = {}

        block[key] = content

    return block


# ── Image handling ───────────────────────────────────────────────────────────


def prefetch_images(
    user_token: str, src_blocks: list[dict],
) -> dict[str, tuple[bytes, int, int]]:
    """Download images from source blocks. Returns {file_token: (bytes, w, h)}."""
    targets: list[tuple[str, int, int]] = []
    for b in src_blocks:
        if b["block_type"] == 27:
            img = b.get("image", {})
            token = img.get("token", "")
            if token:
                targets.append((token, img.get("width", 0), img.get("height", 0)))
    if not targets:
        return {}

    cache: dict[str, tuple[bytes, int, int]] = {}
    log.info("  Downloading %d images …", len(targets))

    def fetch(item: tuple[str, int, int]) -> tuple[str, bytes | None, int, int]:
        tok, w, h = item
        try:
            data = download_media(user_token, tok)
            return tok, data, w, h
        except Exception as exc:
            log.warning("  Image %s failed: %s", tok, exc)
            return tok, None, w, h

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for tok, data, w, h in pool.map(fetch, targets):
            if data:
                cache[tok] = (data, w, h)

    log.info("  Downloaded %d/%d images", len(cache), len(targets))
    return cache


def upload_image_to_block(
    user_token: str, doc_id: str, block_id: str,
    data_bytes: bytes, width: int = 0, height: int = 0,
    scale: float | None = None, align: int | None = None,
) -> str:
    file_token = upload_media(user_token, data_bytes, parent_node=block_id)
    replace_body: dict = {"token": file_token}
    if width and height:
        replace_body["width"] = width
        replace_body["height"] = height
    if scale is not None:
        replace_body["scale"] = scale
    if align is not None:
        replace_body["align"] = align
    patch_block(user_token, doc_id, block_id, {"replace_image": replace_body})
    return file_token


def upload_pending_images(
    user_token: str, doc_id: str,
    created_blocks: list[dict],
    chunk: list[tuple[dict, dict]],
) -> None:
    """After creating blocks, upload image data to any image blocks."""
    for j, new_blk in enumerate(created_blocks):
        if j >= len(chunk):
            break
        src_prepared = chunk[j][0]
        image_data = src_prepared.pop("_image_data", None)
        if image_data and new_blk.get("block_id"):
            w = src_prepared.pop("_image_width", 0)
            h = src_prepared.pop("_image_height", 0)
            sc = src_prepared.pop("_image_scale", None)
            al = src_prepared.pop("_image_align", None)
            try:
                upload_image_to_block(
                    user_token, doc_id, new_blk["block_id"], image_data,
                    width=w, height=h, scale=sc, align=al,
                )
                log.debug("    Uploaded image to block (scale=%s, align=%s)", sc, al)
            except Exception as e:
                log.warning("    Image upload failed: %s", e)


# ── Copy engine ──────────────────────────────────────────────────────────────


def _strip_internal_keys(block: dict) -> dict:
    """Remove _-prefixed keys before sending to API."""
    return {k: v for k, v in block.items() if not k.startswith("_")}


def _get_auto_children(new_blk: dict, user_token: str, dst_doc_id: str) -> list[str]:
    """Get auto-created children IDs from a newly created block."""
    ids = new_blk.get("children", [])
    if not ids:
        try:
            blk = get_block(user_token, dst_doc_id, new_blk["block_id"])
            ids = blk.get("children", [])
        except Exception as e:
            log.warning("Could not fetch child block %s: %s", new_blk.get("block_id"), e)
    return ids


def _queue_children(
    new_blk: dict, src_blk: dict, bmap: dict[str, dict],
    nxt: list[tuple[list[str], str, bool]], user_token: str, dst_doc_id: str,
) -> None:
    """After creating a block, queue its source children for the next BFS level."""
    bt = src_blk["block_type"]

    if bt in (18, 31):  # bitable or table
        new_cell_ids = _get_auto_children(new_blk, user_token, dst_doc_id)
        src_cells = src_blk.get(CONTENT_KEY.get(bt, ""), {}).get("cells", [])
        if bt == 18 and src_cells and isinstance(src_cells[0], list):
            flat_src = [c for row in src_cells for c in row if c]
        else:
            flat_src = src_blk.get("children", [])
        for k, scid in enumerate(flat_src):
            if k < len(new_cell_ids):
                sc = bmap.get(scid)
                if sc and sc.get("children"):
                    nxt.append((sc["children"], new_cell_ids[k], True))

    elif bt == 24:
        new_col_ids = _get_auto_children(new_blk, user_token, dst_doc_id)
        src_col_ids = src_blk.get("children", [])
        for k, scid in enumerate(src_col_ids):
            if k < len(new_col_ids):
                sc = bmap.get(scid)
                if sc and sc.get("children"):
                    nxt.append((sc["children"], new_col_ids[k], True))

    elif src_blk.get("children"):
        needs_cleanup = bt in (19, 34)  # callout, quote_container
        nxt.append((src_blk["children"], new_blk["block_id"], needs_cleanup))


def _collect_table_patch(
    new_blk: dict, prepared: dict,
    deferred: list[tuple[str, dict]],
) -> None:
    """Collect table property patches to apply after all cells are populated."""
    bid = new_blk.get("block_id", "")
    if not bid:
        return

    col_width = prepared.pop("_table_column_width", None)
    merge_info = prepared.pop("_table_merge_info", None)
    if col_width:
        prop: dict = {"column_width": col_width}
        if merge_info:
            prop["merge_info"] = merge_info
        deferred.append((bid, prop))


def copy_blocks(
    token_mgr: TokenManager,
    src_blocks: list[dict], dst_doc_id: str,
    image_cache: dict[str, tuple[bytes, int, int]],
    heading_numbers: dict[str, str] | None = None,
) -> int:
    """BFS copy of blocks from source to destination document."""
    bmap = {b["block_id"]: b for b in src_blocks}
    root = next((b for b in src_blocks if b["block_type"] == 1), None)
    if not root:
        return 0

    # Queue: (child_ids, parent_id, needs_cleanup)
    queue: list[tuple[list[str], str, bool]] = [
        (root.get("children", []), dst_doc_id, False)
    ]
    total = 0
    skipped = 0
    deferred_table_patches: list[tuple[str, dict]] = []

    while queue:
        nxt: list[tuple[list[str], str, bool]] = []
        user_token = token_mgr.get()

        for child_ids, parent_id, needs_cleanup in queue:
            if not child_ids:
                continue

            # Expand unsupported block types (use their children)
            expanded_ids: list[str] = []
            for cid in child_ids:
                s = bmap.get(cid)
                if not s:
                    continue
                if s["block_type"] not in CONTENT_KEY and s["block_type"] != 1:
                    kids = s.get("children", [])
                    if kids:
                        expanded_ids.extend(kids)
                    else:
                        log.warning(
                            "  Skipped unsupported block_type=%d (no children) [%s]",
                            s["block_type"], cid,
                        )
                else:
                    expanded_ids.append(cid)

            pairs = []
            for cid in expanded_ids:
                s = bmap.get(cid)
                if not s:
                    continue
                b = prepare(s, image_cache, heading_numbers=heading_numbers)
                if b:
                    pairs.append((b, s))

            insert_pos = 0
            for i in range(0, len(pairs), 10):
                chunk = pairs[i : i + 10]
                batch = [p[0] for p in chunk]
                batch_clean = [
                    {k: v for k, v in b.items() if not k.startswith("_")}
                    for b in batch
                ]
                try:
                    created = create_children(
                        user_token, dst_doc_id, parent_id, batch_clean,
                        index=insert_pos,
                    )
                    total += len(created)
                    insert_pos += len(created)
                    upload_pending_images(user_token, dst_doc_id, created, chunk)
                    for j, new_blk in enumerate(created):
                        _collect_table_patch(new_blk, chunk[j][0], deferred_table_patches)
                        _queue_children(
                            new_blk, chunk[j][1], bmap, nxt, user_token, dst_doc_id
                        )
                except Exception as e:
                    log.warning("  Batch failed (%d blocks): %s", len(batch), e)
                    log.info("  Retrying one-by-one …")
                    for _idx, (single, src_blk) in enumerate(chunk):
                        single_clean = {
                            k: v for k, v in single.items()
                            if not k.startswith("_")
                        }
                        try:
                            created = create_children(
                                user_token, dst_doc_id, parent_id,
                                [single_clean], index=insert_pos,
                            )
                            total += len(created)
                            insert_pos += len(created)
                            img_data = single.pop("_image_data", None)
                            if img_data and created:
                                iw = single.pop("_image_width", 0)
                                ih = single.pop("_image_height", 0)
                                isc = single.pop("_image_scale", None)
                                ial = single.pop("_image_align", None)
                                try:
                                    upload_image_to_block(
                                        user_token, dst_doc_id,
                                        created[0]["block_id"], img_data,
                                        width=iw, height=ih, scale=isc,
                                        align=ial,
                                    )
                                except Exception as ue:
                                    log.warning("    Image upload failed: %s", ue)
                            for new_blk in created:
                                _collect_table_patch(
                                    new_blk, single, deferred_table_patches,
                                )
                                _queue_children(
                                    new_blk, src_blk, bmap, nxt,
                                    user_token, dst_doc_id,
                                )
                        except Exception as e2:
                            bt = src_blk["block_type"]
                            log.warning("    Skipped block_type=%d: %s", bt, e2)
                            skipped += 1
                        time.sleep(0.2)

                time.sleep(0.3)

            # Delete auto-created trailing empty paragraphs in containers
            if needs_cleanup and insert_pos > 0:
                try:
                    parent_blk = get_block(user_token, dst_doc_id, parent_id)
                    n_kids = len(parent_blk.get("children", []))
                    if n_kids > insert_pos:
                        delete_children_tail(
                            user_token, dst_doc_id, parent_id,
                            insert_pos, n_kids,
                        )
                except Exception as e:
                    log.debug("  Container cleanup failed for %s: %s", parent_id, e)

        queue = nxt

    # Apply deferred table property patches after all cell content is populated
    if deferred_table_patches:
        user_token = token_mgr.get()
        for bid, prop in deferred_table_patches:
            col_widths = prop.get("column_width", [])
            for col_idx, cw in enumerate(col_widths):
                try:
                    patch_block(
                        user_token, dst_doc_id, bid,
                        {"update_table_property": {
                            "column_width": cw,
                            "column_index": col_idx,
                        }},
                    )
                except Exception as e:
                    log.debug("  Table col %d width patch failed for %s: %s", col_idx, bid, e)
            merge_info = prop.get("merge_info")
            if merge_info:
                try:
                    patch_block(
                        user_token, dst_doc_id, bid,
                        {"update_table_property": {"property": {"merge_info": merge_info}}},
                    )
                except Exception as e:
                    log.warning("Table merge patch failed for %s: %s", bid, e)
            if col_widths:
                log.debug("  Patched table column widths for %s", bid)

    if skipped:
        log.warning("  %d block(s) could not be copied", skipped)
    return total


def cleanup_empty_tails(user_token: str, dst_doc_id: str, src_blocks: list[dict]) -> None:
    """Delete auto-created trailing empty text blocks in callouts and grid columns."""
    dst_blocks = get_all_blocks(user_token, dst_doc_id)
    dst_bmap = {b["block_id"]: b for b in dst_blocks}

    src_containers = [b for b in src_blocks if b["block_type"] in (19, 25, 34)]
    dst_containers = [b for b in dst_blocks if b["block_type"] in (19, 25, 34)]

    deleted = 0
    for si, sc in enumerate(src_containers):
        if si >= len(dst_containers):
            break
        dc = dst_containers[si]
        if sc["block_type"] != dc["block_type"]:
            continue

        src_n = len(sc.get("children", []))
        dst_kids = dc.get("children", [])
        dst_n = len(dst_kids)

        if dst_n > src_n:
            all_empty = True
            for kid_id in dst_kids[src_n:]:
                kid = dst_bmap.get(kid_id)
                if not kid or kid["block_type"] != 2:
                    all_empty = False
                    break
                elems = kid.get("text", {}).get("elements", [])
                text = "".join(
                    e.get("text_run", {}).get("content", "") for e in elems
                )
                if text.strip():
                    all_empty = False
                    break
            if all_empty:
                try:
                    delete_children_tail(
                        user_token, dst_doc_id, dc["block_id"],
                        src_n, dst_n,
                    )
                    deleted += dst_n - src_n
                except Exception as e:
                    log.warning("cleanup_empty_tails failed for container %s: %s", dc["block_id"], e)

    if deleted:
        log.info("  Cleaned up %d auto-created empty paragraph(s)", deleted)


def copy_single_page(
    token_mgr: TokenManager,
    source_node_token: str, target_space_id: str, target_node_token: str,
    title: str | None = None, depth: int = 0, heading_numbering: bool = False,
    node_map: dict | None = None, doc_map: dict | None = None, obj_map: dict | None = None,
) -> tuple[str, str]:
    """Copy one wiki page. Returns (new_node_token, new_doc_id)."""
    indent = "  " * depth
    user_token = token_mgr.get()

    src_node = get_wiki_node(user_token, source_node_token)
    src_title = src_node.get("title", "Untitled")
    obj_token = src_node["obj_token"]
    obj_type = src_node.get("obj_type")

    page_title = title or src_title
    log.info("%s  Copying page: %s", indent, page_title)

    if obj_type != "docx":
        log.warning("%s  Skipping non-docx page (type=%s): %s", indent, obj_type, src_title)
        return "", ""

    blocks = get_all_blocks(user_token, obj_token)
    log.info("%s  %d blocks", indent, len(blocks))

    heading_numbers = None
    if heading_numbering:
        heading_numbers = compute_heading_numbers(blocks)
        if heading_numbers:
            log.info("%s  Heading numbers computed for %d headings", indent, len(heading_numbers))

    try:
        image_cache = prefetch_images(user_token, blocks)
    except Exception:
        image_cache = {}

    node_token, dst_doc_id = create_wiki_node(
        user_token, target_space_id, target_node_token, page_title,
    )
    log.info("%s  → %s", indent, f"https://my.feishu.cn/wiki/{node_token}")

    if node_map is not None:
        node_map[source_node_token] = node_token
    if doc_map is not None:
        doc_map[node_token] = dst_doc_id
    if obj_map is not None:
        obj_map[obj_token] = dst_doc_id

    n = copy_blocks(token_mgr, blocks, dst_doc_id, image_cache, heading_numbers=heading_numbers)
    log.info("%s  %d blocks created", indent, n)

    try:
        user_token = token_mgr.get()
        cleanup_empty_tails(user_token, dst_doc_id, blocks)
    except Exception as e:
        log.warning("Post-copy cleanup failed for %s: %s", dst_doc_id, e)

    return node_token, dst_doc_id


def copy_recursive(
    token_mgr: TokenManager,
    source_node_token: str, source_space_id: str,
    target_space_id: str, target_node_token: str,
    title: str | None = None, depth: int = 0, heading_numbering: bool = False,
    node_map: dict | None = None, doc_map: dict | None = None, obj_map: dict | None = None,
) -> int:
    """Recursively copy page and all subpages. Returns total pages copied."""
    indent = "  " * depth

    new_node_token, _ = copy_single_page(
        token_mgr, source_node_token, target_space_id, target_node_token,
        title=title, depth=depth, heading_numbering=heading_numbering,
        node_map=node_map, doc_map=doc_map, obj_map=obj_map,
    )
    if not new_node_token:
        return 0

    count = 1

    user_token = token_mgr.get()
    src_node = get_wiki_node(user_token, source_node_token)
    if not src_node.get("has_child"):
        return count

    children = get_wiki_children(user_token, source_space_id, source_node_token)
    if children:
        log.info("%s  %d subpage(s) found", indent, len(children))

    for i, child in enumerate(children):
        child_token = child.get("node_token", "")
        if not child_token:
            continue
        if i > 0:
            time.sleep(1)
        count += copy_recursive(
            token_mgr, child_token, source_space_id,
            target_space_id, new_node_token,
            depth=depth + 1, heading_numbering=heading_numbering,
            node_map=node_map, doc_map=doc_map, obj_map=obj_map,
        )

    return count


# ── Reference fixup ──────────────────────────────────────────────────────────


def _remap_url(
    url: str, node_map: dict, obj_map: dict,
    block_id_map: dict[str, str] | None = None,
) -> str | None:
    """Remap a Feishu URL, returning the new URL or None if unchanged.

    Handles /wiki/{node_token} and /docx/{obj_token} URLs, plus #anchor fragments.
    """
    new_url = url
    remapped = False

    for src_tok, dst_tok in node_map.items():
        if src_tok in new_url:
            new_url = new_url.replace(src_tok, dst_tok)
            remapped = True
            break

    if not remapped:
        for src_tok, dst_tok in obj_map.items():
            if src_tok in new_url:
                new_url = new_url.replace(src_tok, dst_tok)
                remapped = True
                break

    if block_id_map:
        for sep in ("#", "%23"):
            if sep in new_url:
                base, fragment = new_url.rsplit(sep, 1)
                if fragment in block_id_map:
                    new_url = f"{base}{sep}{block_id_map[fragment]}"
                    remapped = True
                break

    return new_url if remapped else None


def _remap_elements(
    elements: list[dict], node_map: dict, obj_map: dict,
    block_id_map: dict[str, str] | None = None,
) -> bool:
    """Modify elements in-place, replacing source doc references with target.

    Returns True if any changes were made.
    """
    changed = False
    for elem in elements:
        if "mention_doc" in elem:
            doc = elem["mention_doc"]
            url = doc.get("url", "")
            new_url = _remap_url(url, node_map, obj_map, block_id_map)
            if new_url:
                doc["url"] = new_url
                changed = True
            token = doc.get("token", "")
            if token in obj_map:
                doc["token"] = obj_map[token]
                changed = True

        elif "text_run" in elem:
            style = elem["text_run"].get("text_element_style", {})
            link = style.get("link", {})
            url = link.get("url", "")
            if url:
                new_url = _remap_url(url, node_map, obj_map, block_id_map)
                if new_url:
                    link["url"] = new_url
                    changed = True

    return changed


def _build_block_id_map(
    token_mgr: TokenManager,
    source_obj_token: str,
    target_obj_token: str,
) -> dict[str, str]:
    """Build source_block_id -> target_block_id mapping by matching blocks positionally."""
    user_token = token_mgr.get()
    src_blocks = get_all_blocks(user_token, source_obj_token)
    user_token = token_mgr.get()
    tgt_blocks = get_all_blocks(user_token, target_obj_token)

    if len(src_blocks) != len(tgt_blocks):
        log.warning("  Block count mismatch: source=%d target=%d (mapping may be incomplete)",
                    len(src_blocks), len(tgt_blocks))

    mapping: dict[str, str] = {}
    for sb, tb in zip(src_blocks, tgt_blocks):
        mapping[sb["block_id"]] = tb["block_id"]
    return mapping


def fixup_references(
    token_mgr: TokenManager,
    node_map: dict, obj_map: dict, doc_map: dict,
) -> int:
    """Post-copy reference fixup. Returns total blocks updated."""
    if not node_map:
        return 0

    log.info("Fixing document references across %d page(s) …", len(doc_map))
    fixed_blocks = 0
    fixed_pages = 0

    block_id_map_cache: dict[str, dict[str, str]] = {}

    for new_node_token, new_doc_id in doc_map.items():
        user_token = token_mgr.get()

        try:
            blocks = get_all_blocks(user_token, new_doc_id)
        except Exception as e:
            log.warning("  Failed to read blocks for fixup (node=%s…): %s",
                        new_node_token[:12], e)
            continue

        # Collect obj_tokens referenced by anchor URLs
        referenced_objs: set[str] = set()
        for block in blocks:
            bt = block["block_type"]
            key = CONTENT_KEY.get(bt)
            if not key or key not in block:
                continue
            for el in block[key].get("elements", []):
                url = ""
                if "text_run" in el:
                    url = el["text_run"].get("text_element_style", {}).get("link", {}).get("url", "")
                elif "mention_doc" in el:
                    url = el["mention_doc"].get("url", "")
                if "#" not in url and "%23" not in url:
                    continue
                for src_obj, tgt_obj in obj_map.items():
                    if src_obj in url or tgt_obj in url:
                        referenced_objs.add(src_obj)
                        break

        # Build block_id maps lazily
        block_id_map: dict[str, str] = {}
        for src_obj in referenced_objs:
            if src_obj in block_id_map_cache:
                block_id_map.update(block_id_map_cache[src_obj])
            else:
                tgt_obj = obj_map[src_obj]
                try:
                    bid_map = _build_block_id_map(token_mgr, src_obj, tgt_obj)
                    block_id_map_cache[src_obj] = bid_map
                    block_id_map.update(bid_map)
                except Exception as e:
                    log.warning("  Failed to build block_id map for %s: %s",
                                src_obj[:12], e)

        page_fixed = 0
        for block in blocks:
            bt = block["block_type"]
            key = CONTENT_KEY.get(bt)
            if not key or key not in block:
                continue

            content = block[key]
            elements = content.get("elements")
            if not elements:
                continue

            new_elements = json.loads(json.dumps(elements))
            if not _remap_elements(new_elements, node_map, obj_map,
                                   block_id_map or None):
                continue

            new_elements = clean(new_elements)
            user_token = token_mgr.get()
            try:
                update_block_elements(
                    user_token, new_doc_id, block["block_id"], new_elements,
                )
                page_fixed += 1
            except Exception as e:
                # Retry once on token expiry
                if "99991677" in str(e):
                    token_mgr.invalidate()
                    user_token = token_mgr.get()
                    try:
                        update_block_elements(
                            user_token, new_doc_id, block["block_id"], new_elements,
                        )
                        page_fixed += 1
                        time.sleep(0.3)
                        continue
                    except Exception as e2:
                        log.warning("  Failed to fix block %s: %s", block["block_id"], e2)
                        time.sleep(0.3)
                        continue
                # Mention-to-text fallback
                has_mention = any("mention_doc" in el for el in new_elements)
                if has_mention:
                    for mi, el in enumerate(new_elements):
                        if "mention_doc" in el:
                            doc = el["mention_doc"]
                            mtitle = doc.get("title", "link")
                            murl = doc.get("url", "")
                            new_elements[mi] = {
                                "text_run": {
                                    "content": mtitle,
                                    "text_element_style": {
                                        "link": {"url": urllib.parse.quote(murl, safe="")},
                                    },
                                },
                            }
                    try:
                        update_block_elements(
                            user_token, new_doc_id, block["block_id"], new_elements,
                        )
                        page_fixed += 1
                    except Exception as e2:
                        log.warning("  Failed to fix block %s: %s", block["block_id"], e2)
                else:
                    log.warning("  Failed to fix block %s: %s", block["block_id"], e)

            time.sleep(0.3)

        if page_fixed:
            fixed_blocks += page_fixed
            fixed_pages += 1
            log.info("  Fixed %d ref(s) in %s",
                     page_fixed, f"https://my.feishu.cn/wiki/{new_node_token}")

    log.info("Reference fixup done: %d block(s) in %d page(s)", fixed_blocks, fixed_pages)
    return fixed_blocks


# ── Sync engine ──────────────────────────────────────────────────────────────

SYNC_STATE_DIR = os.path.join(_LOG_DIR, "state")


def _sync_state_file(source_token: str, target_token: str) -> str:
    h = hashlib.sha256(f"{source_token}:{target_token}".encode()).hexdigest()[:16]
    return os.path.join(SYNC_STATE_DIR, f"sync_{h}.json")


def _load_sync_state(path: str) -> dict | None:
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return None


def _save_sync_state(state: dict, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def _compute_content_hash(blocks: list[dict]) -> str:
    def _strip(obj: object) -> object:
        if isinstance(obj, dict):
            return {
                k: _strip(v) for k, v in sorted(obj.items())
                if k not in ("block_id", "parent_id", "children", "comment_ids")
            }
        if isinstance(obj, list):
            return [_strip(v) for v in obj]
        return obj

    stripped = [_strip(b) for b in blocks]
    raw = json.dumps(stripped, sort_keys=True, ensure_ascii=False)
    return "sha256:" + hashlib.sha256(raw.encode()).hexdigest()


def _scan_source_tree(
    token_mgr: TokenManager, source_node_token: str, source_space_id: str, depth: int = 0,
) -> list[dict]:
    """Walk source wiki tree collecting metadata (without fetching blocks)."""
    user_token = token_mgr.get()
    node = get_wiki_node(user_token, source_node_token)
    entry = {
        "node_token": node["node_token"],
        "title": node.get("title", "Untitled"),
        "obj_token": node.get("obj_token", ""),
        "obj_type": node.get("obj_type", ""),
        "obj_edit_time": str(node.get("obj_edit_time", "")),
        "has_child": node.get("has_child", False),
        "depth": depth,
        "children_tokens": [],
    }
    result = [entry]

    if node.get("has_child"):
        children = get_wiki_children(user_token, source_space_id, source_node_token)
        entry["children_tokens"] = [c["node_token"] for c in children]
        for i, child in enumerate(children):
            if i > 0:
                time.sleep(0.3)
            result.extend(_scan_source_tree(
                token_mgr, child["node_token"], source_space_id, depth + 1,
            ))

    return result


def _find_target_parent(
    snode: dict,
    source_nodes: list[dict],
    pages_state: dict[str, dict],
    target_root: str,
) -> str:
    """Find the target parent node_token for a new page."""
    parent_map: dict[str, str] = {}
    for n in source_nodes:
        for child_tok in n.get("children_tokens", []):
            parent_map[child_tok] = n["node_token"]

    current = snode["node_token"]
    while current in parent_map:
        parent_src = parent_map[current]
        if parent_src in pages_state:
            return pages_state[parent_src]["target_node_token"]
        current = parent_src

    return target_root


def _update_existing_page(
    token_mgr: TokenManager,
    source_node_token: str,
    target_obj_token: str,
    heading_numbering: bool = False,
) -> tuple[int, list[dict]]:
    """Clear target page blocks and re-copy from source.

    Returns (blocks_created, source_blocks).
    """
    user_token = token_mgr.get()

    src_node = get_wiki_node(user_token, source_node_token)
    src_obj_token = src_node["obj_token"]
    src_blocks = get_all_blocks(user_token, src_obj_token)

    heading_numbers = None
    if heading_numbering:
        heading_numbers = compute_heading_numbers(src_blocks)

    try:
        image_cache = prefetch_images(user_token, src_blocks)
    except Exception:
        image_cache = {}

    dst_blocks = get_all_blocks(user_token, target_obj_token)
    dst_root = next((b for b in dst_blocks if b["block_type"] == 1), None)
    if dst_root and dst_root.get("children"):
        n_children = len(dst_root["children"])
        if n_children > 0:
            delete_children_tail(
                user_token, target_obj_token, target_obj_token,
                0, n_children,
            )
            time.sleep(0.5)

    n = copy_blocks(
        token_mgr, src_blocks, target_obj_token, image_cache,
        heading_numbers=heading_numbers,
    )

    try:
        user_token = token_mgr.get()
        cleanup_empty_tails(user_token, target_obj_token, src_blocks)
    except Exception as e:
        log.warning("Post-update cleanup failed for %s: %s", target_obj_token, e)

    return n, src_blocks


def _extract_headings(blocks: list[dict]) -> list[str]:
    """Extract heading text from blocks for summary display."""
    headings: list[str] = []
    for b in blocks:
        bt = b["block_type"]
        if 3 <= bt <= 11:
            key = f"heading{bt - 2}"
            elements = b.get(key, {}).get("elements", [])
            text = "".join(
                e.get("text_run", {}).get("content", "") for e in elements
            )
            text = text.strip()
            if text:
                text = re.sub(r"^(\d+\.)+\d*\s*", "", text)
                headings.append(text)
    return headings


def sync_recursive(
    token_mgr: TokenManager,
    source_node_token: str, source_space_id: str,
    target_space_id: str, target_node_token: str,
    heading_numbering: bool = False, fix_refs: bool = True, title: str | None = None,
) -> None:
    """Incremental sync of wiki tree."""
    # Setup file logging
    os.makedirs(_LOG_DIR, exist_ok=True)
    today = datetime.now().strftime("%y-%m-%d")
    idx = 1
    while os.path.exists(os.path.join(_LOG_DIR, f"{today}-{idx:03d}.log")):
        idx += 1
    log_file = os.path.join(_LOG_DIR, f"{today}-{idx:03d}.log")
    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logging.getLogger().addHandler(fh)
    log.info("Log file: %s", log_file)

    state_file = _sync_state_file(source_node_token, target_node_token)
    state = _load_sync_state(state_file)
    is_first_sync = state is None

    # FIX 15: Inherit options from saved state
    if state and not is_first_sync:
        saved_opts = state.get("options", {})
        if saved_opts.get("heading_numbers") and not heading_numbering:
            heading_numbering = True
            log.debug("  Inherited --heading-numbers from saved state")
        if saved_opts.get("fix_refs") and not fix_refs:
            fix_refs = True

    # Phase 1: Scan source tree
    log.info("Scanning source tree …")
    source_nodes = _scan_source_tree(token_mgr, source_node_token, source_space_id)
    source_tokens = {n["node_token"] for n in source_nodes}
    log.info("  %d page(s) in source tree", len(source_nodes))

    if is_first_sync:
        # First sync: full copy
        log.info("First sync — copying all pages …")
        node_map: dict[str, str] = {}
        doc_map: dict[str, str] = {}
        obj_map: dict[str, str] = {}

        try:
            total_pages = copy_recursive(
                token_mgr, source_node_token, source_space_id,
                target_space_id, target_node_token,
                title=title, heading_numbering=heading_numbering,
                node_map=node_map, doc_map=doc_map, obj_map=obj_map,
            )
        except Exception:
            if node_map:
                log.warning("Copy interrupted — saving partial state …")
                partial_pages: dict[str, dict] = {}
                for sn in source_nodes:
                    snt = sn["node_token"]
                    if snt in node_map:
                        tnt = node_map[snt]
                        partial_pages[snt] = {
                            "target_node_token": tnt,
                            "target_obj_token": doc_map.get(tnt, ""),
                            "source_obj_token": sn["obj_token"],
                            "title": sn["title"],
                            "obj_edit_time": sn.get("obj_edit_time", ""),
                            "content_hash": "",
                            "last_synced": datetime.now(timezone.utc).isoformat(),
                            "children_order": sn.get("children_tokens", []),
                        }
                partial_state = {
                    "version": 1,
                    "source_root": source_node_token,
                    "target_root": target_node_token,
                    "source_space_id": source_space_id,
                    "target_space_id": target_space_id,
                    "last_sync_time": datetime.now(timezone.utc).isoformat(),
                    "options": {"heading_numbers": heading_numbering, "fix_refs": fix_refs},
                    "pages": partial_pages,
                }
                _save_sync_state(partial_state, state_file)
            raise

        if fix_refs and node_map:
            fixup_references(token_mgr, node_map, obj_map, doc_map)

        # Build state
        pages: dict[str, dict] = {}
        for sn in source_nodes:
            snt = sn["node_token"]
            if snt in node_map:
                tnt = node_map[snt]
                pages[snt] = {
                    "target_node_token": tnt,
                    "target_obj_token": doc_map.get(tnt, ""),
                    "source_obj_token": sn["obj_token"],
                    "title": sn["title"],
                    "obj_edit_time": sn.get("obj_edit_time", ""),
                    "content_hash": "",
                    "last_synced": datetime.now(timezone.utc).isoformat(),
                    "children_order": sn.get("children_tokens", []),
                }

        state = {
            "version": 1,
            "source_root": source_node_token,
            "target_root": target_node_token,
            "source_space_id": source_space_id,
            "target_space_id": target_space_id,
            "last_sync_time": datetime.now(timezone.utc).isoformat(),
            "options": {"heading_numbers": heading_numbering, "fix_refs": fix_refs},
            "pages": pages,
        }
        _save_sync_state(state, state_file)
        log.info("Done — %d page(s) copied. State saved.", total_pages)
        return

    # Phase 2: Classify pages
    pages_state = state.get("pages", {})

    new_pages: list[dict] = []
    modified_pages: list[dict] = []
    unchanged_pages: list[dict] = []
    deleted_pages: list[dict] = []

    for snode in source_nodes:
        stok = snode["node_token"]
        if stok not in pages_state:
            if snode["obj_type"] != "docx":
                log.info("  Skipping non-docx page: %s (type=%s)",
                         snode["title"], snode["obj_type"])
            else:
                new_pages.append(snode)
        else:
            stored = pages_state[stok]
            if snode["obj_edit_time"] != stored.get("obj_edit_time", ""):
                modified_pages.append(snode)
            else:
                unchanged_pages.append(snode)

    for stok, pstate in pages_state.items():
        if stok not in source_tokens:
            deleted_pages.append(pstate)

    if not new_pages and not modified_pages and not deleted_pages:
        log.info("  Everything up to date — no changes detected.")
        return

    log.info("  %d new, %d possibly modified, %d unchanged, %d deleted",
             len(new_pages), len(modified_pages),
             len(unchanged_pages), len(deleted_pages))

    # Rebuild maps from state for fix-refs
    node_map = {}
    doc_map = {}
    obj_map = {}
    for stok, pstate in pages_state.items():
        node_map[stok] = pstate["target_node_token"]
        doc_map[pstate["target_node_token"]] = pstate["target_obj_token"]
        obj_map[pstate["source_obj_token"]] = pstate["target_obj_token"]

    pages_changed = False

    try:
        # Phase 3a: Process NEW pages
        for snode in new_pages:
            stok = snode["node_token"]
            target_parent = _find_target_parent(
                snode, source_nodes, pages_state, target_node_token,
            )

            log.info("  [NEW] %s (parent=%s)", snode["title"], target_parent)
            try:
                new_ntok, new_otok = copy_single_page(
                    token_mgr, stok, target_space_id, target_parent,
                    depth=snode["depth"], heading_numbering=heading_numbering,
                    node_map=node_map, doc_map=doc_map, obj_map=obj_map,
                )
            except Exception as e:
                log.warning("  [FAIL] %s: %s", snode["title"], e)
                continue
            if new_ntok:
                pages_changed = True
                user_token = token_mgr.get()
                blocks = get_all_blocks(user_token, snode["obj_token"])
                headings = _extract_headings(blocks)

                pages_state[stok] = {
                    "target_node_token": new_ntok,
                    "target_obj_token": new_otok,
                    "source_obj_token": snode["obj_token"],
                    "title": snode["title"],
                    "obj_edit_time": snode["obj_edit_time"],
                    "content_hash": _compute_content_hash(blocks),
                    "last_synced": datetime.now(timezone.utc).isoformat(),
                    "children_order": snode.get("children_tokens", []),
                }

            time.sleep(1)

        # Phase 3b: Process MODIFIED pages
        for snode in modified_pages:
            stok = snode["node_token"]
            stored = pages_state[stok]
            target_otok = stored["target_obj_token"]

            user_token = token_mgr.get()
            src_blocks = get_all_blocks(user_token, snode["obj_token"])
            new_hash = _compute_content_hash(src_blocks)

            if new_hash == stored.get("content_hash", "") and stored.get("content_hash"):
                log.info("  [SKIP] %s (timestamp changed, content identical)",
                         snode["title"])
                pages_state[stok]["obj_edit_time"] = snode["obj_edit_time"]
                continue

            log.info("  [MOD] %s", snode["title"])
            try:
                pages_changed = True
                n, _ = _update_existing_page(
                    token_mgr, stok, target_otok,
                    heading_numbering=heading_numbering,
                )
                log.info("    %d blocks re-created", n)
            except Exception as e:
                log.warning("  [FAIL] %s: %s", snode["title"], e)
                continue

            pages_state[stok].update({
                "title": snode["title"],
                "obj_edit_time": snode["obj_edit_time"],
                "content_hash": new_hash,
                "last_synced": datetime.now(timezone.utc).isoformat(),
                "children_order": snode.get("children_tokens", []),
            })

            time.sleep(1)

        # Phase 3c: Handle DELETED pages
        for dpage in deleted_pages:
            dtitle = dpage.get("title", "Unknown")
            log.warning("  [DEL] %s (target kept: %s)",
                         dtitle, dpage.get("target_node_token", "?"))

        for stok in list(pages_state.keys()):
            if stok not in source_tokens:
                del pages_state[stok]

        # Phase 3d: Fix refs if pages were actually copied/updated
        if fix_refs and pages_changed and node_map:
            fixup_references(token_mgr, node_map, obj_map, doc_map)

    finally:
        state["pages"] = pages_state
        state["last_sync_time"] = datetime.now(timezone.utc).isoformat()
        _save_sync_state(state, state_file)
        log.info("State saved.")


# ── Export engine ────────────────────────────────────────────────────────────


def export_docx_images(user_token: str, obj_token: str, img_dir: str) -> list[str]:
    """Export docx and extract images from the .docx zip."""
    # Create export task
    resp = api_request(
        "POST", f"{BASE_URL}/open-apis/drive/v1/export_tasks",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"file_extension": "docx", "token": obj_token, "type": "docx"},
    )
    data = resp.json()
    if data.get("code") != 0:
        log.warning("Export task failed: %s", data)
        return []
    ticket = data["data"]["ticket"]

    # Poll until done
    for _ in range(20):
        time.sleep(2)
        resp = api_request(
            "GET", f"{BASE_URL}/open-apis/drive/v1/export_tasks/{ticket}",
            headers={"Authorization": f"Bearer {user_token}"},
            params={"token": obj_token},
        )
        data = resp.json()
        if data.get("code") != 0:
            continue
        result = data["data"].get("result", {})
        if result.get("job_status") == 0:
            file_token = result.get("file_token")
            if file_token:
                break
    else:
        log.warning("Export task timed out")
        return []

    # Download
    resp = api_request(
        "GET", f"{BASE_URL}/open-apis/drive/v1/export_tasks/{ticket}/file",
        headers={"Authorization": f"Bearer {user_token}"},
        params={"token": obj_token},
    )
    if resp.status_code != 200:
        return []

    # Extract images from docx zip
    import tempfile
    tmp_path = os.path.join(tempfile.gettempdir(), f"feishu_{obj_token}.docx")
    with open(tmp_path, "wb") as f:
        f.write(resp.content)

    extracted: list[str] = []
    try:
        os.makedirs(img_dir, exist_ok=True)
        with zipfile.ZipFile(tmp_path) as zf:
            idx = 0
            for name in zf.namelist():
                if name.startswith("word/media/"):
                    idx += 1
                    ext = os.path.splitext(name)[1] or ".png"
                    out_name = f"image_{idx}{ext}"
                    out_path = os.path.join(img_dir, out_name)
                    with zf.open(name) as src, open(out_path, "wb") as dst:
                        dst.write(src.read())
                    extracted.append(out_path)
    finally:
        os.unlink(tmp_path)

    return extracted


def download_wiki_node(
    user_token: str, node_token: str, out_dir: str, depth: int = 0,
) -> None:
    """Recursively download wiki node as markdown + images."""
    node = get_wiki_node(user_token, node_token)
    title = node.get("title", "Untitled")
    obj_token = node["obj_token"]
    obj_type = node.get("obj_type")
    space_id = node["space_id"]

    node_dir = os.path.join(out_dir, safe_name(title))
    os.makedirs(node_dir, exist_ok=True)

    indent = "  " * depth
    log.info("%s%s", indent, title)

    if obj_type == "docx":
        try:
            blocks = get_all_blocks(user_token, obj_token)
            md = blocks_to_markdown(blocks, title=title)
            md_path = os.path.join(node_dir, f"{safe_name(title)}.md")
            with open(md_path, "w") as f:
                f.write(md)
            log.info("%s  → %s", indent, md_path)

            # Check for images
            has_images = any(b["block_type"] == 27 for b in blocks)
            if has_images:
                img_dir = os.path.join(node_dir, "images")
                imgs = export_docx_images(user_token, obj_token, img_dir)
                if imgs:
                    log.info("%s  → %d images", indent, len(imgs))
        except Exception as exc:
            log.warning("%s  Failed: %s", indent, exc)

    # Recurse children
    if node.get("has_child"):
        children = get_wiki_children(user_token, space_id, node_token)
        for child in children:
            download_wiki_node(user_token, child["node_token"], node_dir, depth + 1)
            time.sleep(0.3)


# ── Blocks → Markdown ─────────────────────────────────────────────────────────

LANG_MAP = {
    1: "", 7: "bash", 8: "csharp", 9: "c", 10: "cpp", 11: "clojure",
    12: "coffeescript", 13: "css", 18: "dockerfile", 24: "go",
    25: "groovy", 26: "html", 28: "haskell", 29: "json", 30: "java",
    31: "javascript", 32: "julia", 33: "kotlin", 34: "latex", 35: "lisp",
    37: "lua", 38: "matlab", 39: "makefile", 40: "markdown", 41: "nginx",
    42: "objc", 44: "php", 45: "plantuml", 46: "powershell", 48: "protobuf",
    49: "python", 50: "r", 52: "ruby", 53: "rust", 55: "scala",
    56: "scss", 57: "bash", 58: "sql", 59: "swift", 61: "typescript",
    65: "xml", 66: "yaml",
}


def _render_elements(elements: list[dict], raw: bool = False) -> str:
    parts: list[str] = []
    for elem in elements:
        if "text_run" in elem:
            run = elem["text_run"]
            text = run.get("content", "")
            if not raw:
                style = run.get("text_element_style", {})
                link_url = urllib.parse.unquote(style.get("link", {}).get("url", ""))
                if style.get("bold"):
                    text = f"**{text}**"
                if style.get("italic"):
                    text = f"*{text}*"
                if style.get("inline_code"):
                    text = f"`{text}`"
                if style.get("strikethrough"):
                    text = f"~~{text}~~"
                if link_url:
                    text = f"[{text}]({link_url})"
                # {red:...} = text_color=1; other colors = background_color highlights
                tc = style.get("text_color")
                if tc == 1:
                    text = f"{{red:{text}}}"
                elif tc and tc not in (0, 5):
                    text = f"{{color={tc}:{text}}}"
                else:
                    bc = style.get("background_color")
                    if bc and bc in _BG_COLOR_REV:
                        text = f"{{{_BG_COLOR_REV[bc]}:{text}}}"
            parts.append(text)
        elif "mention_doc" in elem:
            doc = elem["mention_doc"]
            title = doc.get("title", "")
            url = doc.get("url", "")
            parts.append(f"[{title}]({url})" if url else title)
        elif "equation" in elem:
            content = elem["equation"].get("content", "")
            if content:
                parts.append(f" ${content}$ ")
        elif "mention_user" in elem:
            user_id = elem["mention_user"].get("user_id", "user")
            parts.append(f"@{user_id}")
    return "".join(parts)


def blocks_to_markdown(blocks: list[dict], title: str = "") -> str:
    block_map = {b["block_id"]: b for b in blocks}
    root = next((b for b in blocks if b["block_type"] == 1), None)
    if not root:
        return ""

    img_counter = [0]

    def render(block_id: str, prefix: str = "") -> list[str]:
        b = block_map.get(block_id)
        if not b:
            return []
        bt = b["block_type"]
        lines: list[str] = []

        if bt == 1:
            if title:
                lines += [f"# {title}", ""]
            for cid in b.get("children", []):
                lines += render(cid)
        elif bt == 2:
            text = _render_elements(b.get("text", {}).get("elements", []))
            lines += [prefix + text, ""]
        elif 3 <= bt <= 11:
            level = min(bt - 2, 6)
            key = f"heading{bt - 2}"
            hb = b.get(key, {})
            text = _render_elements(hb.get("elements", []))
            bg = hb.get("style", {}).get("background_color")
            suffix = f" {{bg={bg}}}" if bg else ""
            lines += ["", prefix + "#" * level + " " + text + suffix, ""]
        elif bt == 12:
            text = _render_elements(b.get("bullet", {}).get("elements", []))
            lines.append(prefix + "- " + text)
            for cid in b.get("children", []):
                lines += render(cid, prefix=prefix + "  ")
        elif bt == 13:
            text = _render_elements(b.get("ordered", {}).get("elements", []))
            lines.append(prefix + "1. " + text)
            for cid in b.get("children", []):
                lines += render(cid, prefix=prefix + "   ")
        elif bt == 14:
            lang_id = b.get("code", {}).get("style", {}).get("language", 0)
            lang = LANG_MAP.get(lang_id, "")
            code = _render_elements(b.get("code", {}).get("elements", []), raw=True)
            lines += ["", f"```{lang}", code.rstrip("\n"), "```", ""]
        elif bt == 15:
            text = _render_elements(b.get("quote", {}).get("elements", []))
            if text:
                lines.append(prefix + "> " + text)
            for cid in b.get("children", []):
                for line in render(cid, prefix=""):
                    lines.append(prefix + "> " + line if line.strip() else prefix + ">")
            lines.append("")
        elif bt == 16:
            eq = b.get("equation", {}).get("content", "").rstrip()
            lines += ["", "$$", eq, "$$", ""]
        elif bt == 17:
            todo = b.get("todo", {})
            text = _render_elements(todo.get("elements", []))
            done = todo.get("style", {}).get("done", False)
            checkbox = "[x]" if done else "[ ]"
            lines.append(prefix + f"- {checkbox} " + text)
            for cid in b.get("children", []):
                lines += render(cid, prefix=prefix + "  ")
        elif bt == 19:
            callout = b.get("callout", {})
            emoji = callout.get("emoji_id", "")
            bg = callout.get("background_color")
            border = callout.get("border_color")
            tc = callout.get("text_color")
            props = []
            if emoji:
                props.append(f"icon={emoji}")
            if bg is not None:
                props.append(f"bg={bg}")
            if border is not None:
                props.append(f"border={border}")
            if tc is not None:
                props.append(f"color={tc}")
            marker = " ".join(props)
            if marker:
                lines.append(f"> [!callout {marker}]")
            else:
                lines.append("> [!callout]")
            for cid in b.get("children", []):
                for line in render(cid, prefix=""):
                    lines.append("> " + line if line.strip() else ">")
            lines.append("")
        elif bt == 22:
            lines += ["", "---", ""]
        elif bt == 27:
            img_counter[0] += 1
            lines += [f"![image_{img_counter[0]}](images/image_{img_counter[0]}.png)", ""]
        elif bt == 34:
            # Quote container — render children with |> prefix
            for cid in b.get("children", []):
                for line in render(cid, prefix=""):
                    lines.append("|> " + line if line.strip() else "|>")
            lines.append("")
        elif bt in (18, 31):
            # Table: render as markdown pipe table
            tbl = b.get("table", b.get("text", {}))
            prop = tbl.get("property", {})
            num_cols = prop.get("column_size", 0)
            num_rows = prop.get("row_size", 0)
            cell_ids = tbl.get("cells", [])
            if bt == 18 and cell_ids and isinstance(cell_ids[0], list):
                flat_cells = [c for row in cell_ids for c in row]
            else:
                flat_cells = cell_ids
            rows: list[list[str]] = []
            for ri in range(num_rows):
                row: list[str] = []
                for ci in range(num_cols):
                    idx = ri * num_cols + ci
                    if idx < len(flat_cells):
                        cell_id = flat_cells[idx]
                        cell_blk = block_map.get(cell_id)
                        if cell_blk:
                            cell_parts: list[str] = []
                            for ccid in cell_blk.get("children", []):
                                cb = block_map.get(ccid)
                                if cb and cb["block_type"] == 2:
                                    cell_parts.append(
                                        _render_elements(cb.get("text", {}).get("elements", []))
                                    )
                            row.append(" ".join(cell_parts))
                        else:
                            row.append("")
                    else:
                        row.append("")
                rows.append(row)
            if rows:
                lines.append("")
                for ri, row in enumerate(rows):
                    lines.append("| " + " | ".join(row) + " |")
                    if ri == 0:
                        lines.append("|" + "|".join("---" for _ in row) + "|")
                lines.append("")
        elif bt in (24, 25):
            for cid in b.get("children", []):
                lines += render(cid, prefix=prefix)
        else:
            for cid in b.get("children", []):
                lines += render(cid, prefix=prefix)

        return lines

    return "\n".join(render(root["block_id"]))


# ── Markdown → Blocks ─────────────────────────────────────────────────────────

REVERSE_LANG_MAP: dict[str, int] = {}
for _lid, _name in LANG_MAP.items():
    if _name and _name not in REVERSE_LANG_MAP:
        REVERSE_LANG_MAP[_name] = _lid
REVERSE_LANG_MAP.update({"py": 49, "js": 31, "ts": 61, "sh": 7, "shell": 7, "yml": 66})

# Color marker content: allow nested single-level {…} so LaTeX macros like
# \boldsymbol{w} or \text{model} inside a {red:…} don't prematurely close the match.
_COLOR_CONTENT = r"(?:[^{}]|\{[^{}]*\})+"

# Inline formatting patterns (ordered by priority)
_INLINE_PATTERNS = [
    ("code", re.compile(r"`([^`]+)`")),
    ("red", re.compile(r"\{red:(" + _COLOR_CONTENT + r")\}")),
    ("green", re.compile(r"\{green:(" + _COLOR_CONTENT + r")\}")),
    ("yellow", re.compile(r"\{yellow:(" + _COLOR_CONTENT + r")\}")),
    ("orange", re.compile(r"\{orange:(" + _COLOR_CONTENT + r")\}")),
    ("blue", re.compile(r"\{blue:(" + _COLOR_CONTENT + r")\}")),
    ("purple", re.compile(r"\{purple:(" + _COLOR_CONTENT + r")\}")),
    ("equation", re.compile(r"(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)")),
    ("link", re.compile(r"\[([^\]]+)\]\(([^)]+)\)")),
    ("bold", re.compile(r"\*\*(.+?)\*\*")),
    ("italic", re.compile(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)")),
    ("strike", re.compile(r"~~(.+?)~~")),
]

# {red:...} → text_color=1 (red font color); use liberally for key points throughout a document.
# Other colors → background_color (text highlight/background, like a highlighter pen).
_BG_COLOR_MAP = {"green": 4, "yellow": 3, "orange": 2, "blue": 5, "purple": 6}
_BG_COLOR_REV = {v: k for k, v in _BG_COLOR_MAP.items()}


def _emit(text: str, style: dict, elements: list[dict]) -> None:
    if not text:
        return
    run: dict = {"content": text}
    if style:
        run["text_element_style"] = dict(style)
    elements.append({"text_run": run})


def _parse_inline_recursive(
    text: str, inherited_style: dict, elements: list[dict],
) -> None:
    pos = 0
    while pos < len(text):
        best_match = None
        best_kind = None
        best_start = len(text)
        for kind, pattern in _INLINE_PATTERNS:
            m = pattern.search(text, pos)
            if m and m.start() < best_start:
                best_match = m
                best_kind = kind
                best_start = m.start()
        if best_match is None:
            _emit(text[pos:], inherited_style, elements)
            break
        if best_start > pos:
            _emit(text[pos:best_start], inherited_style, elements)
        if best_kind == "code":
            style = {**inherited_style, "inline_code": True}
            _emit(best_match.group(1), style, elements)
        elif best_kind == "red":
            style = {**inherited_style, "text_color": 1}
            _parse_inline_recursive(best_match.group(1), style, elements)
        elif best_kind in ("green", "yellow", "orange", "blue", "purple"):
            style = {**inherited_style, "background_color": _BG_COLOR_MAP[best_kind]}
            _parse_inline_recursive(best_match.group(1), style, elements)
        elif best_kind == "equation":
            elements.append({"equation": {"content": best_match.group(1).strip(),
                             "text_element_style": {"bold": False, "inline_code": False,
                                                    "italic": False, "strikethrough": False,
                                                    "underline": False}}})
        elif best_kind == "link":
            link_text = best_match.group(1)
            link_url = best_match.group(2)
            encoded = urllib.parse.quote(link_url, safe="/:?#&=@%+")
            style = {**inherited_style, "link": {"url": encoded}}
            _parse_inline_recursive(link_text, style, elements)
        elif best_kind == "bold":
            style = {**inherited_style, "bold": True}
            _parse_inline_recursive(best_match.group(1), style, elements)
        elif best_kind == "italic":
            style = {**inherited_style, "italic": True}
            _parse_inline_recursive(best_match.group(1), style, elements)
        elif best_kind == "strike":
            style = {**inherited_style, "strikethrough": True}
            _parse_inline_recursive(best_match.group(1), style, elements)
        pos = best_match.end()


def parse_inline(text: str) -> list[dict]:
    """Parse markdown inline formatting into Feishu text elements."""
    if not text:
        return [{"text_run": {"content": ""}}]
    elements: list[dict] = []
    _parse_inline_recursive(text, {}, elements)
    return elements if elements else [{"text_run": {"content": ""}}]


def _make_text_block(block_type: int, key: str, elements: list[dict]) -> dict:
    return {"block_type": block_type, key: {"elements": elements}}


def _make_paragraph(text: str) -> dict:
    return _make_text_block(2, "text", parse_inline(text))


_HEADING_BG_RE = re.compile(r"\s*\{bg=([^}]+)\}\s*$")

# Mapping from integer bg values to Feishu API string enum names.
# The create API rejects heading bg; PATCH with string values works.
_HEADING_BG_INT_TO_STR: dict[int, str] = {
    1: "LightGrayBackground", 2: "LightRedBackground",
    3: "LightOrangeBackground", 4: "LightYellowBackground",
    5: "LightGreenBackground", 6: "LightBlueBackground",
    7: "LightPurpleBackground", 8: "PaleGrayBackground",
    9: "DarkGrayBackground", 10: "DarkRedBackground",
    11: "DarkOrangeBackground", 12: "DarkYellowBackground",
    13: "DarkGreenBackground", 14: "DarkBlueBackground",
    15: "DarkPurpleBackground",
}

# Beautiful rainbow palette for auto-coloring headings by relative depth.
# Outermost heading level → red/pink, deepening toward purple.
_HEADING_AUTO_COLORS = [
    "DarkRedBackground",     # depth 0 — red/pink (outermost)
    "DarkOrangeBackground",  # depth 1 — orange
    "DarkYellowBackground",  # depth 2 — yellow
    "DarkGreenBackground",   # depth 3 — green
    "DarkBlueBackground",    # depth 4 — blue
    "DarkPurpleBackground",  # depth 5 — purple
]


def _make_heading(level: int, text: str, bg_override: str | None = None) -> dict:
    bt = min(level + 2, 11)
    key = f"heading{min(level, 9)}"
    # Check for {bg=...} suffix (explicit wins over auto)
    bg_match = _HEADING_BG_RE.search(text)
    bg_value = None
    if bg_match:
        bg_value = bg_match.group(1)
        text = text[: bg_match.start()]
    elif bg_override:
        bg_value = bg_override
    # Auto-detect numeric prefix (e.g. "1 ", "1.1 ") and color it blue
    num_m = re.match(r'^(\d+(?:\.\d+)*\s+)', text)
    if num_m:
        num_part = num_m.group(1)
        rest = text[num_m.end():]
        elements = [{"text_run": {"content": num_part,
                     "text_element_style": {"text_color": 5}}}]
        elements.extend(parse_inline(rest))
        block = _make_text_block(bt, key, elements)
    else:
        block = _make_text_block(bt, key, parse_inline(text))
    if bg_value:
        # Resolve bg to a string enum for deferred PATCH (create API rejects heading bg)
        try:
            bg_int = int(bg_value)
            bg_str = _HEADING_BG_INT_TO_STR.get(bg_int, bg_value)
        except (ValueError, TypeError):
            bg_str = bg_value  # already a string like "LightBlueBackground"
        block["_bg_color"] = bg_str
    return block


def _make_bullet(text: str, children: list[dict] | None = None) -> dict:
    block = _make_text_block(12, "bullet", parse_inline(text))
    if children:
        block["_children"] = children
    return block


def _make_ordered(text: str, children: list[dict] | None = None) -> dict:
    block = _make_text_block(13, "ordered", parse_inline(text))
    if children:
        block["_children"] = children
    return block


def _make_code(code: str, language: str = "") -> dict:
    lang_id = REVERSE_LANG_MAP.get(language.lower(), 1) if language else 1
    return {
        "block_type": 14,
        "code": {
            "elements": [{"text_run": {"content": code}}],
            "style": {"language": lang_id},
        },
    }


def _make_quote(text: str) -> dict:
    return _make_text_block(15, "quote", parse_inline(text))


def _make_callout(children: list[dict],
                  emoji_id: str = "",
                  background_color: int | None = None,
                  border_color: int | None = None,
                  text_color: int | None = None) -> dict:
    """Create a callout block (type 19) with emoji, color, and nested children."""
    callout: dict = {}
    if emoji_id:
        callout["emoji_id"] = emoji_id
    if background_color is not None:
        callout["background_color"] = background_color
    if border_color is not None:
        callout["border_color"] = border_color
    if text_color is not None:
        callout["text_color"] = text_color
    block: dict = {"block_type": 19, "callout": callout}
    if children:
        block["_children"] = children
    return block


def _make_quote_container(children: list[dict]) -> dict:
    """Create a quote_container block (type 34) with nested children."""
    block: dict = {"block_type": 34, "quote_container": {}}
    if children:
        block["_children"] = children
    return block


_MAX_TABLE_CREATE_ROWS = 9  # Feishu API limit: 1 header + 8 data rows via create_children


def _make_table(rows: list[list[str]]) -> dict:
    """Create a table block (type 31) from parsed rows.

    Each cell's content is stored in ``_table_cells_content`` as a flat list
    of block-lists (one per cell, row-major order).  ``write_blocks_to_doc``
    fills the auto-generated cells after the table is created.

    Tables with more than _MAX_TABLE_CREATE_ROWS rows are split: the first
    _MAX_TABLE_CREATE_ROWS rows are created normally; extra rows are stored in
    ``_extra_rows`` and inserted later via InsertTableRowRequest (PATCH).

    The first row is marked as a header row with bold text.
    Column widths are distributed evenly across the page width.
    """
    num_cols = max(len(r) for r in rows) if rows else 0
    initial_rows = rows[:_MAX_TABLE_CREATE_ROWS]
    extra_rows = rows[_MAX_TABLE_CREATE_ROWS:]

    cells_content: list[list[dict]] = []
    for ri, row in enumerate(initial_rows):
        for ci in range(num_cols):
            cell_text = row[ci].strip() if ci < len(row) else ""
            if cell_text:
                para = _make_paragraph(cell_text)
                if ri == 0:  # header row — force bold on all text runs
                    for elem in para["text"]["elements"]:
                        if "text_run" in elem:
                            style = elem["text_run"].setdefault("text_element_style", {})
                            style["bold"] = True
                cells_content.append([para])
            else:
                cells_content.append([])

    result: dict = {
        "block_type": 31,
        "table": {"property": {
            "column_size": num_cols,
            "row_size": len(initial_rows),
            "header_row": True,
        }},
        "_table_cells_content": cells_content,
    }
    if extra_rows:
        extra_cells: list[list[list[dict]]] = []
        for row in extra_rows:
            row_content: list[list[dict]] = []
            for ci in range(num_cols):
                cell_text = row[ci].strip() if ci < len(row) else ""
                row_content.append([_make_paragraph(cell_text)] if cell_text else [])
            extra_cells.append(row_content)
        result["_extra_rows"] = extra_cells
    return result


def _parse_md_table(lines: list[str], start: int) -> tuple[dict | None, int]:
    """Try to parse a markdown table starting at *start*.

    Returns ``(table_block, next_line_index)`` or ``(None, start)`` if the
    lines do not form a valid table.
    """
    i = start
    table_rows: list[list[str]] = []

    while i < len(lines):
        ln = lines[i].strip()
        if not ln.startswith("|"):
            break
        # Separator row (e.g. |---|---|)
        if re.match(r"^\|[\s:_-]+(\|[\s:_-]+)+\|?\s*$", ln):
            i += 1
            continue
        cells = [c.strip() for c in ln.strip("|").split("|")]
        table_rows.append(cells)
        i += 1

    if len(table_rows) >= 1:
        return _make_table(table_rows), i
    return None, start


def _make_divider() -> dict:
    return {"block_type": 22, "divider": {}}


def _parse_list(
    lines: list[str], start: int, list_type: str,
) -> tuple[list[dict], int]:
    """Parse consecutive list items with indentation-based nesting."""
    if list_type == "bullet":
        pattern = re.compile(r"^(\s*)[-*+]\s+(.+)$")
        maker = _make_bullet
    else:
        pattern = re.compile(r"^(\s*)\d+\.\s+(.+)$")
        maker = _make_ordered

    # Collect items with indent levels
    items: list[tuple[int, str]] = []
    i = start
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            # Blank line within list — continue if next line is still a list item
            if i + 1 < len(lines) and pattern.match(lines[i + 1]):
                i += 1
                continue
            break
        m = pattern.match(line)
        if m:
            items.append((len(m.group(1)), m.group(2)))
            i += 1
        else:
            break

    def build_tree(idx: int, parent_indent: int) -> tuple[list[dict], int]:
        result = []
        while idx < len(items):
            indent, text = items[idx]
            if indent < parent_indent:
                break
            if indent == parent_indent:
                idx += 1
                children, idx = build_tree(idx, parent_indent + 2)
                result.append(maker(text, children if children else None))
            else:
                # Deeper than expected — treat as child of implicit parent
                idx += 1
                children, idx = build_tree(idx, indent + 2)
                result.append(maker(text, children if children else None))
        return result, idx

    if items:
        base = items[0][0]
        tree, _ = build_tree(0, base)
    else:
        tree = []
    return tree, i


def markdown_to_blocks(md_text: str, auto_heading_color: bool = False, image_dir: str = "") -> list[dict]:
    """Convert markdown text to a list of Feishu block dicts.

    If ``auto_heading_color`` is True, heading backgrounds are automatically
    assigned by relative depth: outermost level → red/pink, then orange,
    yellow, green, blue, purple.  Explicit ``{bg=...}`` suffixes take priority.
    """
    lines = md_text.split("\n")
    blocks: list[dict] = []
    i = 0

    # Pre-scan heading levels to compute relative depth for auto-colors.
    min_heading_level = 1
    if auto_heading_color:
        heading_levels: set[int] = set()
        for ln in lines:
            hm = re.match(r"^(#{1,9})\s+", ln.strip())
            if hm:
                heading_levels.add(len(hm.group(1)))
        min_heading_level = min(heading_levels) if heading_levels else 1

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Skip blank lines
        if not stripped:
            i += 1
            continue

        # Fenced code block
        if stripped.startswith("```"):
            lang = stripped[3:].strip()
            code_lines: list[str] = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            if i < len(lines):
                i += 1  # skip closing ```
            blocks.append(_make_code("\n".join(code_lines), lang))
            continue

        # Divider
        if re.match(r"^[-_*]{3,}\s*$", stripped):
            blocks.append(_make_divider())
            i += 1
            continue

        # Heading
        m = re.match(r"^(#{1,9})\s+(.+)$", stripped)
        if m:
            level = len(m.group(1))
            text = m.group(2).strip()
            bg_override: str | None = None
            if auto_heading_color and not _HEADING_BG_RE.search(text):
                depth = min(level - min_heading_level, len(_HEADING_AUTO_COLORS) - 1)
                bg_override = _HEADING_AUTO_COLORS[depth]
            blocks.append(_make_heading(level, text, bg_override=bg_override))
            i += 1
            continue

        # Quote container (|> prefix)
        if stripped.startswith("|> ") or stripped == "|>":
            qc_lines: list[str] = []
            while i < len(lines):
                sl = lines[i].strip()
                if sl.startswith("|> "):
                    qc_lines.append(sl[3:])
                elif sl == "|>":
                    qc_lines.append("")
                else:
                    break
                i += 1
            inner_md = "\n".join(qc_lines)
            children = markdown_to_blocks(inner_md)
            blocks.append(_make_quote_container(children))
            continue

        # Blockquote / Callout
        if stripped.startswith("> ") or stripped == ">":
            quote_lines: list[str] = []
            while i < len(lines):
                sl = lines[i].strip()
                if sl.startswith("> "):
                    quote_lines.append(sl[2:])
                elif sl == ">":
                    quote_lines.append("")
                else:
                    break
                i += 1

            # Detect callout: [!callout ...] or legacy **:emoji_name:**
            if quote_lines:
                first = quote_lines[0].strip()
                # New format: [!callout icon=X bg=N border=N color=N]
                callout_new = re.match(r"^\[!callout(?:\s+(.*?))?\]\s*$", first)
                if callout_new:
                    props: dict = {}
                    for token in (callout_new.group(1) or "").split():
                        if "=" not in token:
                            continue
                        k, v = token.split("=", 1)
                        if k == "icon":
                            props["emoji_id"] = v
                        elif k == "bg":
                            props["background_color"] = int(v)
                        elif k == "border":
                            props["border_color"] = int(v)
                        elif k == "color":
                            props["text_color"] = int(v)
                    inner_md = "\n".join(quote_lines[1:])
                    children = markdown_to_blocks(inner_md)
                    if not children:
                        children = [_make_paragraph("")]
                    blocks.append(_make_callout(children, **props))
                    continue
                # Legacy format: **:emoji_name:**
                callout_m = re.match(r"^\*\*:(\w+):\*\*\s*$", first)
                if callout_m:
                    emoji_id = callout_m.group(1)
                    inner_md = "\n".join(quote_lines[1:])
                    children = markdown_to_blocks(inner_md)
                    if not children:
                        children = [_make_paragraph("")]
                    blocks.append(_make_callout(children, emoji_id=emoji_id,
                                                background_color=2, border_color=2))
                    continue

            # Regular blockquote
            text = " ".join(ln for ln in quote_lines if ln)
            if text:
                blocks.append(_make_quote(text))
            continue

        # Bullet list
        if re.match(r"^(\s*)[-*+]\s+", line):
            list_blocks, i = _parse_list(lines, i, "bullet")
            blocks.extend(list_blocks)
            continue

        # Ordered list
        if re.match(r"^(\s*)\d+\.\s+", line):
            list_blocks, i = _parse_list(lines, i, "ordered")
            blocks.extend(list_blocks)
            continue

        # Markdown table
        if stripped.startswith("|"):
            tbl, new_i = _parse_md_table(lines, i)
            if tbl is not None:
                blocks.append(tbl)
                i = new_i
                continue

        # Display equation: $$...$$ (single-line) — e.g. $$\frac{N^2d}{B}$$
        _dbl_eq_m = re.match(r"^\$\$(.+)\$\$$", stripped)
        if _dbl_eq_m:
            eq_content = _dbl_eq_m.group(1).strip()
            if eq_content:
                blocks.append({"block_type": 2, "text": {"elements": [
                    {"equation": {"content": eq_content,
                                  "text_element_style": {"bold": False, "inline_code": False,
                                                         "italic": False, "strikethrough": False,
                                                         "underline": False}}},
                ]}})
            i += 1
            continue

        # Display equation: $$...$$ (multi-line) — rendered as text block with equation element
        # (Feishu API does not support creating block_type 16 via create blocks endpoint)
        if stripped == "$$":
            eq_lines: list[str] = []
            i += 1
            while i < len(lines) and lines[i].strip() != "$$":
                eq_lines.append(lines[i])
                i += 1
            if i < len(lines):
                i += 1  # skip closing $$
            eq_content = "\n".join(eq_lines).strip()
            if eq_content:
                blocks.append({"block_type": 2, "text": {"elements": [
                    {"equation": {"content": eq_content,
                                  "text_element_style": {"bold": False, "inline_code": False,
                                                         "italic": False, "strikethrough": False,
                                                         "underline": False}}},
                ]}})
            continue

        # Display equation: standalone line that is just $...$
        _eq_m = re.match(r"^\s*\$([^$]+)\$\s*$", stripped)
        if _eq_m:
            blocks.append({"block_type": 2, "text": {"elements": [
                {"equation": {"content": _eq_m.group(1).strip(),
                              "text_element_style": {"bold": False, "inline_code": False,
                                                     "italic": False, "strikethrough": False,
                                                     "underline": False}}},
            ]}})
            i += 1
            continue

        # Image: ![alt](path) on a standalone line
        img_m = re.match(r'^!\[([^\]]*)\]\(([^)]+)\)$', stripped)
        if img_m and image_dir:
            img_path = img_m.group(2)
            if not os.path.isabs(img_path):
                img_path = os.path.join(image_dir, img_path)
            if os.path.isfile(img_path):
                with open(img_path, "rb") as f:
                    img_bytes = f.read()
                w, h = 0, 0
                try:
                    from PIL import Image as PILImage
                    pil_im = PILImage.open(io.BytesIO(img_bytes))
                    w, h = pil_im.size
                except Exception:
                    pass
                blocks.append({"block_type": 27, "image": {},
                               "_image_data": img_bytes, "_image_width": w, "_image_height": h})
                i += 1
                continue
            else:
                log.warning("Image file not found: %s", img_path)

        # Paragraph — collect consecutive non-special lines
        para_lines: list[str] = []
        while i < len(lines):
            cl = lines[i]
            cs = cl.strip()
            if not cs:
                i += 1
                break
            if (
                cs.startswith("#")
                or cs.startswith("```")
                or cs.startswith("> ")
                or cs == ">"
                or cs == "$$"
                or cs.startswith("|")
                or re.match(r"^[-_*]{3,}\s*$", cs)
                or re.match(r"^(\s*)[-*+]\s+", cl)
                or re.match(r"^(\s*)\d+\.\s+", cl)
                or re.match(r"^\s*\$[^$]+\$\s*$", cs)
                or re.match(r'^!\[([^\]]*)\]\(([^)]+)\)$', cs)
            ):
                break
            para_lines.append(cs)
            i += 1
        if para_lines:
            blocks.append(_make_paragraph(" ".join(para_lines)))

    return blocks


# ── Write blocks to document ──────────────────────────────────────────────────


PAGE_TABLE_WIDTH = 820  # Total table width in px to fill page margin


def write_blocks_to_doc(
    user_token: str, doc_id: str, blocks: list[dict],
) -> WriteResult:
    """Write nested block dicts into a Feishu document. Returns a WriteResult with counters."""
    result = WriteResult()
    queue: list[tuple[list[dict], str]] = [(blocks, doc_id)]
    deferred_table_widths: list[tuple[str, int]] = []  # (block_id, num_cols)
    deferred_heading_bg: list[tuple[str, str]] = []  # (block_id, bg_color_str)

    failed_images: list[tuple[str, dict]] = []  # (block_id, info)
    deferred_extra_rows: list[tuple[str, int, list[list[list[dict]]]]] = []  # (table_bid, num_cols, rows)

    while queue:
        next_queue: list[tuple[list[dict], str]] = []

        for block_list, parent_id in queue:
            if not block_list:
                continue

            clean_blocks: list[dict] = []
            children_map: list[list[dict] | None] = []
            table_cells_map: list[list[list[dict]] | None] = []
            extra_rows_map: list[list[list[list[dict]]] | None] = []
            bg_color_map: list[str | None] = []
            image_data_map: list[dict | None] = []
            for b in block_list:
                children = b.pop("_children", None)
                children_map.append(children)
                table_cells = b.pop("_table_cells_content", None)
                table_cells_map.append(table_cells)
                extra_rows = b.pop("_extra_rows", None)
                extra_rows_map.append(extra_rows)
                bg_color = b.pop("_bg_color", None)
                bg_color_map.append(bg_color)
                img_info = None
                if b.get("_image_data"):
                    img_info = {
                        "data": b.pop("_image_data"),
                        "width": b.pop("_image_width", 0),
                        "height": b.pop("_image_height", 0),
                    }
                else:
                    b.pop("_image_data", None)
                    b.pop("_image_width", None)
                    b.pop("_image_height", None)
                image_data_map.append(img_info)
                clean_blocks.append(b)

            # Create in batches of 10
            insert_pos = 0
            for batch_start in range(0, len(clean_blocks), 10):
                batch = clean_blocks[batch_start : batch_start + 10]
                batch_children = children_map[batch_start : batch_start + 10]
                batch_table = table_cells_map[batch_start : batch_start + 10]
                batch_extra = extra_rows_map[batch_start : batch_start + 10]

                created = create_children(user_token, doc_id, parent_id, batch, index=insert_pos)
                result.blocks_created += len(created)
                result.blocks_failed += len(batch) - len(created)
                insert_pos += len(created)

                # Upload images for image blocks in this batch
                batch_images = image_data_map[batch_start : batch_start + 10]
                for j, new_blk in enumerate(created):
                    if j < len(batch_images) and batch_images[j] and new_blk.get("block_id"):
                        info = batch_images[j]
                        try:
                            upload_image_to_block(
                                user_token, doc_id, new_blk["block_id"],
                                info["data"], width=info["width"], height=info["height"],
                            )
                            result.images_uploaded += 1
                        except Exception as e:
                            result.images_failed += 1
                            log.warning("  Image upload failed for block %s: %s", new_blk["block_id"], e)
                            failed_images.append((new_blk["block_id"], info))

                batch_bg = bg_color_map[batch_start : batch_start + 10]
                for j, new_blk in enumerate(created):
                    # Track heading blocks for deferred bg color patching
                    if j < len(batch_bg) and batch_bg[j] and 3 <= new_blk.get("block_type", 0) <= 11:
                        deferred_heading_bg.append((new_blk["block_id"], batch_bg[j]))
                    # Track table blocks for deferred width patching
                    if new_blk.get("block_type") == 31:
                        num_cols = new_blk.get("table", {}).get("property", {}).get("column_size", 0)
                        if num_cols > 0:
                            deferred_table_widths.append((new_blk["block_id"], num_cols))
                    # Track tables with extra rows for deferred InsertTableRowRequest
                    if (j < len(batch_extra) and batch_extra[j]
                            and new_blk.get("block_type") == 31):
                        nc = new_blk.get("table", {}).get("property", {}).get("column_size", 0)
                        deferred_extra_rows.append((new_blk["block_id"], nc, batch_extra[j]))
                    # Handle table cell filling
                    if j < len(batch_table) and batch_table[j]:
                        cell_ids = new_blk.get("table", {}).get("cells", [])
                        if not cell_ids:
                            cell_ids = new_blk.get("children", [])
                        for ci, cell_id in enumerate(cell_ids):
                            if ci < len(batch_table[j]) and batch_table[j][ci]:
                                next_queue.append((batch_table[j][ci], cell_id))
                    # Handle regular children
                    elif j < len(batch_children) and batch_children[j]:
                        next_queue.append((batch_children[j], new_blk["block_id"]))

                time.sleep(0.3)

        queue = next_queue

    # Retry failed image uploads with exponential backoff
    _MAX_IMAGE_RETRIES = 3
    for attempt in range(1, _MAX_IMAGE_RETRIES + 1):
        if not failed_images:
            break
        delay = 2 ** attempt  # 2s, 4s, 8s
        log.info("Retrying %d failed image(s) (attempt %d/%d, delay %ds)…",
                 len(failed_images), attempt, _MAX_IMAGE_RETRIES, delay)
        time.sleep(delay)
        still_failed = []
        for bid, info in failed_images:
            try:
                upload_image_to_block(user_token, doc_id, bid,
                                      info["data"], width=info["width"], height=info["height"])
                result.images_failed -= 1
                result.images_uploaded += 1
                log.info("  Image retry OK for block %s", bid)
            except Exception as e:
                log.warning("  Image retry failed for block %s: %s", bid, e)
                still_failed.append((bid, info))
        failed_images = still_failed

    # Patch heading background colors (create API rejects bg; PATCH with string enum works)
    for bid, bg_str in deferred_heading_bg:
        try:
            patch_block(
                user_token, doc_id, bid,
                {"update_text_style": {
                    "style": {"background_color": bg_str},
                    "fields": [6],
                }},
            )
            log.info("  Heading bg %s: %s", bid, bg_str)
            result.bg_patches_ok += 1
        except Exception as e:
            log.warning("  Heading bg patch failed for %s: %s", bid, e)
            result.bg_patches_failed += 1
        time.sleep(0.3)

    # Patch table column widths to fill page margin
    for bid, num_cols in deferred_table_widths:
        col_w = PAGE_TABLE_WIDTH // num_cols
        all_ok = True
        for col_idx in range(num_cols):
            try:
                patch_block(
                    user_token, doc_id, bid,
                    {"update_table_property": {
                        "column_width": col_w,
                        "column_index": col_idx,
                    }},
                )
            except Exception as e:
                log.warning("  Table col %d width patch failed for %s: %s", col_idx, bid, e)
                all_ok = False
        if all_ok:
            log.debug("  Table column widths patched for %s (%d cols, %dpx each)", bid, num_cols, col_w)
            result.table_patches_ok += 1
        else:
            result.table_patches_failed += 1
        time.sleep(0.3)

    # Insert extra table rows via InsertTableRowRequest (for tables > _MAX_TABLE_CREATE_ROWS rows)
    for table_bid, num_cols, extra_rows in deferred_extra_rows:
        for row_idx, row_cells in enumerate(extra_rows):
            try:
                patch_block(user_token, doc_id, table_bid,
                            {"insert_table_row": {"row_index": -1}})
                time.sleep(0.3)
                # Get updated children list to find new cell block IDs
                table_blk = get_block(user_token, doc_id, table_bid)
                all_cell_ids = (table_blk.get("table", {}).get("cells", [])
                                or table_blk.get("children", []))
                new_cell_ids = all_cell_ids[-num_cols:] if num_cols else []
                for ci, cell_id in enumerate(new_cell_ids):
                    if ci < len(row_cells) and row_cells[ci]:
                        try:
                            create_children(user_token, doc_id, cell_id, row_cells[ci])
                            time.sleep(0.2)
                        except Exception as ce:
                            log.warning("  Extra row cell fill failed %s[%d]: %s", cell_id, ci, ce)
                log.debug("  Inserted extra row %d into table %s", row_idx, table_bid)
            except Exception as e:
                log.warning("  InsertTableRow failed for %s row %d: %s", table_bid, row_idx, e)
                result.blocks_failed += 1

    return result


def cleanup_write_empty_tails(user_token: str, doc_id: str) -> int:
    """Delete auto-created trailing empty text blocks in callouts/quote_containers/table cells after write.

    Returns the number of empty blocks deleted.
    """
    blocks = get_all_blocks(user_token, doc_id)
    bmap = {b["block_id"]: b for b in blocks}
    containers = [b for b in blocks if b["block_type"] in (19, 32, 34)]
    deleted = 0
    for c in containers:
        kids = c.get("children", [])
        if not kids:
            continue
        # Find trailing empty text blocks
        trail_start = len(kids)
        for idx in range(len(kids) - 1, -1, -1):
            kid = bmap.get(kids[idx])
            if not kid or kid["block_type"] != 2:
                break
            elems = kid.get("text", {}).get("elements", [])
            has_equation = any("equation" in e for e in elems)
            text = "".join(e.get("text_run", {}).get("content", "") for e in elems)
            if text.strip() or has_equation:
                break
            trail_start = idx
        if trail_start < len(kids):
            try:
                delete_children_tail(user_token, doc_id, c["block_id"], trail_start, len(kids))
                deleted += len(kids) - trail_start
            except Exception as e:
                log.warning("cleanup_write_empty_tails failed for container %s: %s", c["block_id"], e)
    if deleted:
        log.info("Cleaned up %d trailing empty paragraph(s)", deleted)
    return deleted


def retry_finalizer(label: str, fn, retries: int = _FINALIZE_RETRIES) -> None:
    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            fn()
            return
        except Exception as exc:
            last_exc = exc
            if attempt >= retries:
                break
            delay = min(2 ** attempt, 60)
            log.warning(
                "%s failed on attempt %d/%d: %s. Retrying in %ds …",
                label, attempt, retries, exc, delay,
            )
            time.sleep(delay)
    assert last_exc is not None
    raise last_exc


def _get_doc_nonroot_block_count(user_token: str, doc_id: str) -> int:
    blocks = get_all_blocks(user_token, doc_id)
    return len([b for b in blocks if b["block_id"] != doc_id])


def assert_doc_production_ready(
    user_token: str, doc_id: str, result: WriteResult, expected_min_blocks: int,
) -> int:
    actual_count = _get_doc_nonroot_block_count(user_token, doc_id)
    min_expected = max(1, expected_min_blocks // 2)
    problems: list[str] = []
    if actual_count < min_expected:
        problems.append(
            f"block count too low ({actual_count}, expected at least {min_expected})"
        )
    if result.blocks_failed:
        problems.append(f"{result.blocks_failed} block batch item(s) failed")
    if result.images_failed:
        problems.append(f"{result.images_failed} image upload(s) failed")
    if result.bg_patches_failed:
        problems.append(f"{result.bg_patches_failed} heading background patch(es) failed")
    if result.table_patches_failed:
        problems.append(f"{result.table_patches_failed} table width patch(es) failed")
    if problems:
        raise RuntimeError("document not production-ready: " + "; ".join(problems))
    return actual_count


def _reset_doc_root(user_token: str, doc_id: str) -> int:
    root = get_block(user_token, doc_id, doc_id)
    kids = root.get("children", [])
    if not kids:
        return 0
    delete_children_tail(user_token, doc_id, doc_id, 0, len(kids))
    return len(kids)


def write_doc_with_retries(
    user_token: str, doc_id: str, blocks: list[dict], verify: bool = False,
) -> WriteResult:
    last_exc: Exception | None = None
    for attempt in range(1, _WRITE_RETRIES + 1):
        try:
            if attempt > 1:
                deleted = _reset_doc_root(user_token, doc_id)
                if deleted:
                    log.warning(
                        "Cleared %d existing root block(s) before write retry %d/%d",
                        deleted, attempt, _WRITE_RETRIES,
                    )
            result = write_blocks_to_doc(user_token, doc_id, blocks)
            result.cleanup_deleted = cleanup_write_empty_tails(user_token, doc_id)
            if verify:
                actual_count = _get_doc_nonroot_block_count(user_token, doc_id)
                if actual_count == 0:
                    raise RuntimeError("write verification found zero non-root blocks")
            return result
        except Exception as exc:
            last_exc = exc
            actual_count = -1
            try:
                actual_count = _get_doc_nonroot_block_count(user_token, doc_id)
            except Exception as verify_exc:
                log.warning("Write verification after failure also failed: %s", verify_exc)

            if not _is_retryable_write_error(exc) or attempt >= _WRITE_RETRIES:
                if actual_count > 0:
                    log.warning(
                        "Write hit an error after page content was created (%d non-root blocks): %s",
                        actual_count, exc,
                    )
                raise

            delay = min(2 ** attempt, 60)
            if actual_count > 0:
                log.warning(
                    "Write attempt %d/%d failed after partial content was created (%d non-root blocks): %s. "
                    "Will clear and retry in %ds …",
                    attempt, _WRITE_RETRIES, actual_count, exc, delay,
                )
            else:
                log.warning(
                    "Write attempt %d/%d failed before verification succeeded: %s. Retrying in %ds …",
                    attempt, _WRITE_RETRIES, exc, delay,
                )
            time.sleep(delay)

    assert last_exc is not None
    raise last_exc


# ── Commands ──────────────────────────────────────────────────────────────────


def cmd_read(args: argparse.Namespace) -> None:
    md = _fetch_page_markdown(args.url, include_title=not args.no_title)
    sys.stdout.write(md)
    if not md.endswith("\n"):
        sys.stdout.write("\n")


def _fetch_page_markdown(url_or_token: str, include_title: bool = True) -> str:
    app_id, app_secret = _get_credentials()
    user_token = get_valid_user_token(app_id, app_secret)
    node_token = parse_node_token(url_or_token)

    node = get_wiki_node(user_token, node_token)
    obj_token = node["obj_token"]
    obj_type = node.get("obj_type")
    title = node.get("title", "Untitled")

    if obj_type != "docx":
        print(f"Error: only docx pages supported (got {obj_type})", file=sys.stderr)
        raise SystemExit(1)

    blocks = get_all_blocks(user_token, obj_token)
    return blocks_to_markdown(blocks, title="" if not include_title else title)


def cmd_diff(args: argparse.Namespace) -> None:
    left_md = _fetch_page_markdown(args.left, include_title=not args.no_title)
    right_md = _fetch_page_markdown(args.right, include_title=not args.no_title)

    if args.normalize:
        left_md, _ = normalize_markdown_for_feishu(left_md)
        right_md, _ = normalize_markdown_for_feishu(right_md)

    left_lines = left_md.splitlines()
    right_lines = right_md.splitlines()
    diff = difflib.unified_diff(
        left_lines,
        right_lines,
        fromfile=args.left,
        tofile=args.right,
        lineterm="",
        n=args.context,
    )
    out = "\n".join(diff)
    if out:
        sys.stdout.write(out)
        if not out.endswith("\n"):
            sys.stdout.write("\n")
    else:
        print("No differences found.")


def cmd_write(args: argparse.Namespace) -> None:
    app_id, app_secret = _get_credentials()
    user_token = get_valid_user_token(app_id, app_secret)
    parent_node_token = parse_node_token(args.parent)

    parent_node = get_wiki_node(user_token, parent_node_token)
    space_id = parent_node["space_id"]

    input_file = getattr(args, "input_file", None)
    if input_file:
        with open(input_file, "r", encoding="utf-8") as fh:
            md_text = fh.read()
    else:
        md_text = sys.stdin.read()
    if not md_text.strip():
        print("Error: no markdown content (stdin was empty or file was empty)", file=sys.stderr)
        raise SystemExit(1)

    md_text, norm_report = normalize_markdown_for_feishu(md_text)
    if norm_report.metadata_blocks_removed:
        print(f"  Normalized     : removed {norm_report.metadata_blocks_removed} duplicate metadata block(s)", file=sys.stderr)
    if norm_report.table_separator_rows_normalized:
        print(f"  Normalized     : rewrote {norm_report.table_separator_rows_normalized} table separator row(s)", file=sys.stderr)
    for warning in norm_report.warnings:
        print(f"  Warning        : {warning}", file=sys.stderr)

    # Determine title
    title = args.title
    if not title:
        m = re.match(r"^#\s+(.+)", md_text.strip())
        title = m.group(1).strip() if m else "Untitled"

    log.info("Creating wiki page: %s", title)
    blocks = markdown_to_blocks(md_text, auto_heading_color=getattr(args, "heading_color", False),
                               image_dir=getattr(args, "image_dir", "") or "")
    blocks_parsed = len(blocks)
    # Skip the first block if it's a heading matching the title (avoid duplicate)
    if blocks and blocks[0].get("block_type") == 3:
        h1_content = blocks[0].get("heading1", {}).get("elements", [])
        if h1_content:
            h1_text = "".join(e.get("text_run", {}).get("content", "") for e in h1_content)
            if h1_text.strip() == title.strip():
                blocks = blocks[1:]
                blocks_parsed = len(blocks)

    log.info("Parsed %d blocks from markdown", blocks_parsed)

    node_token, doc_id = create_wiki_node(user_token, space_id, parent_node_token, title)
    log.info("Created node: https://my.feishu.cn/wiki/%s", node_token)

    result = write_doc_with_retries(
        user_token, doc_id, blocks, verify=getattr(args, "verify", False),
    )
    log.info("Wrote %d blocks", result.blocks_created)
    actual_count = assert_doc_production_ready(user_token, doc_id, result, blocks_parsed)

    # ── Write summary ──────────────────────────────────────────────────────────
    print("Write summary:", file=sys.stderr)
    print(f"  Blocks created : {result.blocks_created}", file=sys.stderr)
    print(f"  Blocks present : {actual_count}", file=sys.stderr)
    print(f"  Blocks failed  : {result.blocks_failed}", file=sys.stderr)
    if deferred_bg := result.bg_patches_ok + result.bg_patches_failed:
        print(f"  Heading BG     : {result.bg_patches_ok} ok, {result.bg_patches_failed} failed", file=sys.stderr)
    if deferred_tbl := result.table_patches_ok + result.table_patches_failed:
        print(f"  Table patches  : {result.table_patches_ok} ok, {result.table_patches_failed} failed", file=sys.stderr)
    if result.images_uploaded or result.images_failed:
        print(f"  Images         : {result.images_uploaded} ok, {result.images_failed} failed", file=sys.stderr)
    if result.cleanup_deleted:
        print(f"  Cleanup removed: {result.cleanup_deleted} trailing empty paragraph(s)", file=sys.stderr)
    if result.blocks_failed or result.bg_patches_failed or result.table_patches_failed or result.images_failed:
        print("WARNING: some operations failed — check log output above", file=sys.stderr)

    # ── Optional post-write verification ──────────────────────────────────────
    if getattr(args, "verify", False):
        expected = result.blocks_created
        print(f"Verification: found {actual_count} blocks in created page (expected ~{expected})", file=sys.stderr)
        if actual_count == 0 or actual_count < expected // 2:
            print("WARNING: block count is suspiciously low — write may be incomplete", file=sys.stderr)
            print(f"https://my.feishu.cn/wiki/{node_token}")
            raise SystemExit(1)

    print(f"https://my.feishu.cn/wiki/{node_token}")

    if result.blocks_failed:
        raise SystemExit(1)


def cmd_copy(args: argparse.Namespace) -> None:
    app_id, app_secret = _get_credentials()
    token_mgr = TokenManager(app_id, app_secret)
    user_token = token_mgr.get()
    source_node_token = parse_node_token(args.source)
    target_node_token = parse_node_token(args.target)

    target_node = get_wiki_node(user_token, target_node_token)
    target_space_id = target_node["space_id"]

    src_node = get_wiki_node(user_token, source_node_token)
    source_space_id = src_node["space_id"]

    node_map: dict[str, str] = {}
    doc_map: dict[str, str] = {}
    obj_map: dict[str, str] = {}

    if args.recursive:
        log.info("Recursively copying %s → %s …", source_node_token, target_node_token)
        total = copy_recursive(
            token_mgr,
            source_node_token, source_space_id,
            target_space_id, target_node_token,
            title=args.title, heading_numbering=args.heading_numbers,
            node_map=node_map, doc_map=doc_map, obj_map=obj_map,
        )
        log.info("Done — %d page(s) copied", total)
        if args.fix_refs and node_map:
            fixup_references(token_mgr, node_map, obj_map, doc_map)
    else:
        log.info("Copying %s → %s …", source_node_token, target_node_token)
        new_nt, new_doc = copy_single_page(
            token_mgr,
            source_node_token, target_space_id, target_node_token,
            title=args.title, heading_numbering=args.heading_numbers,
            node_map=node_map, doc_map=doc_map, obj_map=obj_map,
        )
        if new_nt:
            print(f"https://my.feishu.cn/wiki/{new_nt}")
            log.info("Done → https://my.feishu.cn/wiki/%s", new_nt)


def cmd_sync(args: argparse.Namespace) -> None:
    app_id, app_secret = _get_credentials()
    token_mgr = TokenManager(app_id, app_secret)
    user_token = token_mgr.get()
    source_node_token = parse_node_token(args.source)
    target_node_token = parse_node_token(args.target)

    src_node = get_wiki_node(user_token, source_node_token)
    source_space_id = src_node["space_id"]

    target_node = get_wiki_node(user_token, target_node_token)
    target_space_id = target_node["space_id"]

    fix_refs = not args.no_fix_refs

    sync_recursive(
        token_mgr,
        source_node_token, source_space_id,
        target_space_id, target_node_token,
        heading_numbering=args.heading_numbers,
        fix_refs=fix_refs, title=args.title,
    )


def cmd_export(args: argparse.Namespace) -> None:
    app_id, app_secret = _get_credentials()
    user_token = get_valid_user_token(app_id, app_secret)
    node_token = parse_node_token(args.source)

    out_dir = args.output
    os.makedirs(out_dir, exist_ok=True)
    log.info("Exporting %s → %s", node_token, out_dir)
    download_wiki_node(user_token, node_token, out_dir)
    log.info("Done.")


def cmd_info(args: argparse.Namespace) -> None:
    app_id, app_secret = _get_credentials()
    user_token = get_valid_user_token(app_id, app_secret)
    node_token = parse_node_token(args.url)

    node = get_wiki_node(user_token, node_token)
    print(f"Title:      {node.get('title', 'Untitled')}")
    print(f"Node token: {node.get('node_token')}")
    print(f"Obj token:  {node.get('obj_token')}")
    print(f"Obj type:   {node.get('obj_type')}")
    print(f"Space ID:   {node.get('space_id')}")
    print(f"Has child:  {node.get('has_child', False)}")


def _get_credentials() -> tuple[str, str]:
    app_id = os.getenv("FEISHU_APP_ID")
    app_secret = os.getenv("FEISHU_APP_SECRET")
    if not app_id or not app_secret:
        print("Error: Set FEISHU_APP_ID and FEISHU_APP_SECRET in .env or ~/.config/feishu_tools/.env", file=sys.stderr)
        raise SystemExit(1)
    return app_id, app_secret


# ── Main ──────────────────────────────────────────────────────────────────────


def main() -> None:
    # Load .env: current dir first, then ~/.config/feishu_tools/
    for env_path in [".env", os.path.join(_CONFIG_DIR, ".env")]:
        if os.path.exists(env_path):
            load_dotenv(env_path)
            break

    parser = argparse.ArgumentParser(
        prog="feishu_tool",
        description="Standalone Feishu wiki tool: read, diff, write, copy, sync, export",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")
    subparsers = parser.add_subparsers(dest="command")

    # read
    p_read = subparsers.add_parser("read", help="Read wiki page as markdown")
    p_read.add_argument("url", help="Wiki URL or node token")
    p_read.add_argument("--no-title", action="store_true", help="Omit H1 title")
    p_read.set_defaults(func=cmd_read)

    # diff
    p_diff = subparsers.add_parser("diff", help="Diff two wiki pages as markdown")
    p_diff.add_argument("left", help="Left wiki URL or node token")
    p_diff.add_argument("right", help="Right wiki URL or node token")
    p_diff.add_argument("--no-title", action="store_true", help="Omit H1 title before diffing")
    p_diff.add_argument("--context", type=int, default=3, help="Unified diff context lines")
    p_diff.add_argument("--normalize", action="store_true",
                        help="Normalize markdown before diffing to reduce noisy formatting diffs")
    p_diff.set_defaults(func=cmd_diff)

    # write
    p_write = subparsers.add_parser("write", help="Create wiki page from stdin markdown")
    p_write.add_argument("parent", help="Parent wiki URL or node token")
    p_write.add_argument("--title", help="Page title (default: from first H1)")
    p_write.add_argument("--heading-color", action="store_true",
                         help="Auto-color heading backgrounds by depth (red→orange→yellow→…)")
    p_write.add_argument("--image-dir",
                         help="Directory to resolve relative image paths from (for ![alt](path) in markdown)")
    p_write.add_argument("--verify", action="store_true",
                         help="Read back the created page and verify block count after writing")
    p_write.add_argument("--input-file", "-f",
                         help="Read markdown from FILE instead of stdin")
    p_write.set_defaults(func=cmd_write)

    # copy
    p_copy = subparsers.add_parser("copy", help="Copy wiki page(s)")
    p_copy.add_argument("source", help="Source wiki URL or node token")
    p_copy.add_argument("target", help="Target parent wiki URL or node token")
    p_copy.add_argument("--title", help="Custom page title")
    p_copy.add_argument("-r", "--recursive", action="store_true", help="Copy all subpages")
    p_copy.add_argument("-n", "--numbers", action="store_true", dest="heading_numbers", help="Add auto-numbered headings")
    p_copy.add_argument("--fix-refs", action="store_true", help="Fix internal references")
    p_copy.set_defaults(func=cmd_copy)

    # sync
    p_sync = subparsers.add_parser("sync", help="Incremental sync wiki tree")
    p_sync.add_argument("source", help="Source wiki URL or node token")
    p_sync.add_argument("target", help="Target parent wiki URL or node token")
    p_sync.add_argument("--title", help="Custom root page title")
    p_sync.add_argument("-n", "--numbers", action="store_true", dest="heading_numbers", help="Add auto-numbered headings")
    p_sync.add_argument("--no-fix-refs", action="store_true", help="Skip reference remapping")
    p_sync.set_defaults(func=cmd_sync)

    # export
    p_export = subparsers.add_parser("export", help="Export wiki page to markdown")
    p_export.add_argument("source", help="Wiki URL or node token")
    p_export.add_argument("-o", "--output", default="wiki_output", help="Output directory")
    p_export.set_defaults(func=cmd_export)

    # info
    p_info = subparsers.add_parser("info", help="Show wiki page info")
    p_info.add_argument("url", help="Wiki URL or node token")
    p_info.set_defaults(func=cmd_info)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        raise SystemExit(1)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(message)s",
        stream=sys.stderr,
    )

    args.func(args)


if __name__ == "__main__":
    main()
