import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
const arch = process.env.TARGET_ARCH ?? process.arch;
if (!["x64", "arm64"].includes(arch)) throw Error("Unsupported architecture");
const out = `native/bin/${process.platform}-${arch}`;
if (process.platform === "win32" || process.platform === "darwin")
  mkdirSync(out, { recursive: true });
if (process.platform === "win32")
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
      "user32.lib",
      "advapi32.lib",
      "/link",
      "/SUBSYSTEM:CONSOLE",
    ],
    { stdio: "inherit" },
  );
else if (process.platform === "darwin")
  execFileSync(
    "xcrun",
    [
      "clang++",
      "-std=c++17",
      "-O2",
      "-fobjc-arc",
      "-arch",
      arch === "x64" ? "x86_64" : "arm64",
      "-mmacosx-version-min=11.0",
      "native/macos.mm",
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
