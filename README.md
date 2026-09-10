# dsh-es

Whole-disk NTFS file discovery for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), backed by [Everything](https://www.voidtools.com/)'s index through `es.exe`.

The harness' own `glob`/`grep` are confined to the workspace. This plugin adds `es_search`, which answers "where on this machine is …" from the Everything index in milliseconds — across every indexed volume — and speaks **POSIX paths in both directions**, so a Windows backslash never has to survive a JSON/tool-call escape layer.

## Requirements

- Windows with Everything 1.4+ **running** (it owns the index; `es.exe` is only a client).
- `es.exe` on `PATH` (ships with Everything; or point at it with `config.executable`).

## Install

```sh
pnpm install
dsh plugin --profile web add .
```

Then restart the profile (`dsh web`). Restarting is required: the bundle layer is composed at boot. `dsh plugin add` records the dependency and appends `dsh-es` to `dsh.profile.bundles` automatically, because this package declares `dsh.bundle.patch`.

Verify the composed tree without booting:

```sh
dsh --profile web --dump-config | Select-String es-search
```

## Configure

Defaults live in [`cordis.patch.yml`](cordis.patch.yml). Override the row from your profile's own `cordis.patch.yml` (it is applied last):

```yaml
- id: es-search
  config:
    executable: 'C:/Program Files/Everything/es.exe'
    maxResults: 500
```

| Key | Default | Meaning |
|---|---|---|
| `executable` | `es.exe` | Bare name resolved on `PATH`, or an absolute path. |
| `maxResults` | `200` | Default page size when the model omits `max` (hard cap 1000). |

## The `es_search` tool

| Parameter | Meaning |
|---|---|
| `query` (required) | Everything query text: plain words match the file **name** (space-separated words are ANDed), `*.zip` / `report?.docx` are wildcards, filters combine: `ext:md handbook`, `size:>1gb ext:iso`, `dm:today folder:downloads`, `parent:D:/projects report`. |
| `path` | Restrict to a folder and below, POSIX-style. Relative paths resolve against the session cwd. |
| `max` | Page size (default `maxResults`, hard cap 1000). |
| `regex` | Use `es.exe -r` (Everything regex) instead of query syntax. |
| `matchPath` | Match the query against the whole path, not just the file name (`es.exe -p`). |
| `kind` | `any` (default), `files` (`/a-d`), `folders` (`/ad`). |
| `sort` | `name`, `path`, `size`, `extension`, `date-modified`, `date-created`, `date-accessed`, `run-count`, each with a `-descending` variant. |

Returns `{ query, results, count, max, truncated }`, `results` in POSIX form.

### Path convention

| Direction | Example |
|---|---|
| In (`path`) | `D:/ros/proj`, `/d/ros/proj` (MSYS), `//server/share/proj`, `D:\ros\proj` are all accepted; relative resolves against the session cwd. |
| Out (`results`) | `D:/ros/proj/app.ts` — forward slashes, drive letter kept. |

The drive letter is kept rather than rewritten to `/d/...` on purpose: `D:/x` is a valid path for every other dsh tool (Node, PowerShell, `read`, `edit`, `glob`) on Windows, while `/d/x` is not, and rewriting would make results unusable as follow-up arguments.

## Caveats

- **Index facts, not a live scan.** A file created seconds ago may not be listed yet; Everything catches up from the NTFS USN journal within moments.
- **Everything must be running.** Otherwise `es.exe` exits 8 with `Error 8: Everything IPC window not found`, surfaced verbatim as the tool error.
- **Regex is unreliable on Everything 1.4.** With `-r`, anchored patterns such as `zip$` return zero rows *silently* (exit 0) on a 1.4 install; prefer Everything wildcards (`*.zip`). Metacharacter-free patterns do work.
- **A query starting with `-`** is read by `es.exe` as a switch; the tool rejects it up front with that hint. Search for such a name with a wildcard instead (`*-report.txt`).
- Hits outside the workspace are readable only by tools allowed to reach them; the sandbox still applies to whatever you do next.
- Volumes appear only if Everything indexes them (NTFS by default; exFAT/network folders must be added to its index).

## How it runs

One `ctx.subprocess.spawn` per call with an argv vector — no shell, so nothing in a model-supplied query is quoted or interpreted — plus `resolveExecutable` for the es.exe lookup and the abort signal forwarded from the cooperative tool timeout (30 s). Exit 0 is success even with zero results; every other exit code becomes the tool error with es.exe's own first output line.

## Verify

```sh
npm test
```

Covers the pure layer (path translation both ways, argv assembly, CRLF/BOM/duplicate-tolerant parsing) and one live `es.exe` round trip that skips itself when Everything or es.exe is unavailable. The spawn writes through a file descriptor rather than a pipe, so the check also runs under the harness' own Windows sandbox.
