# 06 · Adapter 与短时平台调用契约

本版使用一次性进程调用，替代旧设计的常驻 NDJSON 会话。Linux 框架工具保持其自身 CLI 格式，由 Adapter 转成统一结果；不强行要求系统工具实现本项目协议。

## 1. 统一数据模型

下面是设计契约；本版实际接口位于 src/platform/adapter.ts，仅支持 sourceId，mode 配置明确拒绝：

```ts
type ContextKind = 'code' | 'string' | 'comment' | 'unknown';
type Policy = 'code' | 'text' | 'keep';
interface InputPlan {
  sourceId: string;
  mode?: { open?: boolean; conversion?: number; active?: boolean };
}
interface ObservedState {
  sourceId?: string;
  mode?: InputPlan['mode'];
  observedAt: number;
}
interface SetResult {
  status: 'confirmed' | 'partial' | 'unverified' | 'failed';
  observed?: ObservedState;
  verifiedFields: string[];
  errorCode?: string;
}
```

Adapter 提供 probe、listOrCapture、get、set、dispose，均能表达未知与取消。probe 返回源/模式读写能力、枚举/记录方式、焦点保护级别与状态作用范围。字段 absent 表示未知，不代表 false。

confirmed 只表示**所请求字段**全部读回匹配；只请求 sourceId 时可确认源，但不能宣称内部中文模式。partial 是源确认而请求的部分模式未确认；unverified 是请求接受但无可靠读回；failed 是拒绝或调用失败。三者不混为成功 UI。

## 2. Windows/macOS helper

命令形态为 `helper probe`、`helper list`、`helper get`、`helper set --source <id>`，可选模式和目标身份为结构化参数。通过 execFile 的参数数组调用，绝不拼接 shell。每次输出一个版本化 JSON 对象后退出，stderr 有界。

请求参数由校验后的配置与前台身份产生；sourceId 非空、长度受限，不能解析为任意执行片段。输出示意：

```json
{"version":1,"status":"confirmed","observed":{"sourceId":"<id>"},"verifiedFields":["sourceId"]}
```

helper 不接收代码、URI、输入文本或候选词。不提供任意命令、动态库路径或网络端口。进程退出码和 JSON status 必须一致；JSON 非法、字段超长、版本不匹配视为后端错误。

## 3. processRunner

所有外部调用异步、参数数组、`shell: false`、Windows 隐藏控制台。包内 helper 用绝对路径；Linux 只执行已探测的可信工具。不得执行 workspace 中同名程序或接受工作区改写路径。

初始每条命令超时 1500ms；一整个设置事务（含查询/确认）总上限 2500ms。stdout/stderr 各最大 64KiB，源 ID 最大 1024 字节，枚举最多 512 项。超限、畸形 Unicode、非零退出、信号退出、ENOENT 分别记录原因，不同步抛错阻塞编辑器。

设置可先 get 并在匹配时跳过 set；此查询仅发生在真实边界/配置同步/resync，不在每次光标事件。设置后立即读回，必要时在同事务中再做一次短延时确认（初始 30ms），不是后台轮询。每个子调用前都重新检查事务是否有效。

## 4. 取消、超时与错误

取消队列项与分析是确定的；已经发出的 OS 请求未必能撤销。超时请求终止进程，并等待 exit/close 后才能允许下一设置事务；若无法确认退出，熔断自动设置，不能让新旧命令并行竞态。

终止进程不保证已经投递给系统的消息消失。结果未知时清除观测可信度，保持现状，下一次真正边界或 resync 再同步；失焦后不补偿。

错误分类：BACKEND_UNAVAILABLE、SOURCE_NOT_FOUND、FOCUS_UNSAFE、MODE_UNSUPPORTED、COMPOSING（仅后端确可检测）、TIMEOUT、OUTPUT_LIMIT、INVALID_OUTPUT、PERMISSION_DENIED、STALE_REQUEST。stale 静默丢弃，其他错误有限展示。连续三次可执行事务失败进入本窗口熔断，resync/配置修复后重新探测；不创建自动重启循环。

## 5. 资源与供应链

无常驻子进程，无空闲心跳。扩展销毁时取消/终止所属短时进程，不遗留句柄。签名与 SHA-256 清单随构建记录，哈希不是信任机制的替代。

构建脚本固定来源，不在运行时下载 helper。第三方代码及二进制的许可证随包保留；系统 fcitx5/ibus 工具通常由用户系统提供，不复制到 VSIX。安装组件、改系统输入法配置、签名凭据或公开发布需另行授权。


## 当前原生 wire 协议

实际 helper 的 get/set/probe 输出 `{ "version": 1, "status": "observed", "sourceId": "…" }`；target 输出 version/target，list 输出 version/sources。上文 confirmed/verifiedFields 示例是统一 Adapter 结果，不能直接当作 helper 的回包。原生 set 内部读回后 TS 比较期望 ID，省去额外 get 进程；各次调用仍受事务有效性与总预算约束。失败/未知 status 均拒绝，不将请求接受视为观测。
