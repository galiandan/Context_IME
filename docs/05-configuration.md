# 05 · 设置与克制的交互

## 1. 设置契约

以下配置已在 package.json 和扩展中实现。source ID 为平台不透明值，语言标签用于展示，不作唯一匹配。平台方案与 backend 使用 `machine` scope，只读可信本机用户配置，禁止工作区覆盖与盲目跨设备同步。

| 设置 | 默认 | 约束 |
| --- | --- | --- |
| `autoIme.enabled` | true | 两方案未配置时仍不切换 |
| `autoIme.enabledLanguages` | python/javascript/typescript/c/cpp | 只接受已经具备 grammar 与规则的语言 |
| `autoIme.rules.code` | code | code / text / keep，可按语言覆盖 |
| `autoIme.rules.string` | text | 同上 |
| `autoIme.rules.comment` | code | 同上，unknown 永远 keep |
| `autoIme.backend` | auto | auto / windows / macos / fcitx5 / ibus；machine |
| `autoIme.windows.code`、`.text` | 未配置 | 本机输入方案对象 |
| `autoIme.macos.code`、`.text` | 未配置 | 同上 |
| `autoIme.fcitx5.code`、`.text` | 未配置 | 同上 |
| `autoIme.ibus.code`、`.text` | 未配置 | 同上 |
| `autoIme.switchDelayMs` | 20 | 0–100ms，合并设置意图 |
| `autoIme.maxFileSizeKB` | 2048 | 正整数，按 UTF-16 文本占用保守估算 |
| `autoIme.debug` | false | 开启有界诊断，不记录文本 |

首版不暴露任意 shell 命令、正则/代码执行、grammar 路径或插件路径。Linux 工具通过可信系统路径解析，不搜索 workspace 目录；如以后增加可执行路径设置，必须 machine scope、绝对路径，且显式拒绝工作区覆盖。

## 2. 输入方案结构

```json
{
  "autoIme.rules.code": "code",
  "autoIme.rules.string": "text",
  "autoIme.rules.comment": "code",
  "autoIme.backend": "macos",
  "autoIme.macos.code": { "sourceId": "<由本机枚举或记录获得>" },
  "autoIme.macos.text": { "sourceId": "<由本机枚举或记录获得>" },
  "[python]": { "autoIme.rules.comment": "text" }
}
```

各方案至少含 sourceId；可选 mode 是后端能力明确支持的结构化字段，不是任意字符串命令。源与内部模式不能混为一个布尔值。第一版向导默认只提供已验证的源选择；不支持 mode 时拒绝相关配置并解释，不静默忽略。

两角色相同可保存，但说明仅凭源选择不会自动切中英文。源被删除/停用后暂停，不按相似名称替换。未受信工作区忽略工作区策略覆盖，保留用户级设置。

## 3. 首次配置向导

进入向导即暂停本窗口规则、取消待执行请求，等待在途设置事务退出后再读配置源，避免旧请求干扰记录。先探测后端，再枚举或提供“手动切换后记录当前”。

Fcitx5 等不能枚举时，用户自己用系统方式选好源，点击记录后进行一次查询；说明记录时输入焦点可能在 QuickPick，须返回编辑器用 resync 验证按应用记忆的行为。窗口失焦不运行自动规则。

分别取得 code/text，验证字段与能力后成组保存；取消保留原配置。向导不偷偷试切或安装框架。结束恢复原启用状态但不立即设置系统源；待下一有效交互，或用户显式 resync。

## 4. 命令与状态栏

| ID | 名称 | 行为 |
| --- | --- | --- |
| `autoIme.toggle` | Context IME：启用/停用 | 清旧任务并更新开关 |
| `autoIme.setup` | Context IME：配置输入方案 | 运行向导 |
| `autoIme.resync` | Context IME：重新同步 | 重新探测必要状态并应用当前可靠上下文 |
| `autoIme.diagnostics` | Context IME：打开诊断信息 | 本地输出能力与聚合统计 |

不占用默认热键。resync 仍要求聚焦窗口和有效文本编辑器；可通过公开 showTextDocument 恢复目标编辑器焦点后重验，不因从命令面板执行就绕过所有门控。unknown/多光标/非空选区时不强制设置。

状态栏简洁显示自动、暂停、待配置、后端错误，点击 toggle；不显示未经实时观察的“当前中文”。tooltip 分开写期望方案、最近请求、最近观测及其时间/字段范围，不把历史观测当实时状态。

## 5. 诊断与限流

默认无详细日志；少量错误计数与最近原因保留。debug 用环形缓冲最多 256 条/64KiB，达到任一限制丢弃旧项；不写代码、选区、候选词或完整文档路径。退出或关闭 debug 后释放缓冲。

同类错误每窗口最多通知一次；日常设置只更新状态，不每次弹窗。诊断包含后端可用性、能力边界、语言/grammar 版本、缓存命中/分词行数、调用数量和时延、过期/超时次数。没有遥测上传与云端接口。
