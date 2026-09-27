# 发布与更新

从 0.1.7 起，默认流程固定为：**提交并推送 → GitHub Actions 编译/打包 → 下载并校验产物 → 原样发布 Marketplace**。开发机器不编译 Windows/macOS helper，也不在发布时重新打包。

## 一次版本更新

1. 用 `npm version <新版本> --no-git-tag-version` 同步 package.json/lock；更新 CHANGELOG 和需要的说明。
2. 提交所有应发布的改动并 push；分支 CI 会构建五个平台。也可推送匹配版本的 Tag，触发 GitHub Release 流程。
3. 等待 CI/Release 全部成功；失败则修复后重新提交，不发布部分失败构建。
4. 在该构建提交的干净工作区执行：

```sh
npm run publish:marketplace -- --run-id <GitHub运行ID> --dry-run
# 确认需要公开发布后（已获得发布授权时无需再询问）：
npm run publish:marketplace -- --run-id <GitHub运行ID>
```

脚本核对固定仓库 galiandan/Context_IME、workflow 名称、事件类型、success 状态和 HEAD。拒绝 PR 构建、不一致提交或未提交源码。下载到独立的 artifacts/vsix/github-<运行ID>-<随机后缀>/ 下，每个 vsix-<target> 子目录包含原始 VSIX。每次执行使用新目录，避免复用旧包。

五个平台的版本、发布者、grammar/WASM 哈希、README、helper 架构及 macOS 执行权限全部通过后，调用项目级 vsce publish --packagePath，上传这些文件；不执行 npm run build/package。dry-run 同样下载和校验，但不登录或上传。源选择/真实桌面验证状态应如实记录，CI 编译通过不能代替实机验证。

Marketplace 的五个上传操作不是原子事务；若部分平台已成功而后续失败，检查日志和市场已有目标，只重试缺失目标，不删除已发布版本。必要时使用项目级 `node node_modules/@vscode/vsce/vsce publish --packagePath <已校验的缺失平台VSIX>`。

## 凭据

首次在本机执行 `npm run marketplace:login`，Publisher 为 Galiandan-CIO；凭据存储由 vsce 管理，不提交到仓库。可使用已有 VSCE_PAT 环境变量或受支持的 Azure 凭据。GitHub 下载使用 gh 的已有登录。不要把 PAT 写进命令行参数、日志或配置文件。

GitHub workflow 当前只自动发布 GitHub Release。未来若在 Actions 内上传 Marketplace，必须使用 Actions Secret `VSCE_PAT`；本机登录不会自动传给 GitHub Runner。

## 本地打包

`npm run package -- <target>` 仍可供调试；所有目标都使用 README.marketplace.md，包名自动读取 package.json。`package:marketplace` 保留为 Linux 本地打包的兼容入口，输出带 publisher 后缀；它不再是默认发布来源。不要用本地包替换刚下载的 CI 产物。
