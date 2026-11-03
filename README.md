# dsh-es

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 加一个全盘文件名搜索工具 `es_search`，底层用 [Everything](https://www.voidtools.com/) 的索引，通过它的命令行客户端 `es.exe` 查询。

## 为什么需要它

harness 自带的 `glob` / `grep` 被限制在工作区内，跨盘、跨目录找文件只能靠猜路径。Everything 已经在这些卷上建好了完整索引，`es_search` 只是把索引查询包装成一个模型工具：问「这台机器上哪里有 …」，一次调用就能拿到结果。

## 依赖

- Windows，且 **Everything 正在运行**（索引在它手里，`es.exe` 只是客户端）。
- `es.exe`：随 Everything 附带。默认按 `PATH` 上的 `es.exe` 查找，否则用配置项 `executable` 指定绝对路径。

## 安装

```sh
pnpm install
dsh plugin --profile web add .
```

然后重启该 profile（例如 `dsh web`）。重启是必须的：bundle 层在启动时组装。`dsh plugin add` 会自动记录依赖并把 `dsh-es` 加进 profile 的 `dsh.profile.bundles`，因为本包声明了 `dsh.bundle.patch`。

不启动也能验证组装结果：

```sh
dsh --profile web --dump-config
```

输出里应能看到 `es-search` 这一行，且其 `config` 只有 `executable`。

## 配置

默认值在 [`cordis.patch.yml`](cordis.patch.yml)。需要覆盖时，在 profile 自己的 `cordis.patch.yml` 里重写这一行（它最后生效）：

```yaml
- id: es-search
  config:
    executable: 'C:/Program Files/Everything/es.exe'
```

| 键 | 默认值 | 含义 |
|---|---|---|
| `executable` | `es.exe` | `es.exe` 的路径覆盖点：可以只是 `PATH` 上的名字，也可以是绝对路径。 |

## 参数

| 参数 | 类型 | 默认值 | 备注 |
|---|---|---|---|
| `query` | string，必填 | — | Everything 查询语法。 |
| `page` | int | `1` | 要返回第几页，每页固定 100 条。 |
| `style` | `posix` \| `msys` \| `wsl` | `posix` | 返回路径的风格。 |
| `sort` | string | `null`（不传） | `es.exe -sort` 的字段名，可带 `-ascending` / `-descending` 后缀；省略或传 `null` 就用索引默认顺序。 |
| `type` | `all` \| `folder` \| `file` | `all` | 搜索类型：无开关 / `/ad` / `/a-d`。 |

调用示例：

```json
{ "query": "ext:md handbook", "page": 2, "style": "msys", "sort": "date-modified-descending", "type": "file" }
```

## 输出

工具返回纯文本（无 JSON）：

```
count: 36984
page: 1 / 370
results:
D:/ros/x/a.md
D:/ros/y/b.md
```

- `count` 是查询命中总数，`page` 是「当前页 / 总页数」，`results:` 之后每行一个路径。
- 没有结果时 `results:` 后为空，`page` 显示 `1 / 1`。
- 分页：先从 `es.exe` 取总数（`-get-result-count`），再取该页（`-n 100 -o (page-1)*100`），因此每页固定 100 条；`page` 超出范围时会被夹到最后一页。
- 每次调用最多 spawn 两次 `es.exe`：一次取总数，一次取本页（`count` 为 0 时只跑取总数那一次）。

### 路径风格

| `style` | 示例 |
|---|---|
| `posix`（默认） | `D:/ros/x/a.md` |
| `msys` | `/d/ros/x/a.md` |
| `wsl` | `/mnt/d/ros/x/a.md` |

UNC 路径在任何风格下都是 `//server/share/x`。

## 查询语法

常用语法（通配符、反选、`ext:`、`size:`、`date-modified:`、`path:`、`parent:`、`case:`、`regex:` 等）见随包分发的速查表 [`docs/search-syntax.md`](docs/search-syntax.md)。

工具描述里给出的是安装后该文件的**绝对路径**：插件运行时用 `import.meta.url` 解析出包内 `docs/search-syntax.md` 的真实位置，所以模型拿到的是本机可直接读取的路径，而不是一个相对路径。

几条最常用的：

| 写法 | 含义 |
|---|---|
| `*.zip`、`report?.docx` | 通配符，只匹配文件名。 |
| `ext:md handbook` | 按扩展名 + 文件名过滤（空格 = AND）。 |
| `!draft` | 反选，排除带 `draft` 的项。 |
| `size:>1gb` | 体积大于 1 GB。 |
| `dm:today` / `dc:thisweek` | 修改时间 / 创建时间。 |
| `path:D:/ros/proj` | 路径包含该片段。 |
| `parent:D:/projects report` | 限定在该目录下。 |
| `case:READ ME.txt` | 区分大小写。 |
| `regex:` | 正则，Everything 1.4 上锚定模式可能静默返回空，优先用通配符。 |

## 限制与坑

- **是索引事实，不是实时扫描。** 刚创建的文件可能还没进索引；Everything 会从 NTFS USN 日志很快补上。
- **Everything 必须运行。** 否则 `es.exe` 以退出码 8 退出（`Everything IPC window not found`），插件会把这句本地化后回给会话。`es.exe` 缺失、以及其他非 0 退出码同样会带原文回会话（按系统 locale 输出中文或英文）。
- **不支持 `dupe:` 系列操作符**（`dupe:`、`dupe-from:`、`dupe-count:`、`dupe-min:`、`dupe-max:`）。全量尺寸/哈希比对太慢，`query` 里出现即被直接拒绝并报错。
- **不传 `sort` 时，分页顺序由索引决定。** 翻页期间索引若发生变动，页与页之间可能出现轻微重排；需要稳定顺序就显式给 `sort`。
- **工作区外的命中仍受后续工具沙箱限制。** 搜索能列出它们，不代表 `read` / `edit` 能打开。
- 只有 Everything 索引了的卷才有结果（NTFS 默认建索引，exFAT/网络共享需自行加入）。
