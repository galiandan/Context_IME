# 在本地终端发布与更新

发布者 `Galiandan-CIO`，扩展完整 ID `Galiandan-CIO.vscode-auto-ime`。项目已安装固定版本的 vsce，不需要额外全局安装。发布脚本目前只上传 Linux x64 包；使用 README.marketplace.md，包含图标和离线资源。

## 当前机器的终端准备

当前机器使用 pacman 安装的系统 Node.js/npm，直接在工程目录运行 npm 命令，不再需要手动 export PATH。新机器先安装 Node/npm，再执行 `npm ci`；vsce 随项目 devDependencies 安装，不需要全局安装。

已有的 `Galiandan-CIO` 登录不受本次目录整理影响；未删除或重建认证信息。

## 首次认证：本地 PAT 登录

在 Azure DevOps 创建 Personal Access Token，选择 **All accessible organizations** 与 **Marketplace → Manage** 权限，并设置适当的有效期；使用拥有该 Publisher 发布权限的账号。

```sh
npm run marketplace:login
```

只在终端的交互提示中输入 PAT，不放到命令行参数、package.json、聊天、日志或源码里。网页登录市场不会自动完成 vsce 的终端认证。PAT 过期后重新登录。若需要临时环境变量方式，vsce 也支持本机 `VSCE_PAT`，不要把值提交到工程。

认证政策核验日期为 2026-09-27：官方已公告 Azure DevOps 的 global PAT 将在 **2026-12-01** 退役，并推荐 Microsoft Entra ID。上面的 PAT 方式是当前仍支持的本地路径，不应作为永久自动化方案。已配置相应 Entra 凭据及 Publisher 权限时，可使用：

```sh
npm run publish:marketplace -- --azure-credential
```

该参数不会替你创建 Azure 账号、身份或授权。官方认证与发布说明：https://code.visualstudio.com/api/working-with-extensions/publishing-extension

## 后续发布一个更新

完成修改后，更新 CHANGELOG.md 和市场介绍页，再递增版本。例如当前本地 0.1.3，下一次修复可升级为 0.1.4：

```sh
npm version patch --no-git-tag-version
npm run publish:marketplace -- --dry-run
npm run publish:marketplace
```

- version 命令同步更新 package.json 和 package-lock.json，不自动创建 Git tag；确认发布后可按需要记录 Git 提交和标签。
- dry-run 执行 lint、strict typecheck、全部单元测试及市场专用打包，不认证、不上传，也不改变版本号。
- 不带 dry-run 时重复这些检查，成功后通过 `vsce publish --packagePath <本次生成包>` 上传，确保发布的是刚刚打出的 Linux x64 市场包。
- 每次更新使用新的版本号；不要尝试覆盖已经发布的相同版本。发布脚本不自动递增版本、不自动重试上传。
- 以上发布测试不包含真实输入法设置。涉及事件/焦点改动时，发布前另运行 npm run test:integration 并完成必要的实机回归。

如果只想手工上传，继续使用 `npm run package:marketplace`，然后从 artifacts/vsix/ 目录拿到 VSIX。所有登录和发布均是显式命令；npm install、npm ci、npm run build 不上传市场。
