# Everything 搜索语法速查表

## 1. 基本语法

单个搜索项（search term）的结构：

```
[!][search-modifier:][search-function:]<text>
```

- `!`：可选取反，排除紧跟其后的搜索项。
- `search-modifier:`：可选，控制**如何匹配**（见第 2 节），可叠加多个。
- `search-function:`：可选，搜索某个具体属性，如日期、大小（见第 3 节）。
- `text`：文本，或由函数解释的值。不带函数时匹配**文件名/文件夹名**；开启 Match Path 后匹配完整路径。

多个搜索项用操作符组合：`<search-term> <operator> <search-term> ...`

### 1.1 操作符

| 操作符 | 含义 | 示例 |
| --- | --- | --- |
| 空格 | AND，同时满足 | `abc 123` |
| `\|` | OR，满足其一（`\|` 两侧空格被忽略） | `abc\|123`、`*.jpg \| *.png` |
| `!` | NOT，排除紧跟其后的项 | `!abc` |
| `< >` | 分组，改变求值顺序 | `!<abc 123>` |
| `" "` | 引号包裹，内部（含操作符）全部按纯文本处理 | `"C:\Program Files"` |

默认 **OR 优先于 AND**：`apple banana | orange` 等于 `apple AND (banana OR orange)`；想反过来用 `< >` 分组：`<apple banana> | orange`。优先级可在 Search Options 里改，也可用 `and-precedence:` / `or-precedence:` 修饰符临时改。

### 1.2 通配符

| 通配符 | 含义 |
| --- | --- |
| `*` | 匹配零或多个字符，但不含 `\` |
| `**` | 匹配零或多个字符（含 `\`） |
| `?` | 匹配单个字符，但不含 `\` |

使用通配符时匹配的是**整个文件名**：`*.mp3`、`foo*`（以 foo 开头）、`*foo*`（含 foo）、`stem:*bar`（名称以 bar 结尾，忽略扩展名）。

### 1.3 宏

| 宏 | 含义 |
| --- | --- |
| `audio:` | 音频文件 |
| `doc:` | 文档文件 |
| `exe:` | 可执行文件 |
| `image:` | 图片文件 |
| `video:` | 视频文件 |
| `zip:` | 压缩文件 |

`audio:|video:` 匹配音频或视频；宏可按用户自定义扩展。

### 1.4 字符实体（转义会被解析的字符）

| 实体 | 含义 |
| --- | --- |
| `&sp:` | 字面空格 |
| `&vert:` | 字面竖线 `\|` |
| `&excl:` | 字面感叹号 `!` |
| `&lt:` | 字面 `<` |
| `&gt:` | 字面 `>` |
| `&quot:` | 字面双引号 `"` |
| `&#<n>:` | 十进制 Unicode 字符 |
| `&#x<n>:` | 十六进制 Unicode 字符 |

例：`C:\Program&sp:Files`、`content:&quot:foo&quot:`。

### 1.5 文件名组成部分

| 组成部分 | 示例值 |
| --- | --- |
| Full Path 完整路径 | `C:\folder\file.txt` |
| Name 名称 | `file.txt` |
| Path 所在目录 | `C:\folder` |
| Stem 去扩展名的名称 | `file` |
| Extension 扩展名 | `txt` |

## 2. 搜索修饰符

作用于**单个搜索项**，写法：`search-modifier:[search-function:]<text>`。

- 前缀 `no-` 关闭该修饰符：`no-path:abc`。
- 后缀 `*` 把余下内容当纯文本，不再解析：`regex*:^foo bar$`（空格不再当 AND）。
- 前缀 `::` 强制使用内置修饰符，绕过用户自定义：`::case:`。
- 前缀 `?` 对余下整个查询全局生效：`?case: FOO BAR` 等于 `case:FOO case:BAR`。
- 可作用于 `< >` 分组：`case:<FOO BAR>` 等于 `case:FOO case:BAR`。
- 修饰符名里的连字符可省略：`no-whole-words:` 等于 `nowholewords:`。
- 默认不写修饰符时，按 Search 菜单里的当前设置做部分匹配。

### 2.1 文本匹配

| 修饰符 | 作用 | 示例 |
| --- | --- | --- |
| `case:` / `no-case:` | 开启/关闭区分大小写 | `case:WINDOWS` |
| `diacritics:` / `no-diacritics:`（别名 `diac:`） | 匹配/忽略重音符号 | `diacritics:"Déjà Vu"` |
| `ignore-punctuation:` / `no-ignore-punctuation:`（别名 `nopunc:`） | 忽略标点 | `ignore-punctuation:spiderman` 匹配 `spider-man` |
| `ignore-whitespace:` / `no-ignore-whitespace:`（别名 `nows:`） | 忽略空白 | `ignore-whitespace:spiderman` 匹配 `spider man` |

### 2.2 文件与文件夹

| 修饰符 | 作用 | 示例 |
| --- | --- | --- |
| `file:` | 只匹配文件 | `file: .mp3` |
| `folder:` | 只匹配文件夹 | `folder:music` |

### 2.3 名称与属性值匹配

| 修饰符 | 作用 | 示例 |
| --- | --- | --- |
| `path:` / `no-path:`（别名 `\:`） | 对完整路径匹配 / 只对名称匹配 | `path:system32 hosts` |
| `prefix:` / `no-prefix:` | 匹配词首 | `prefix:ever` |
| `suffix:` / `no-suffix:` | 匹配词尾 | `suffix:hosts` |
| `start-with:`（别名 `^:`） | 匹配开头 | `startwith:ever` |
| `end-with:`（别名 `$:`） | 匹配结尾 | `endwith:hosts` |
| `whole:`（别名 `whole-filename:` `wfn:` `entire:`） | 整个名称/整个属性值匹配 | `whole:hosts` |
| `whole-words:` / `no-whole-words:`（别名 `ww:`） | 整词匹配 | `whole-words:foo` |
| `multi-string:` / `no-multi-string:` | 分号分隔的多值属性按多个字符串分别匹配 / 视为单个字符串 | `nomultistring:zipfilename:"abc.txt;123.txt"` |
| `all-strings:` | 多值属性的**每个**值都要匹配 | `all-strings:author:john;"jane doe"` |

### 2.4 内容匹配

| 修饰符 | 作用 | 示例 |
| --- | --- | --- |
| `each-line:` | 逐行匹配内容，命中某行即停（默认匹配整个内容） | `eachline:content:<a b>` |
| `binary:` | 把搜索文本与文件内容当字节流，`\x00`-`\xff` 表示字节 | `binary:content:\x00\x00\x01\x10` |
| `hex:` | 把 2 位十六进制转成单字节，按字节流处理 | `hex:48656C6C6F` |

### 2.5 搜索模式

| 修饰符 | 作用 | 示例 |
| --- | --- | --- |
| `regex:` | 启用正则；会吃掉所有 `\|`，需要字面量时用 `regex*:` | `regex:^\d\d\d\d`、`regex:content:gr(a\|e)y` |
| `len:` | 按文件名/属性值的 UTF-16 长度比较 | `len:>20`、`path:len:>259` |
| `wildcards:` / `no-wildcards:` | 启用扩展通配符（`#` 数字、`[a-m]` 集合、`[!...]` 取反、`\` 转义）/ 完全关闭通配符 | `wildcards:####*`、`no-wildcards:?` |
| `star-all:` | `*` 是否跨路径分隔符匹配 | `starall:c:*abc.txt` |
| `pinyin:`（别名 `py:`） | 全拼匹配中文 | `pinyin:nihao` 匹配「你好」 |
| `pinyin-jian:`（别名 `pyj:`）/ `pinyin-quan:`（别名 `pyq:`） | 单字母拼音 / 全拼 | `pinyin-jian:nh` |
| `soundex:` | 按 SQL soundex 匹配（仅 A-Z/a-z） | `soundex:david` |
| `to-string:` | 把属性值当文本比较 | `tostring:date-modified:/02/` |
| `to-integer:` | 把值当整数比较 | `to-integer:album:>10` |
| `to-number:`（别名 `#:`） | 把值当实数比较 | `to-number:album:>1.5` |
| `metric:` / `no-metric:` | `1kb` = 1000 字节（默认 JEDEC：`1kb` = 1024） | `metric:size:1kb` |
| `from-disk:` | 属性/内容读磁盘而不是读索引 | `fromdisk:length:>5m` |
| `dot-all:` / `multi-line:` / `global:` / `ungreedy:` | 正则选项：`.` 匹配换行、`^$` 按行、匹配全部出现、量词默认懒惰 | `dotall:regex:content:"line 1.*line 2"` |
| `no-fast-regex:` | 关闭正则优化（要用 match 0 捕获时） | `no-fast-regex:regex:abc123 regexmatch0:123` |
| `no-substitute:` | 关闭 `$property:` 属性替换 | `no-substitute:$extension:` |

### 2.6 结果管理与解析

| 修饰符 | 作用 | 示例 |
| --- | --- | --- |
| `search-current-results:` / `no-search-current-results:` | 强制在/不在当前结果内搜索 | `no-search-current-results: dm:5mins` |
| `enable-result-omissions:` / `disable-result-omissions:` | 全局启用/禁用结果省略 | — |
| `enable-temp-result-omissions:` / `disable-temp-result-omissions:` | 全局启用/禁用临时结果省略 | — |
| `no-highlight:` | 该搜索项不高亮 | `no-highlight:path:foo` |
| `no-!:` | 禁用取反操作符 | `no-!:!readme.txt` |
| `and-precedence:` / `or-precedence:` | 让 AND 先算 / 让 OR 先算 | `?and-precedence: sonic tails \| mario luigi` |
| `no-reorder:` | 关闭搜索项按速度重排序 | `noreorder:content:^foo bar.txt` |
| `and-filter:` / `or-filter:` / `menu-break:` / `menu-separator:` | 仅用于过滤器/书签定义，对搜索本身无效 | `and-filter: d:\|e:` |

## 3. 搜索函数

写法：`[search-modifier:]function:value`。函数名里的连字符可省略（`datemodified:` = `date-modified:`）。

- 值含操作符时用双引号包裹：`artist:"John Doe"`。
- 函数名后加 `*` 把余下内容当纯文本：`content*:<div class="menu">`。
- **空值**匹配任意非零数值或任意非空文本值。

### 3.1 数值/日期比较操作符

| 写法 | 含义 |
| --- | --- |
| `function:<=value` / `function:<value` | 小于等于 / 小于 |
| `function:value` | 按该值的**粒度**表示相等：`size:1kb` = `size:1024..2047` |
| `function:==value` / `function:=value` | 精确等于：`size:=1kb` = `size:1024` |
| `function:>value` / `function:>=value` | 大于 / 大于等于 |
| `function:!=value` / `function:!value` | 不等于（后者按粒度排除区间） |
| `function:start..end` / `function:start-end` | 闭区间，如 `size:2mb..3mb` |
| `function:unknown` | 属性值未知（未索引或取值失败） |

### 3.2 日期写法

| 写法 | 示例 |
| --- | --- |
| `MM/YYYY`、`YYYY/MM` | `date-modified:07/2026` |
| `DD/MM/YYYY`、`YYYY/MM/DD`、`MM/DD/YYYY`（斜杠格式随区域设置） | `date-modified:2026/07/02` |
| ISO 8601 扩展，支持 `*` | `date-modified:*-02`、`date-modified:2026-07-02T10:52` |
| ISO 8601 基本 | `date-modified:20260702` |
| `YYMMDD` | `date-modified:260702` |
| `YYYY` / `YY` | `date-modified:2026`、`date-modified:26` |
| 相对时长 | `date-modified:2days`、`3months`、`4hours`、`10mins` |
| 区间 | `date-modified:2026-07-02..2026-07-03` |

日期常量：`today`、`yesterday`、`january`…`december`（`jan`…`dec`）、`sunday`…`saturday`（`sun`…`sat`）、`mtd`/`ytd`/`qtd`（本月/本年/本季度至今）、`unknown`。

时长写法（用于 `length:` 等）：`[n<hours|h>][n<minutes|mins|m>][n<seconds|secs|s>]`，如 `1hour2mins5secs`；或 `[[days:]hours:]minutes:]seconds`，如 `length:1:32`；也支持 ISO 8601 `pt1h20m30s`。

### 3.3 文件与文件夹函数

| 语法 | 含义 | 示例 |
| --- | --- | --- |
| `ext:` | **整个**扩展名匹配，`;` 分隔多个，忽略前导 `.`/`*.`，支持 `*` `?`；文件夹无扩展名；仅支持 `case:` `diacritics:` | `ext:mp3;flac`、`ext:mp*`、`ext:`（无扩展名） |
| `extension:` | 扩展名**包含**该文本 | `extension:mp3`、`whole:extension:c` |
| `size:` | 文件大小（字节），可用 KB/MB/GB/TB，1KB = 1024 字节 | `size:>100mb`、`size:2mb..3mb` |
| `size-on-disk:` | 磁盘占用（向上取整到簇） | `size-on-disk:>100mb` |
| `date-modified:`（别名 `dm:`） | 修改时间 | `date-modified:today`、`dm:2days` |
| `date-created:`（别名 `dc:`） | 创建时间 | `dc:2026` |
| `date-accessed:`（别名 `da:`） | 访问时间 | `da:today` |
| `date-changed:` | 文件系统条目变更时间（NTFS/ReFS，重命名、改属性也算） | `date-changed:2026-07-02` |
| `date-recently-changed:`（别名 `rc:`） | 索引项变更时间（创建/修改/移动/重命名），需开启 recent change indexing | `rc:today` |
| `date-modified-<part>:`（`dmday:` `dmyear:` `dmdow:` `dmhour:` `dmmonth:` `dmtime:` `dmdate:`） | 修改时间的某一部件；`date-created-*`（`dc*:`）、`date-accessed-*`（`da*:`）同理，均有 `dcdow:` 等变体 | `date-modified-day-of-week:monday`、`dmhour:14..18` |
| `date-run:` | 上次从 Everything 中打开的时间（需开启 Run History） | `date-run:today` |
| `location:`（别名 `loc:`） | 父目录**路径包含**该文本 | `location:c:\windows` 匹配其子项，不含 `C:\Windows` 本身 |
| `full-path:` | 完整路径包含该文本 | `full-path:"C:\Program Files\Everything\Everything.exe"` |
| `parent:` | 父目录**等于**该绝对路径（不含子目录） | `parent:C:\Windows` |
| `ancestor:` | 父或更上层的祖先等于该绝对路径（含子目录内容） | `ancestor:C:\Windows` |
| `parent-name:` / `ancestor-name:` | 父/祖先文件夹**名称包含**该文本 | `parent-name:downloads` |
| `parent-count:`（别名 `depth:`） | 父目录层数 | `parent-count:2..3` |
| `child:` / `child-file:` / `child-folder:` | 直接子项名称包含该文本 | `child:*.mp3` |
| `descendant:` / `descendant-file:` / `descendant-folder:` | 递归子项名称包含该文本 | `descendant:thumbs.db` |
| `child-count:` / `child-file-count:` / `child-folder-count:` | 直接子项数量（按索引计） | `child-count:>100` |
| `descendant-count:` / `descendant-file-count:` / `descendant-folder-count:` | 递归子项数量 | `descendant-count:>1000` |
| `sibling:` / `sibling-file:` / `sibling-folder:` | 同级项名称包含该文本，可配 `$stem:`/`$1:` | `*.txt !sibling:$stem:.doc` |
| `exists:` / `file-exists:` / `folder-exists:` | 指定文件/文件夹在索引中存在，配合 `$stem:` `$1:`；仅支持 `case:` 与名称内 `*` `?` | `*.jpg exists:$stem:.pdf` |
| `name:` | 文件名包含该文本 | `name:hosts` |
| `stem:` | 去扩展名的名称（文件夹取名称） | `stem:Everything` |
| `name-length:`（别名 `namelen:`） | 名称的 UTF-16 长度 | `name-length:>200` |
| `kind:` | Windows 的「种类」属性（多值） | `kind:picture`、`kind:folder` |
| `type:` | 注册表文件类型描述（慢，优先用 `ext:`） | `type:application` |
| `attributes:`（别名 `attr:` `attrib:`） | 包含全部指定属性，字母组合或数值；如 `A` 归档 `H` 隐藏 `R` 只读 `S` 系统 `D` 目录 | `attributes:rash`、`!attributes:h` |
| `empty:` | 空文件夹（按索引判断，不查磁盘） | `empty:` |
| `filelist:` | 与文件列表内容整体匹配，含 `\` 时匹配完整路径，支持 `*` `**` `?` | `filelist:Everything.exe` |
| `run-count:` | 从 Everything 打开的次数（需 Run History） | `run-count:20..50` |
| `length:`（别名 `duration:`） | 媒体时长 | `length:>10mins`、`length:1:32` |
| `count:` | 限制结果数量（会退化为单线程） | `count:100` |

### 3.4 内容与哈希（慢，务必先缩小范围）

| 语法 | 含义 | 示例 |
| --- | --- | --- |
| `content:` | 文件内容包含该文本（文本文件、eml、系统 iFilter、字节流） | `content:abc` |
| `system-index:`（别名 `si:`） | 走 Windows 系统索引，支持 Advanced Query Syntax | `si:kind:music` |
| `md5:` / `sha1:` / `sha256:` | 按文件内容计算的哈希 | `sha256:...` |
| `crc32:`（别名 `crc:`）/ `crc64:` | CRC 校验值 | `crc:abcd1234` |
| `regular-expression-match0:`…`match9:`（别名 `regmatch0:`…`regmatch9:`） | 引用上一次正则的捕获组 | `no-fast-regex:regex:abc123 regexmatch0:123` |

### 3.5 重复项函数（本插件不支持）

| 语法 | 含义 | 示例 |
| --- | --- | --- |
| `dupe:` | 按指定属性（默认 `name`）找重复项，`;` 分隔多个属性 | `dupe:size;sha256` |
| `dupe-from:` | 找出至少包含一个来自指定目录（含子目录）的重复组，需与 `dupe:` 同用，支持通配符 | `*.jpg dupe-from:"C:\My Photos" dupe:size;sha256` |
| `dupe-count:` / `dupe-min:` / `dupe-max:` | 每组显示的条数 / 最少重复数 / 最多重复数，需与 `dupe:` 同用 | `dupe-min:3 dupe:size` |
| `distinct:` / `unique:` | 按属性取不同值 / 取唯一值（`unique:` 与 dupe 相反） | `unique:name;size` |

## 4. 常用示例组合

| 需求 | query |
| --- | --- |
| 某目录（含子目录）下所有 dll | `location:"C:\Windows\System32" ext:dll` |
| 本月的 markdown | `ext:md dm:mtd` |
| 近 3 天改过的 json，排除 node_modules | `ext:json dm:3days !path:node_modules` |
| 大于 100MB 的视频 | `video: size:>100mb` |
| 名称以 log 结尾的 txt | `stem:*log ext:txt` |
| 区分大小写、整名匹配 README | `case:whole:README` |
| 名称形如 v1.2 的文件 | `regex:^v\d+\.\d+` |
| Program Files 下的 exe | `path:"C:\Program Files" ext:exe` |
| 存在同名 pdf 的 jpg | `*.jpg exists:$stem:.pdf` |
| D 盘近 7 天改过的文件夹 | `folder: location:D:\ dm:7days` |

## 5. 本插件 es_search 的配合方式

**本插件的 es_search 拒绝 `dupe:` 与 `dupe-from:`**：这两个函数会对全量文件做尺寸/哈希比对，全盘执行时耗时不可接受。查询中出现即被拦截并报错，请改用其他方式缩小范围（`dupe-count:`、`dupe-min:`、`dupe-max:` 依赖 `dupe:`，同样不可用）。

- 用 `path:` / `location:` / `parent:` / `ancestor:` 把搜索限定在具体目录，这是提速最有效的一步。
- 用 `ext:` / `size:` / `dm:`（`date-modified:`）等过滤条件进一步收窄。
- `sort`、`order`、`type`、`page`、`style` 是**工具参数**，不是查询语法：不要写 `sort:size`、`count:` 之类的函数，改用工具参数 `sort`、`order`、`type`、`page`、`style`。
- 工具按固定页大小（配置项 pageSize，默认 100 条）分页，只返回指定页码；翻到第 N 页仍要执行完整查询，所以应把条件写精确，而不是靠翻页找目标。
- 上游（es.exe / Everything IPC）报错会被翻译成会话语言返回，遇到"找不到文件"类错误先确认 Everything 正在运行。

## 6. 坑与限制

- 这三页整体标注 **Requires Everything 1.5**；更老版本的 Everything/es.exe 上部分修饰符与函数可能不生效，需实测。
- `content:`、`md5:`、`sha256:`、`attributes:`、`type:` 等属于「读磁盘/读内容」级别，比索引类函数慢几个数量级，全盘扫描前先加上路径条件。
- 未索引的卷、离线盘、网络位置搜不到；es.exe 依赖 Everything 服务/IPC 处于运行状态。
- 路径分隔符是 `\`，在 `regex:` 中需写成 `\\`；`regex:` 会吞掉所有 `|`，需要字面量时用 `regex*:`。
- 通配符匹配**整个文件名**：`foo` 是「包含 foo」，`foo*` 是「以 foo 开头」。
- `size:1kb` 是区间（1024..2047），要精确字节数用 `=1kb` 或 `==1kb`。
- 大小写默认不敏感；`case:` 只作用于单个搜索项，要全查询生效用 `?case:`。
- `!<a b>` 是 NOT(a AND b)，不是 (!a) AND (!b)；`< >` 分组能改求值顺序。
- 默认 OR 优先于 AND，与多数人直觉相反，组合查询时建议显式加 `< >`。
- 多值属性（如 `tags:`、`artist:`）默认「任一值匹配」即命中，要全部匹配加 `all-strings:`。
- 页码从 1 开始；结果总数由完整查询决定，缩小条件比翻大页码有效。
