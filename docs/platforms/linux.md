# Linux · Fcitx5 与 IBus

## 1. 首版接口

首版通过异步 `execFile` 调用用户已有的 `fcitx5-remote` / `ibus`，参数使用数组。框架本身是用户已有系统服务；插件不另启 daemon，不调用 xdotool、setxkbmap 或用户 shell 脚本模拟通用输入法控制。

探测不仅检查命令存在，还检查服务可访问和返回值合法。两个框架都可用时要求在设置中明确选择；零个可用显示诊断，不自动安装或启动。所有探测仅在初始化需求、配置、显式重试等事件发生，不定时轮询。

## 2. Fcitx5 语义

以下基于[官方 remote.cpp](https://raw.githubusercontent.com/fcitx/fcitx5/master/src/tools/remote.cpp)，实施时还须核实用户工具版本支持：

| 调用 | 含义 | 不能推断的结论 |
| --- | --- | --- |
| `fcitx5-remote --check` | 已运行检查并读取状态；避免 D-Bus 自动激活 | 工具存在不代表服务运行 |
| `fcitx5-remote --check -n` | 当前输入法名称 | 名称不等于内部中英文模式 |
| `fcitx5-remote --check -s <id>` | 请求指定输入法 | 返回成功不等于后续实际源及模式都匹配 |
| `fcitx5-remote --check -o` | 激活输入法 | 不等于“进入中文模式” |
| `fcitx5-remote --check -c` | 停用输入法 | 不等于任意用户指定英文源 |

源为主的方案用 `-s`，随后 `-n` 确认；若用户方案另含 active 状态，独立应用并验证，不能以 active 替代 source。组合调用串行、共享事务预算。第一版不自动操作 `-t`、重载配置或切换输入法组。

工具没有本项目所需的通用枚举输出时，向导让用户手动选择源后“记录当前”，不猜 ID、不解析任意用户配置文件。旧工具没有安全探测选项时标不兼容或另核实无副作用的探测途径。

## 3. IBus 语义

依据[官方命令实现](https://github.com/ibus/ibus/blob/main/tools/main.vala)，以 `ibus engine` 查询、`ibus engine <name>` 请求切换，使用 `ibus list-engine` 的目标版本支持格式枚举。列表解析需实际版本 fixture，不能把本地化说明文字当 ID。

设置后再次查询引擎；不能由进程成功退出推断 engine 私有模式。连接失败、空输出、畸形输出、未知引擎与超时分别处理。不要使用 launch/restart 命令替用户启动框架；也不创建自己的 input context 假装控制 VS Code 当前 context。

IBus 私有 ASCII/中文模式没有在此方案中承诺统一接口。代码输入方案也由枚举/记录产生，不硬编码 `xkb:us::eng` 或 libpinyin。

## 4. X11 / Wayland 与焦点

命令通过框架通信，不把 X11 窗口模拟作为通用路径。但同一个工具能运行不表示所有桌面行为相同；X11、Wayland、Electron 原生 Wayland/XWayland、桌面、输入法模块、沙箱安装分别验证。

Linux CLI 后端通常只能提供 bestEffort 焦点保护：扩展窗口焦点和有效交互门控不等于框架对每次设置提供精确目标窗口绑定。Wayland 无可假设通用的前台窗口查询，不引入兼容层来伪造该能力。

## 5. 发布记录

记录框架/工具/桌面版本、会话协议、架构、安装方式、环境变量的必要非敏感摘要、源 ID 类型、焦点保护等级与候选词测试。未运行环境明确标“未进行真实环境验证”。

测试框架缺失/未运行、双框架共存、D-Bus 断连、源失效、多窗口、睡眠恢复、远程工作区。只有进程启动成本测量显示瓶颈后，才评估直连 D-Bus；变更需重新比较包体、内存、依赖和维护成本。
