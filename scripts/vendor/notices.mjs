import { readFile, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const names = ["vscode-textmate", "vscode-oniguruma"];
const manifest = [];
for (const name of names) {
  const p = JSON.parse(
    await readFile(`node_modules/${name}/package.json`, "utf8"),
  );
  let license;
  for (const f of ["LICENSE.txt", "LICENSE.md", "LICENSE"]) {
    try {
      await copyFile(
        `node_modules/${name}/${f}`,
        `licenses/${name}-LICENSE.txt`,
      );
      license = `licenses/${name}-LICENSE.txt`;
      break;
    } catch {}
  }
  if (!license) throw Error("missing license " + name);
  const registry = await (
    await fetch(`https://registry.npmjs.org/${name}/${p.version}`)
  ).json();
  manifest.push({
    name,
    version: p.version,
    repository: p.repository,
    commit: {
      "vscode-textmate": "f0f2a44b4c055b0e0fa3869e5de338efda5b7cf1",
      "vscode-oniguruma": "184a6e2d4603c5a31efc0a33f544be1545d9ec6b",
    }[name],
    integrity: registry.dist.integrity,
    license: p.license,
    licenseFile: license,
  });
}
await copyFile(
  "node_modules/vscode-oniguruma/NOTICES.txt",
  "licenses/vscode-oniguruma-NOTICES.txt",
);
manifest.push({
  name: "onig.wasm",
  from: "vscode-oniguruma@2.0.1",
  sha256: createHash("sha256")
    .update(await readFile("resources/onig.wasm"))
    .digest("hex"),
});
await writeFile(
  "resources/manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  "THIRD_PARTY_NOTICES.md",
  `# 第三方资源\n\n运行时全部离线。精确 npm 版本、完整性见 package-lock.json；运行时包 commit 和 WASM 哈希见 resources/manifest.json；grammar commit、哈希、依赖图和本地补丁见 grammars/manifest.json。\n\n- vscode-textmate 9.2.0：Microsoft，MIT，licenses/vscode-textmate-LICENSE.txt。\n- vscode-oniguruma 2.0.1：Microsoft，MIT；Oniguruma 内嵌许可也保留于 licenses/vscode-oniguruma-LICENSE.txt 和 licenses/vscode-oniguruma-NOTICES.txt。\n- Python：MagicStack/MagicPython；C：jeff-hykin/better-c-syntax；C++ 及宏：jeff-hykin/better-cpp-syntax；JS/TS：microsoft/TypeScript-TmLanguage。使用 VS Code 1.95.3 固定 commit 内的转换产物，各上游版权与 MIT 正文见 licenses/vscode-ThirdPartyNotices.txt 对应条目；VS Code 许可见 licenses/vscode-LICENSE.txt。\n- C/C++ 可选嵌入高亮已删除，宏依赖完整分发；不是复制另一套词法引擎。\n- 本项目 helper 为原创；im-select、auto-ime、SmartCursor 仅作接口/交互研究，未复制其代码或二进制。系统 Fcitx5/IBus 不复制到扩展包。\n- esbuild、TypeScript、tsx、eslint、vsce 等仅是构建/测试依赖，不随 VSIX 分发；完整锁定树在 package-lock.json。\n`,
);
