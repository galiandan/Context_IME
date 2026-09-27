# GitHub Actions 构建与 Release

> 后续验证更新：0.1.8 的五平台 CI 已全部成功，VSIX 已下载校验并逐目标发布 Marketplace。Swift/Win32 在对应 Runner 编译；真实桌面输入法仍未验证。[完整记录](0.1.8-release.md)。


开发者只需提交源码，不需要本机安装 Xcode/Swift/MSVC。macOS SDK 类型检查、Swift 编译以及 Windows C++ 编译由 GitHub-hosted Runner 完成。

## 已有命令核对

- `npm ci`：按 package-lock.json 安装项目级依赖，校验与 package.json 一致并重建 node_modules；会执行依赖所需安装脚本（如 esbuild）。根项目没有 install/prepare 等原生构建钩子，不会编译 Swift/Win32。所有 npm 工具使用项目安装，不全局安装。
- `xcrun swiftc -swift-version 5 -typecheck native/macos.swift`：使用 Runner 系统 SDK 做 Swift 5 语言模式的类型检查，不产生 helper，也不执行输入法切换。
- `TARGET_ARCH=arm64 npm run native:build`：在 macOS 调用 xcrun swiftc，以 arm64-apple-macosx11.0 为目标、开启优化，输出 native/bin/darwin-arm64/context-ime。Windows 调用已配置架构的 cl.exe；Linux 只报告使用已有 Fcitx5/IBus，无 helper 可编译。
- `npm run package -- darwin-arm64`：先要求 helper 存在，再调用项目级 vsce。vsce 自动运行 vscode:prepublish → npm run build（校验 grammar、复制 WASM、esbuild 打包），所以 workflow 不额外重复 build。输出 artifacts/vsix/<name>-<version>-darwin-arm64.vsix。

## CI

`.github/workflows/ci.yml`：分支 push、pull_request、手动 workflow_dispatch，以及 Release 的 workflow_call。普通 CI 排除 Tag，避免与 Release 重复构建。只有 contents: read，checkout 不持久化令牌。每个 job 最多 20 分钟，各平台并行且互不提前取消。

| Runner | 目标 | 原生构建 |
|---|---|---|
| ubuntu-latest | linux-x64 | 无独立 helper，打包 TS/WASM/grammar |
| windows-latest | win32-x64 | MSVC amd64，C++ /W4 /analyze |
| windows-latest | win32-arm64 | MSVC amd64_arm64 交叉编译；TS 测试宿主仍为 x64 |
| macos-15-intel | darwin-x64 | 系统 Swift，Intel 目标 |
| macos-latest | darwin-arm64 | 系统 Swift，Apple Silicon 目标 |

所有 job：checkout → Node 22/npm 下载缓存（以锁文件为依据）→ npm ci → npm run check（lint/typecheck/test）→ native:build → package → verify-vsix.py → upload-artifact。每个干净 Runner 只安装一次依赖，node_modules 不跨操作系统共享。不运行重型 benchmark、交互式桌面/输入法测试，不签名或自动安装输入法组件。

macOS 还输出 xcodebuild -version、xcrun swiftc --version、uname -m，校验 Runner 架构，然后执行指定的 Swift typecheck。Runner 标签依据 [GitHub 官方表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)；如果未来标签或架构变化，检查会明确失败。

## helper 如何入包

scripts/native.mjs 输出 native/bin/<目标>/context-ime（Windows 为 .exe）。.vscodeignore 包含 native/bin，vsce --ignore-other-target-folders 只保留目标目录。脚本缺 helper 即失败；verify-vsix.py 检查 VSIX manifest、版本、PE/Mach-O 架构、macOS 执行权限，以及只包含一个目标 helper。Linux 包不得包含其他平台 helper。grammar/WASM/许可证也校验。

Artifact 名称为 vsix-linux-x64、vsix-win32-x64、vsix-win32-arm64、vsix-darwin-x64、vsix-darwin-arm64，每个包含一个 `<package.name>-<package.version>-<target>.vsix`。例如 vscode-auto-ime-0.1.6-darwin-arm64.vsix。VSIX 已压缩，上传不再额外压缩；保存 14 天，无文件即失败。GitHub Release 附件独立保存，不受 Artifact 的 14 天期限限制。

## Tag Release

`.github/workflows/release.yml` 监听 `v*.*.*` Tag push，再严格校验仅接受 `vX.Y.Z`（不接受 prerelease、前导零），且必须与 package.json、lock 顶层与根包版本/名称一致。不自动修改版本，不借 Tag 重写包身份。

流程：版本检查 → 复用 CI 五平台矩阵 → 下载本次运行 Artifact → 检查五个文件完整且无额外 VSIX → 再次验证包 → SHA256SUMS.txt → 创建 draft 并上传五个 VSIX 和校验清单 → 转为公开 GitHub Release。任何平台失败均不发布；拒绝覆盖已有 Release。若上传时失败留下 draft，检查后删除该 draft，再重跑 release job；不会自动删除已有发布内容。相同 Tag 的并发执行排队，不中途取消上传。

版本准备示例（自行选择尚未发布版本）：

```sh
npm version 0.1.9 --no-git-tag-version
# 提交所有应发布的源码、workflow、package.json 和 package-lock.json
# 确认工作区内容已经进入该提交后：
git tag v0.1.9
git push origin main
git push origin v0.1.9
```

上方命令是 Tag Release 的示例，实际使用时应把 `npm version` 与 Tag 都换成尚未发布的同一版本。0.1.8 的真实分支构建与 Marketplace 发布见下方记录；该次没有创建 Tag/GitHub Release。

## 权限与 Marketplace

正常仓库启用 Actions 即可，不需要手动新增 Secret，不需要把 Workflow permissions 全局改为读写。仅 release job 显式申请 contents: write，GH_TOKEN 使用自动 GITHUB_TOKEN；构建 job 保持只读。若组织策略禁用 Actions、GitHub-hosted Runner 或限制可用 Action，需要管理员允许 actions/checkout、setup-node、upload-artifact、download-artifact、ilammy/msvc-dev-cmd。Fork PR 首次运行可能需要仓库维护者批准，这不是 PAT 配置。

Marketplace 登录命令保留；publish:marketplace 现改为接收 --run-id，下载成功 CI 的五个平台包，校验后原样上传。workflow 本身不调用 Marketplace；本地使用已有安全凭据存储。若未来把上传放进 GitHub job，令牌只能来自 Actions Secrets 的 VSCE_PAT。详见 [发布步骤](publishing.md)。

## 0.1.8 实际运行

2026-09-27，提交 `c11331e602393ed6a88a0e09340f368a2e80a171` 推送到 `main` 后，GitHub Actions [运行 36313805381](https://github.com/galiandan/Context_IME/actions/runs/36313805381) 的五个平台 job 全部成功。每个 Runner 执行 `npm ci`、lint/typecheck/172 项测试、对应平台 native build、package 和 `verify-vsix.py`；五个 Artifact 下载后再次验证，通过项目级 vsce 原样上传 Marketplace。五个目标均返回 `Published ... v0.1.8` 成功结果。没有创建 Tag/GitHub Release，也没有在本地重新打包 Windows/macOS helper。

本机 Linux x64 上 `npm ci`、`npm run check`、`npm run package -- linux-x64` 和 VSIX 验证通过；工作流两份 YAML 由 actionlint 1.7.11 静态检查通过。Marketplace Gallery 更新后已将 0.1.8 列为最新版本；五个平台下载端点返回的 VSIX 经 HTTP gzip 解码后与 GitHub Artifact 逐字节一致。构建产物受 `.gitignore` 排除。

真实 Windows/macOS 桌面输入法、候选词、焦点/composition、X11/Wayland 会话仍未验证。Runner 给出 actions/checkout@v4、setup-node@v4、upload-artifact@v4 将由 Node 20 迁移到 Node 24 的提示；这次不影响构建结果，后续可单独更新 Action 主版本。
