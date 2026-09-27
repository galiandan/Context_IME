# 0.1.0 本地交付记录（历史）

> 以下命令、工具环境和路径是初次交付时的记录。当前已使用系统 Node/npm，旧启动器、早期 VSIX 和临时日志已清理；现行目录与命令见 [development.md](development.md)。原始性能证据仍已归档保留。

本轮从已有设计文档实现可运行扩展，没有清空目录、回滚文件、安装系统组件、修改当前用户输入法或发布 Marketplace。初始目录不是 Git 仓库，故没有创建 Git 提交；package-lock.json 和所有源码实际落盘。

## 实际文件与功能

- src/context：TextMate/Oniguruma 离线按需加载、五种语言插入位置分类、嵌套 scopes、行级编辑映射/状态收敛、有界缓存和取消。
- src/core：区域去重、保留手动切换、延迟合并、generation 快照重验、串行事务、最新待执行目标及失败熔断。
- src/platform：受限 execFile runner，Fcitx5/IBus 探测/记录或枚举/设置/读回，Windows/macOS 包内 helper 协议。
- src/extension.ts：稳定 API 门控、四个命令、机器级输入方案、配置暂停、状态栏、诊断、远程文档 API。
- native：Windows C++、macOS Objective-C++ 原创 helper；scripts/native.mjs 双架构构建；.github/workflows/ci.yml 三系统构建矩阵。
- package.json、package-lock.json、strict tsconfig、ESLint、esbuild、F5、测试/基准/本地打包脚本、固定 grammar/WASM、完整许可证。

## 本机执行结果

本机 PATH 无 Node/npm，复用 `/usr/share/code/code` 的 Node 24.20.0，项目 .tools/bin 入口与 npm 10.9.2；无系统安装。命令前使用 `export PATH="$PWD/.tools/bin:$PATH"`。

| 实际命令 | 结果 |
|---|---|
| npm install / npm ci --no-audit --no-fund | 完成依赖安装；锁文件存在；系统未安装 Node |
| npm run lint | 通过 |
| npm run typecheck | strict 通过 |
| npm test | 79 项自动测试通过（分类、缓存、调度、进程、协议） |
| npm run build | esbuild Node bundle 成功；grammar 哈希检查通过 |
| npm run test:integration | VS Code 1.139.1 本地 UI Extension Host 通过；隔离配置，set=0 |
| npm run bench | 完成小文件、一万行、四万行、暖缓存、输入、多行定界符、内存与真实只读查询 |
| node scripts/bench/cold-bench.mjs | 30 次全新进程冷启动完成，包含 unknown 统计 |
| node --import tsx scripts/bench/idle.ts | 300 秒无新增调用 |
| npm run native:build | Linux 使用系统 CLI，没有需要编译的自有 helper |
| npm run package | Linux x64 VSIX 成功；未发布 |
| code --user-data-dir artifacts/install-profile --extensions-dir artifacts/installed-extensions --install-extension <VSIX> | 独立配置/扩展目录安装成功，不修改用户已有扩展目录 |
| python scripts/verify-vsix.py | 解包核验 grammar/WASM 哈希、依赖闭包、许可证、main、ui、无开发依赖 |

初轮失败（缺依赖 grammar、JS 行末与 C++ raw scope、VSCE 缺仓库相对链接）均有修复；最终状态以上表为准。原始命令日志在 artifacts/，测试文件不打包为运行依赖。

VSIX：`/mnt/data/VsCode_Aut_Ime/artifacts/vscode-auto-ime-0.1.0-linux-x64.vsix`。最终大小与 SHA-256 见 artifacts/vsix-verification.json。包内只有 Linux 所需运行资源，Windows/macOS 缺 helper 时脚本拒绝生成对应包。

## 验证边界与未完成项

[四级兼容性](compatibility.md)明确区分已实现、构建、自动测试和实机。Windows/macOS 源码已经实现，但本机没有对应 SDK/系统，未编译、未运行；CI 尚未远程执行。Windows 当前是 KLID 布局能力，TSF profile、IME open/conversion 不支持。IBus 协议自动测试通过，本机没有 IBus。Remote-SSH/WSL/Containers 的宿主策略已实现，未在真实远程会话验证。

本机 Fcitx5 5.1.23/Wayland 的无副作用探测与读回成功，**没有执行真实切换**。因此候选词、手动切换、编辑区与其他输入控件、按应用记忆和多窗口，均没有标为实机通过。公开 API 的焦点/composition 限制仍存在。

缓存是整文档估算预算，未实现设计中的精细 token/checkpoint 分层淘汰；四万行 fixture 达上限后 unknown。冷启动可能因首次正则编译的 5ms 分词预算返回 unknown，下次交互可继续。全新进程/全宿主内存、关闭扩展对照、原生 helper RSS/真实切换延迟和功耗没有完整实测。详细数据及样本数见 [performance-results.md](performance-results.md)，不把降级样本或 Fake 调用包装为系统切换成功。

## 当前机器调试与安装

当前目录用 VS Code 打开，按 F5 选择“Context IME”。Linux 构建任务已加入项目 .tools/bin；其他机器安装自己的 Node 22+，执行 npm ci。开发宿主首次使用运行“Context IME：配置输入方案”，配置期间不试切。配置后回单光标编辑区执行“重新同步”。

安装当前 VSIX：

```sh
code --install-extension /mnt/data/VsCode_Aut_Ime/artifacts/vscode-auto-ime-0.1.0-linux-x64.vsix
```

启停使用状态栏或 autoIme.toggle；出现问题用 autoIme.diagnostics 查看本地计数/能力/最近观测。停用不会尝试恢复或修改其他应用的输入源。包的 publisher `context-ime-local` 仅用于本地构建，没有注册/发布 Marketplace。
