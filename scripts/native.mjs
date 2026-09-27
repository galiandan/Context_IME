import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
const arch = process.env.TARGET_ARCH ?? process.arch;
if (!["x64", "arm64"].includes(arch)) throw Error("Unsupported architecture");
const out = `native/bin/${process.platform}-${arch}`;
if (process.platform === "win32" || process.platform === "darwin")
  mkdirSync(out, { recursive: true });
if (process.platform === "win32") {
  mkdirSync(`artifacts/tmp/native-${arch}`, { recursive: true });
  execFileSync(
    "cl.exe",
    [
      "/nologo",
      "/std:c++17",
      "/EHsc",
      "/O2",
      "/MT",
      "native/windows.cpp",
      `/Fe:${out}/context-ime.exe`,
      `/Fo:artifacts/tmp/native-${arch}/windows.obj`,
      "/W4",
      "/analyze",
      "user32.lib",
      "advapi32.lib",
      "/link",
      "/SUBSYSTEM:CONSOLE",
    ],
    { stdio: "inherit" },
  );
} else if (process.platform === "darwin")
  execFileSync(
    "xcrun",
    [
      "swiftc",
      "-swift-version",
      "5",
      "-O",
      "-whole-module-optimization",
      "-target",
      `${arch === "x64" ? "x86_64" : "arm64"}-apple-macosx11.0`,
      "native/macos.swift",
      "-framework",
      "AppKit",
      "-framework",
      "Carbon",
      "-o",
      `${out}/context-ime`,
    ],
    { stdio: "inherit" },
  );
else
  console.log(
    "Linux uses existing system fcitx5-remote / ibus; no helper binary.",
  );
