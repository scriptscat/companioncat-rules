# 陪伴猫规则

这个仓库放[陪伴猫](https://github.com/scriptscat/companioncat)的官方规则包、规则格式的 JSON Schema 和检查脚本。本文也是规则作者指南：陪伴猫的功能、设置项、引擎都由规则包声明，写规则只需要 JSON 和 `{{ }}` 里的 CEL 表达式，不写代码。

```
packs/official-translate.json   翻译：划词翻译、网页对照，Google / 微软翻译引擎
packs/official-llm.json         常见大模型：translate / chat / choose 三个契约、大模型桥接、DeepSeek / GLM / 通义 / OpenAI / Jev
packs/official-skip-ads.json    跳过广告
packs/official-quiz.json        做题
schema/v1.json                  规则格式（JSON Schema 2020-12）
scripts/check.mjs               检查脚本
```

订阅地址（陪伴猫先试主地址，失败再用镜像）：

- `https://raw.githubusercontent.com/scriptscat/companioncat-rules/main/packs/<包>.json`
- `https://cdn.jsdelivr.net/gh/scriptscat/companioncat-rules@main/packs/<包>.json`

官方包都是写法范例，遇到本文没讲到的细节，直接看它们。

## 1. 规则包的结构

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/scriptscat/companioncat-rules/main/schema/v1.json",
  "schema": 1,                 // 格式版本，大版本必须是 1
  "id": "my-pack",             // 全局唯一；本地规则固定是 local
  "name": "我的规则",
  "description": "…",
  "version": "2026.11.18",
  "homepage": "…", "author": "…",
  "contracts": [ … ],          // 新的能力类型（第 3 节）
  "bridges":   [ … ],          // 把一个契约转成对另一个契约的调用，供引擎的 via 引用
  "providers": [ … ],          // 引擎（第 4 节）
  "views":     { … },          // 视图模板（第 5.6 节）
  "features":  [ … ],          // 功能（第 5 节）
  "sites":     [ … ],          // 按网站微调功能的参数（第 6 节）
  "overrides": { … }           // 只在本地规则里有效（第 8 节）
}
```

只有 `schema` 和 `id` 必填。

**id 和引用**：

- `id` 只用小写字母、数字和 `-`，例如 `official-translate`。
- 设置项、引擎参数、Key、步骤、`as` 的名字要能写进表达式，例如 `settings.siteEnabled`，所以用字母、数字和 `_`。
- 跨包引用写成 `包id/条目id`，例如 `official-llm/openai-compatible`；入口写成 `包id/功能id.入口id`，例如 `official-translate/translate.page`。

**组合**：

- 多个规则包同时订阅时，本地规则最优先，其他按「规则」页的列表顺序；同一个完整 id 的条目以优先级高的为准。
- 引擎可以用 `extends` 继承别的引擎（可以跨包），只写不同的字段：对象逐层合并，数组整个替换，`null` 表示删除这个字段；最多继承 5 层。
- 官方包声明的契约不能被其他包覆盖。
- 某个条目出错（继承的对象找不到、继承成环、缺少必填字段、表达式写错）时，只停用这一个条目，界面上写明原因，其他照常工作。

## 2. 表达式

### 写法

字符串里 `{{ }}` 中间的内容按 [CEL](https://cel.dev) 求值。

- **整段**就是一个 `{{ }}` 时，返回原始值，可以是数组、对象、数字、布尔值：`"texts": "{{ vars.blocks.map(b, b.text) }}"`。
- 里面夹着其他文字时，每段结果转成字符串后拼接：`"url": "{{ options.baseUrl }}/chat/completions"`。

可以用 CEL 的运算符（`==`、`!=`、`<`、`&&`、`||`、`!`、`? :`、`+`、`in`、下标）、宏（`map`、`filter`、`all`、`exists`、`exists_one`）和下面的白名单函数。没有循环，没有副作用。

字段不一定存在时，先用 `has()` 判断：`{{ has(input.from) ? input.from : 'auto' }}`。

限制：每个表达式的语法树最多 2000 个节点、嵌套最深 32 层，列表和 map 最多 1000 项，单次求值最多 50 毫秒。

### 变量

| 变量 | 是什么 |
|---|---|
| `settings` | 这个入口的设置值，包括功能的共用设置 |
| `vars` | `set` 写入的值，以及 `call`、`find`、`ask` 用 `as` 存下的结果；网页对照入口的段落在 `vars.blocks` |
| `selection` | 划词时的选区：`text`、`lang`、`sentence`（选区所在的句子）、`rect` |
| `page` | 当前页面：`url`、`title` |
| `site` | 命中的网站规则里除 `match`、`for` 外的字段，例如 `site.blocks` |
| `trigger` | 只在自动化入口里：触发这次运行的事件，`appear` 时 `trigger.element` 是新出现的元素 |
| `item` | 当前项：`repeat` 的每一项、`find` 的 `where` 里的每个元素、`result-list` 的每个结果 |
| `input` | 契约的输入 |
| `options` | 引擎参数的值 |
| `secret` | 引擎的 Key，例如 `secret.apiKey` |
| `steps` | 引擎前置步骤的结果，`steps.<步骤id>` |
| `landed` | 只在引擎的请求和步骤 `output` 里：`landed.<步骤id>.url` / `.host`，这个步骤跟着跳转最后落到的地址 |
| `response` | 引擎收到的响应；SSE 时是每个事件的 data |
| `stream` | SSE 累加的结果，`stream.text` |
| `result` | 调用结果：桥接里是被调用契约的输出；网页对照的 `present` 里是这一段的结果，例如 `result.output.texts[0]` |
| `params` | 视图模板的参数 |
| `value` | 视图里 `select` 的 `onChange` 中，新选的值 |

每个位置只能用和它有关的变量：

| 位置 | 能用的变量 |
|---|---|
| 引擎 `hosts`、实现的 `when` | `options` |
| 引擎 `request`、`steps[].request` | `input`、`options`、`secret`、`steps`、`landed` |
| 引擎 `steps[].output` | 同上，加 `response` |
| 引擎 `output`、`stream.delta` | `input`、`options`、`secret`、`steps`、`response`、`stream` |
| 引擎 `errors` | `input`、`options`、`secret`、`steps`、`response` |
| 桥接 `input` | `input`、`options` |
| 桥接 `output`、`check`、`checkMessage` | `input`、`result` |
| 入口 `triggers`、`select` | `settings`、`site`、`page`；自动化入口的 `triggers` 还有 `trigger` |
| 入口 `run`、`present.surface` | `settings`、`vars`、`selection`、`page`、`site`；自动化入口的 `run` 还有 `trigger`、`item` |
| 入口 `present.view` | 同上，加 `result` |
| 视图模板 | `params` |
| 契约的 `view` | `result` |
| 网站规则 | `page` |

在不能用的位置用了某个变量（比如功能的 `run` 里用 `secret`），按语法错误处理。

### 白名单函数

| 函数 | 说明 |
|---|---|
| `concat(a, b)` | 拼接两个字符串或两个列表 |
| `replace(s, old, new)`、`s.replace(old, new)` | 替换 |
| `split(s, sep)`、`join(list)`、`join(list, sep)` | 拆分、合并 |
| `contains(s, x)`、`contains(list, x)` | 是否包含 |
| `match(text, regex)` | 第一个匹配的捕获组列表，没有匹配时是空列表。正则不超过 200 个字符，文本不超过 1 MB。常用来从网页里取 token，或判断文字像不像某个词：`size(match(text(item), '(跳过\|Skip)')) > 0` |
| `urlencode(v)`、`base64(v)`、`hex(v)` | 编码 |
| `md5(v)`、`sha256(v)`、`hmacSha256(key, data)` | 哈希，默认返回十六进制 |
| `now()`、`unix()` | 当前时间，毫秒 / 秒 |
| `uuid()`、`random()`、`random(min, max)` | 随机 |
| `json(v)`、`extractJson(s)` | 转成 JSON 字符串；从一段文字（比如大模型的回答）里取出 JSON |
| `langName(code)`、`languages()`、`lang(text)` | 语言名、语言列表、检测文字的语言 |
| `host(url)` | 网址里的域名 |
| `has(a.b.c)` | 字段是否存在，参数必须是字段路径 |
| `size(x)` | 字符串、列表、map 的长度 |

CEL 标准库里的其他函数（`matches`、`startsWith`、`int()`、`type()` 等）都不能用。

### 页面函数（只读）

自动化入口要读网页，用这一组函数。它们只读、没有副作用：

| 函数 | 说明 |
|---|---|
| `text(el)` | 元素的可见文字 |
| `attr(el, name)` | 属性值；不能读输入框、下拉框的 `value` |
| `describe(el)` | 给人看的一句描述，例如「「跳过广告」按钮」，用于动作记录和问引擎 |
| `outline(el, n)` | 元素及其内部不超过 n 个字的精简结构：标签、文字、少量属性，**不含**输入框里的值 |
| `closest(el, selector)` | 最近的匹配祖先，没有时是 `null` |
| `within(el, selector)` | 元素内部的匹配后代列表，最多 1000 个 |
| `visible(el)` | 元素是否可见 |

- 只能用在**自动化入口**的 `triggers` 和 `run` 里，`trigger` 变量也一样；在别的位置用了按语法错误处理。
- `run` 里有 `find`、`act`、`ask`、`if`、`repeat`、`stop` 中任何一种步骤的入口，就是自动化入口。
- 元素在表达式里是不透明的句柄（`find` 的结果、`trigger.element`、这些函数的返回值），只能传给页面函数和 `act` 的 `target`，不能转成别的东西。

## 3. 契约

契约是一种能力的类型签名。官方「常见大模型」包声明了三个：

| 契约 | 输入 | 输出 |
|---|---|---|
| `translate` | `texts`、`to`，可选 `from`、`context` | `texts`，条数和输入相同 |
| `chat` | `messages`（`role` + `content`） | `text` |
| `choose` | `state`、`question`、`options`（选项 id 到说明） | `choice`、`confidence` |

新契约写在 `contracts` 里：`id`（带命名空间和大版本号，例如 `weather/current@1`）、`name`、`description`、`input` 和 `output`（JSON Schema）、`bridgeable`（能否用大模型兜底，需要实时数据的设为 `false`）、`sample`（样例输入，引擎的「测试」和试运行都用它）、`view`（默认的结果视图）。

**桥接**（`bridges`）把 `from` 契约转成对 `to` 契约的调用：`input` 把输入映射过去，`output` 把结果映射回来，`check` 为假时带着 `checkMessage` 重试一次。官方的 `llm-translate`、`llm-choose` 就是把翻译、选择转成一次 `chat`。

## 4. 引擎

```jsonc
{
  "id": "…", "name": "…", "description": "…", "icon": "languages",
  "extends": "…",          // 继承别的引擎
  "abstract": true,        // 只供继承，不出现在引擎列表里
  "secrets": [{ "name": "apiKey", "title": "API Key", "placeholder": "sk-…", "helpUrl": "…", "helpLabel": "…" }],
  "options": { "model": { "type": "string", "title": "使用的模型", "default": "…" } },
  "hosts": ["api.example.com"],
  "limits": { "timeoutMs": 10000, "retry": { "on": ["network", "timeout", "server"], "max": 1 }, "concurrency": 4, "perMinute": 60 },
  "implements": { "translate": { "http": … }, "choose": { "via": "llm-choose" } }
}
```

- **`secrets`**：需要哪些 Key。规则里不能写 Key，只能在表达式里用 `secret.名字` 引用；用户在「引擎」页填写。继承的引擎没写 `secrets` 时，直接用父引擎的 Key。
- **`options`**：可调参数，类型有 `string`、`number`、`boolean`、`enum`（要写 `options`）；引擎详情的「模型与参数」按它生成。继承的引擎可以只写 `default`。
- **`hosts`**：会访问哪些域名，可以写表达式，例如 `"{{ host(options.baseUrl) }}"`。不在列表里的请求一律拒绝，跳转后落到的域名也要在列表里。Key 按「引擎 + 域名」绑定：规则更新后域名变了，要用户确认才会继续发 Key。
- **`limits`**：超时、按错误类型重试、并发、每分钟次数。
- **`implements`**：每个契约一种实现，也可以写成数组，按顺序用第一个 `when` 为真（或没写 `when`）的。实现方式三选一：

### `http`：声明式请求

| 字段 | 说明 |
|---|---|
| `steps` | 前置步骤，比如先取 token。每步有 `id`、`request`、`response`（`json` / `text`）、`output`（写进 `steps.<id>`，不写就是整个响应）、`cache`（缓存秒数） |
| `request` | `method`、`url`、`headers`，请求体 `json` / `form` / `text` 最多写一个 |
| `response` | `json`、`text` 或 `sse` |
| `stream` | `sse` 时必填：`delta` 算出每个事件的增量文字，累加到 `stream.text`；`done` 是结束标志，例如 `[DONE]` |
| `output` | 把响应映射成契约的输出 |
| `errors` | 按 `status`（`429`、`[401, 403]`、`"5xx"`）或 `when`（按响应内容）识别错误，给出 `type` 和提示文字 `message` |
| `batch` | 多条输入怎么拆：`maxItems`、`maxChars`；写了 `join` 时把 `input.texts` 拼成一条发出，再把 `output.texts[0]` 按它拆回 |
| `langMap` | 陪伴猫的语言代码到服务商的代码，作用于 `input.from` 和 `input.to` |

错误类型只能用这些：`network`、`timeout`、`auth`、`rateLimit`、`server`、`badInput`、`badOutput`、`hostUndeclared`、`hostUnconfirmed`、`missingKey`、`disabled`。

**例子：微软翻译和 `landed`。** 微软翻译先打开翻译页面取 token，再用它请求翻译。在国内网络下，`www.bing.com` 会跳转到 `cn.bing.com`，翻译请求必须发到实际落到的域名，所以用 `landed.page.host`，并且两个域名都写进 `hosts`（摘自 `official-translate`）：

```jsonc
"hosts": ["www.bing.com", "cn.bing.com"],
"implements": {
  "translate": {
    "http": {
      "langMap": { "auto": "auto-detect", "zh-CN": "zh-Hans", "zh-TW": "zh-Hant" },
      "batch": { "join": "\n", "maxChars": 1000 },
      "steps": [{
        "id": "page",
        "request": { "method": "GET", "url": "https://www.bing.com/translator" },
        "response": "text",
        "output": { "ig": "{{ match(response, 'IG:\"([0-9A-Fa-f]+)\"')[0] }}", … },
        "cache": 600
      }],
      "request": {
        "method": "POST",
        "url": "https://{{ landed.page.host }}/ttranslatev3?isVertical=1&IG={{ steps.page.ig }}&IID=translator.5028",
        "form": { "to": "{{ input.to }}", "text": "{{ input.texts[0] }}", "token": "{{ steps.page.token }}", … }
      },
      "response": "json",
      "output": { "texts": "{{ [response[0].translations[0].text] }}" }
    }
  }
}
```

### `via`：转成另一个契约

写桥接 id（跨包写 `包id/桥接id`），或者直接写一个桥接（`to`、`input`、`output`，可选 `check`、`checkMessage`）。例如大模型引擎的 `"translate": { "via": "llm-translate" }`。

### `builtin`：代码里的适配器

只给声明式写不出来的情况用。目前陪伴猫没有任何适配器。

### 例子：接入一个兼容 OpenAI 的服务

继承官方的抽象引擎，只写不同的地方：

```json
{
  "id": "kimi",
  "name": "Kimi",
  "extends": "official-llm/openai-compatible",
  "abstract": false,
  "secrets": [{ "name": "apiKey", "title": "API Key", "placeholder": "sk-…" }],
  "options": {
    "baseUrl": { "default": "https://api.moonshot.cn/v1" },
    "model": { "default": "moonshot-v1-8k" }
  }
}
```

它就有了 `chat`，以及经由桥接的 `translate` 和 `choose`。

## 5. 功能和入口

一个功能（`features[]`）在设置窗口左侧多一个菜单页，可以有多个入口，入口之间共用功能的设置。

- **功能**：`id`、`name`、`description`、`icon`（[lucide](https://lucide.dev/icons) 图标名）、`match`（在哪些网址生效，例如 `*://*/*`）、`exclude`、`settings`（共用设置）、`entries`。
- **入口**：`id`、`name`、`description`、`match`（不写就用功能的）、`settings`、`triggers`、`run`，以及 `toggle`、`select`、`present`。`present` 只有自动化入口可以不写。

### 5.1 设置项

```json
"threshold": { "type": "number", "title": "多有把握才直接点", "min": 0.5, "max": 0.99, "step": 0.01, "default": 0.85, "format": "percent" }
```

| 类型 | 说明 |
|---|---|
| `boolean` | 开关 |
| `enum` | 单选，`options` 写值到显示文字 |
| `language` | 语言 |
| `engine` / `engines` | 选一个 / 多个引擎，`capability` 写契约，只列出实现了它的引擎；`max` 限制个数 |
| `string` | 文字，可以写 `placeholder` |
| `number` | 数字，`min`、`max`、`step`；`format: "percent"` 按百分比显示和输入，0.85 显示成 85% |
| `hotkey` | 快捷键，例如 `Alt+A`、`Ctrl+Shift+K`，修饰键在前；空字符串表示不设 |

其他字段：`title`（必填）、`description`、`default`、`scope`（`global` 或 `site`，`site` 的值按网站分别保存）、`quick`（放进小猫气泡；`engines` 写 `"first"` 时只显示第一个）。

设置值属于用户：规则更新后，原来的值保留，新增的设置项用默认值。

### 5.2 触发器

| `on` | 什么时候运行 | 相关字段 |
|---|---|---|
| `selection` | 选中文字时 | `confirm`（`paw` 先伸出猫爪、`none` 直接继续、`alt` 按住 Alt 才继续）、`ignoreIn`（选区在这些元素里时不触发）、`minLength`、`maxLength` |
| `page-load` | 页面加载完成后运行一次 | |
| `appear` | 页面上**新出现**匹配 `selector` 的元素时；加载时就有的不算 | `selector`（必填）、`debounceMs`（同一批变化在这么多毫秒内只触发一次，默认 300）；`trigger.element` 是新出现的元素 |
| `command` | 点气泡按钮、按快捷键或点脚本猫菜单项时 | `title`（必填，按钮和菜单的名字）、`hotkey`（可以取 `hotkey` 类型的设置：`"{{ settings.hotkey }}"`）、`quick`（放进气泡） |

每个触发器都可以写 `enabled`，为假时不运行，例如 `"{{ settings.siteEnabled }}"`。

### 5.3 步骤

`run` 是一列步骤，每步只写一种：

| 步骤 | 字段 | 说明 |
|---|---|---|
| `set` | `{ 名字: 值 }` | 写进 `vars` |
| `call` | `call`（契约）、`input`、`strategy`、`engines`、`stream`、`batch`、`as` | 调用契约，结果写进 `vars.<as>`。`strategy`：`first` 按顺序用第一个、失败换下一个，`race` 用最快的，`all` 全部返回，`vote` 投票。`engines` 不写就用「通用」里这种能力先用的引擎。`batch: "blocks"` 用于网页对照，按段落分批 |
| `find` | `find`、`within`、`where`、`all`、`as` | 找**可见**的元素，结果是句柄列表，写进 `vars.<as>`；没找到是空列表。`find` 写 CSS 选择器；`within` 只在某个元素里找；`where` 按条件过滤，当前元素是 `item`；`all: true` 返回全部，否则只返回第一个 |
| `act` | `act`、`target`、`value`、`ms`、`selector`、`timeoutMs`、`confidence`、`minConfidence`、`below`、`describe` | 对 `target` 做一个动作（见下） |
| `ask` | `ask`（契约）、`input`、`engine` 或 `engines`、`strategy`、`as` | 问引擎，通常是 `choose` 或 `chat`。结果是契约的输出加上 `confidence`，写进 `vars.<as>`。走和 `call` 一样的调用管道，缓存、错误、域名确认都一样 |
| `if` | `if`、`then`、`else` | 条件为真执行 `then`，否则执行 `else`（可选） |
| `repeat` | `repeat`、`steps`、`until`、`max` | `repeat` 写一个列表时，对每一项执行 `steps`，当前项是 `item`；写 `true` 时重复执行，直到 `until` 成立，最多 `max` 次（这时两者必填） |
| `stop` | `stop: true` | 结束这次运行 |

`act` 的动作：

| `act` | 说明 |
|---|---|
| `click` | 点击 |
| `fill` | 填入 `value`，像真实输入一样触发 input / change 事件 |
| `check` | 勾选；`value` 为 `false` 时取消勾选 |
| `select` | 在下拉框里选中 `value` |
| `scroll` | 滚动到元素 |
| `focus` | 让元素获得焦点 |
| `wait` | 等 `ms` 毫秒，或等页面上出现 `selector`（`timeoutMs` 是最多等多久）；不写 `target` |

`describe` 是给人看的一句话，出现在动作记录和「先问你」里。

**`find: "auto:questions"`**：由陪伴猫识别这一页的单选、多选、填空题。每题有 `stem`（题干）、`kind`（`single` / `multiple` / `blank`）、`no`（题号，可能没有）、`handle`（题目所在的元素）、`choices`（选择题能选的答案：`id`、`text`、`handles`，多选题是选项的组合）、`input`（填空题的输入框）。用法见 `official-quiz`。

**失败时**：`ask` 失败就停止这次运行，后面的动作不做；`act` 的目标已经不在页面上就跳过这个动作，接着往下；`wait` 超时停止这次运行；页面跳转后没做完的运行直接丢弃；上一次还没运行完又被触发时，丢弃这次触发。

### 5.4 门槛

`act` 写了 `minConfidence` 时，`confidence` 达到它才直接做；没到就按 `below` 处理：

- `ask`：在目标旁边弹出小气泡先问用户，30 秒没回答当作「不用」；
- `hint`：在目标旁边标出建议，不动手；
- `skip`：什么都不做，只记进动作记录。

没写 `minConfidence` 的 `act` 直接做。`confidence` 通常取 `ask` 的结果，`minConfidence`、`below` 通常取设置项，让用户自己调：

```json
{ "act": "click", "target": "{{ vars.button }}", "confidence": "{{ vars.pick.confidence }}",
  "minConfidence": "{{ settings.threshold }}", "below": "{{ settings.below }}", "describe": "{{ vars.pick.choice }}" }
```

### 5.5 网页对照：`toggle` 和 `select`

- `toggle: true`：再触发一次就收回。
- `select` 选出要翻译的段落，写进 `vars.blocks`（每项有 `text`）：`blocks` 写选择器列表或 `auto`（自动识别正文段落），`exclude` 跳过的元素，`lazy: "viewport"` 只翻译进入视口的段落，`watch: "mutations"` 页面新增内容时接着翻译。
- 写法见 `official-translate` 的 `page` 入口。

### 5.6 展示：`present` 和视图

`present` 有两部分：`surface`（出现在哪里）和 `view`（长什么样）。

| `surface.type` | 说明 |
|---|---|
| `near-selection` | 选中文字旁边的卡片；`pinnable` 可以固定，`closeOn`：`escape`、`outside-click`、`new-selection` |
| `bubble` | 小猫气泡 |
| `inline-after` | 插在段落后面（网页对照）；`target: "block"`，`hideSource` 为真时隐藏原文 |
| `page-card` | 网页角落的结果卡片，自动化入口用，例如做题结果 |

`view` 可以直接写组件，也可以用 `{ "use": "模板id", "with": { … } }` 引用 `views` 里的视图模板，`with` 的值在模板里写成 `params.名字`。模板要在 `params` 里列出参数名。

组件（`type`）：`card`（`header`、`body`）、`row`（`children`）、`text`（`value`，可选 `tone`、`style`、`format: "percent"`）、`icon`（`name`）、`icon-button`（`icon`、`label`、`action`）、`button`（`label`、`action`）、`select`（`value`、`options`、`onChange`）、`spacer`、`dots`（加载中）、`result-list`（`from`、`primary`、`item` 的 `ok` / `loading` / `error` / `needKey` 四种状态、`meta`、`itemActions`）。`tone` 有 `default`、`muted`、`danger`、`success`。

动作（`action`，只写一个）：`copy`（复制）、`retry`（只重试这个引擎）、`scrollTo`（滚动到某个元素）、`rerun`（带着新的 `vars` 重新执行，只对这一张卡片有效）、`open`（打开设置窗口：`feature-settings` 或 `engine:引擎id`）、`surface`（`pin` / `close`）。

## 6. 网站规则

网站规则只调参数，不重写功能：

```json
"sites": [
  { "match": ["*://github.com/*"], "for": "official-translate/translate.page", "blocks": [".markdown-body p", ".markdown-body li"] }
]
```

`match`、`for`（作用到哪个入口）必填；`blocks`、`skip` 和其他字段在入口的表达式里写成 `site.名字`。

## 7. 检查

```sh
npm install
node scripts/check.mjs                 # 检查 packs/ 下所有包
node scripts/check.mjs my-pack.json    # 检查指定文件
npm test                               # 检查脚本自己的测试
```

检查脚本做三件事：JSON 能解析、通过 `schema/v1.json`、每个 `{{ }}` 都是合法的 CEL，并且只用了白名单里的变量和函数，页面函数和 `trigger` 只出现在自动化入口的 `triggers`、`run` 里，`landed` 只出现在引擎请求和步骤 `output` 里。出错时逐条写出字段路径和原因，表达式错误带列号和原文。

变量是否在每个位置都可用（第 2 节的表格），检查脚本不细查；陪伴猫的本地规则编辑器会按位置检查。

文件开头写上

```json
"$schema": "https://raw.githubusercontent.com/scriptscat/companioncat-rules/main/schema/v1.json"
```

VS Code 等编辑器就能按 Schema 补全字段、提示说明和报错。

改官方包时，同时改它的 `version`（按日期，例如 `2026.11.17.1`）。

## 8. 在陪伴猫里写本地规则

设置窗口「规则」页的「编辑本地规则」是你自己的规则包：

- `id` 必须是 `local`；它的优先级最高。
- 点「检查并保存」时做和检查脚本一样的检查，再按位置检查变量，并核对继承和 `overrides` 的目标。错误逐条列出行号、字段路径和原因。只要 JSON 能解析并且通过 Schema，就允许保存：有表达式错误的条目被停用，其他照常生效。
- 不要把 Key 写进规则；像 Key 的字面量（比如 `sk-` 开头的长字符串）保存时会提示。
- 本地规则里的自动化入口保存后直接生效，不弹启用确认；同样有动作记录，同样能按网站暂停。
- 「教小猫做件事」写出的规则也存在这里，可以手改，也可以在它的功能页「继续和小猫改」。
- 引擎详情里的「试运行」用契约的 `sample` 调用一次，逐步列出请求（Key 打码）、响应、每个表达式的值和最终输出，调试引擎主要靠它。

**`overrides`**：修改订阅里的条目，订阅更新后修改仍然保留。键是完整 id，值按「对象逐层合并、数组整个替换、`null` 删除」合并到目标上：

```json
"overrides": {
  "official-llm/deepseek": { "options": { "model": { "default": "deepseek-reasoner" } } },
  "official-skip-ads/skip-ads.auto-skip": { "settings": { "threshold": { "default": 0.9 } } }
}
```

引擎页「模型与参数」里改的内容，也是写成本地 `overrides`，可以「恢复官方设置」。

## 9. 例子：一条小的自动化规则

在 example.com 上，新冒出 Cookie 提示时，找到里面写着「接受」的按钮，问引擎是不是它，有把握就点，没把握先问你：

```json
{
  "$schema": "https://raw.githubusercontent.com/scriptscat/companioncat-rules/main/schema/v1.json",
  "schema": 1,
  "id": "local",
  "name": "我的规则",
  "features": [
    {
      "id": "cookie-banner",
      "name": "关掉 Cookie 提示",
      "icon": "cookie",
      "match": ["*://*.example.com/*"],
      "entries": [
        {
          "id": "auto-accept",
          "name": "自动点「接受」",
          "settings": {
            "threshold": { "type": "number", "title": "多有把握才直接点", "min": 0.5, "max": 0.99, "step": 0.01, "default": 0.8, "format": "percent" }
          },
          "triggers": [{ "on": "appear", "selector": "[class*=cookie]" }],
          "run": [
            {
              "find": "button",
              "within": "{{ trigger.element }}",
              "where": "{{ size(match(text(item), '(接受|同意|Accept)')) > 0 }}",
              "as": "btns"
            },
            { "if": "{{ size(vars.btns) == 0 }}", "then": [{ "stop": true }] },
            {
              "ask": "choose",
              "input": {
                "state": "{{ outline(trigger.element, 400) }}",
                "question": "这是不是 Cookie 提示里「接受」的按钮？",
                "options": { "yes": "是", "no": "不是" }
              },
              "as": "pick"
            },
            {
              "if": "{{ vars.pick.choice == 'yes' }}",
              "then": [
                {
                  "act": "click",
                  "target": "{{ vars.btns[0] }}",
                  "confidence": "{{ vars.pick.confidence }}",
                  "minConfidence": "{{ settings.threshold }}",
                  "below": "ask",
                  "describe": "Cookie 提示的「接受」按钮"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

- `appear` 只看新出现的提示，`trigger.element` 就是它。
- `find` 在提示里按文字找按钮；没找到就 `stop`。
- `ask` 没写 `engine`，用「通用」里「选择和判断」先用的引擎；发出去的是提示的精简结构，不含输入框的值。
- `act` 把握达到 80% 就点，没到就先问你。
- 订阅来的规则里，这样的入口默认关闭，第一次打开要用户确认；放在本地规则里则保存后直接生效。
