# 开发与目录约定

## 工具和依赖

Node.js 与 npm 由系统管理；当前机器已用 pacman 安装，直接运行 `node` / `npm`，不再需要项目内的 Node/npm 启动器或手动 export PATH。本轮验证环境：Node 26.10.0、npm 12.1.0。

npm 分发的工具全部项目级安装：vsce、esbuild、TypeScript、ESLint、Prettier、tsx 及类型包在 devDependencies；TextMate、Oniguruma 在 dependencies。版本保持精确固定，package-lock.json 锁定完整依赖树，`.npmrc` 设置 `save-exact=true`。

```sh
npm ci                          # 按锁文件重建 node_modules
npm install -D --save-exact 包名@版本  # 新增开发工具
npm install --save-exact 包名@版本     # 新增运行依赖
```

npm 12 默认阻止未登记的依赖安装脚本。已在 package.json 的 allowScripts 中按精确版本登记 `esbuild@0.25.0`、`@vscode/vsce-sign@2.1.0`、`keytar@7.9.0`：分别用于构建程序、发布工具配套二进制和系统凭据绑定。没有全局放开脚本。升级这些依赖时需重新核对对应安装脚本；`npm install-scripts ls` 可以检查是否仍有未登记项。[npm 官方说明](https://docs.npmjs.com/cli/v12/commands/npm-install-scripts/)

通过 npm run 使用工具，npm 自动解析项目的 node_modules/.bin；不需要 `npm install -g`。不要全局安装项目工具，也不要把 node_modules 或凭据提交到源码。系统 npm 自带的全局配套包由 pacman 管理，本项目不移除它们。

## 日常命令

| 命令 | 用途/输出 |
|---|---|
| `npm run check` | lint → strict typecheck → 单元测试 |
| `npm run build` | esbuild 构建到 dist/，核对 grammar 哈希 |
| `npm run test:integration` | 独立 VS Code 配置；报告到 artifacts/reports/；结束自动清理临时配置 |
| `npm run bench` | 核心与只读后端基准，artifacts/reports/benchmark.json |
| `npm run bench:cold` | 30 次全新进程冷启动，artifacts/reports/cold-start.json |
| `npm run bench:idle` | 五分钟空闲观测，artifacts/reports/idle.json |
| `npm run bench:report` | 汇总最新基准到 artifacts/reports/performance.md |
| `npm run package` | 当前平台 VSIX，artifacts/vsix/ |
| `npm run package:marketplace` | Linux x64 市场专用 VSIX，artifacts/vsix/ |
| `npm run verify:vsix` | 检查当前市场包的身份、图标、README、grammar/WASM 哈希及许可证 |
| `npm run clean` | 删除 dist/、out/、artifacts/tmp/；保留安装包、报告、资源和依赖 |
| `npm run publish:marketplace -- --dry-run` | 检查并打市场包，不认证、不上传 |

F5 启动 Context IME 调试宿主；预启动任务直接使用系统 npm 执行项目 build。原生 helper 的 native:build 仍依赖对应系统已有的 SDK/编译器，不会自动安装系统组件。

## 目录

```text
src/                     扩展运行源码
native/                  Windows/macOS helper 源码
  bin/                   helper 编译产物（忽略）
tests/                   单元测试与 VS Code 集成入口
scripts/                 build、clean、integration、native、package、publish、verify-vsix
  bench/                 性能脚本与报告生成
  repro/                 固定语法/事件问题复现
  vendor/                资源下载、补丁、来源与许可证维护（仅显式执行）
grammars/                固定 grammar 和来源清单
resources/               Oniguruma WASM 与来源清单
licenses/                第三方许可证
media/                   图标
docs/                    设计、开发、发布和验证文档
  benchmarks/            已归档的原始性能证据
node_modules/            项目 npm 依赖（忽略）
dist/                    可重建的扩展 bundle（忽略）
artifacts/               本地生成物（忽略）
  vsix/                  安装/发布包
  reports/               最新检查、测试、基准及核验结果
  tmp/                   打包临时文件和集成测试中间产物
```

原始合并设计文档予以保留。docs/delivery.md 是 0.1.0 历史交付记录，不是当前环境说明；docs/performance-results.md 是 Node 24 下的历史实测，对应原始数据存入 docs/benchmarks/2026-09-27-node24/。新的基准报告不覆盖该历史报告。

资源维护通常不需要运行；正常 npm ci/build/package 全部使用包内固定资源，不从网络刷新 grammar。必要时在项目根目录执行 scripts/vendor 下的脚本，审查来源/哈希/许可证变更并重跑测试。顺序：vendor.py → patch-grammars.py；notices.mjs 用于同步 npm 资源许可与来源。这些脚本不是 npm install 的自动钩子。

## 认证和清理范围

发布者仍为 Galiandan-CIO，完整 ID 为 Galiandan-CIO.vscode-auto-ime。已有 vsce 登录信息保存在 vsce/系统凭据存储中，本轮没有读取、迁移或删除。系统 Node/npm、用户 VS Code 设置/已安装扩展、输入法配置也不属于项目清理范围。

本轮已删除旧的项目内 npm 启动器、0.1.0–0.1.2 VSIX、旧本地发布者的重复包、隔离安装/解包目录、失败尝试日志及构建中间产物。保留当前发布者的最新 VSIX、测试/性能原始证据、许可证与来源快照。清理清单位于 artifacts/reports/cleanup.json。没有递增扩展版本或上传市场。
