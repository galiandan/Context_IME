# 脚本入口

所有命令从项目根目录执行，优先使用 package.json 中的 npm scripts。npm 工具从项目 node_modules 解析。

- 根目录：日常构建、清理、集成测试、原生构建、打包、发布、VSIX 核验。
- `bench/`：性能基准、冷启动、空闲观察、报告生成。结果写入 artifacts/reports/。
- `repro/`：固定的语法/事件复现，不处理用户文档。示例：`node --import tsx scripts/repro/include-repro.ts`。
- `vendor/`：显式资源维护与参考源码核验，会访问上游。日常安装、构建、测试、打包不调用这些网络维护脚本。

详见 [开发指南](../docs/development.md)。
