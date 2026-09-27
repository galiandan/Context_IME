import { execFile, type ChildProcess } from "node:child_process";
export class ProcessRunner {
  private children = new Set<ChildProcess>();
  private disposed = false;
  count = 0;
  async run(
    file: string,
    args: readonly string[],
    timeout = 1500,
  ): Promise<string> {
    if (this.disposed) throw new Error("DISPOSED");
    this.count++;
    return new Promise((resolve, reject) => {
      let failure: string | undefined,
        output = "";
      const child = execFile(
        file,
        [...args],
        {
          shell: false,
          windowsHide: true,
          encoding: "utf8",
          maxBuffer: 65536,
          timeout,
          killSignal: "SIGKILL",
        },
        (error, stdout) => {
          output = stdout;
          if (error)
            failure = error.killed
              ? "TIMEOUT"
              : "code" in error &&
                  error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
                ? "OUTPUT_LIMIT"
                : "PROCESS_FAILED";
        },
      );
      this.children.add(child);
      child.once("error", () => {
        failure = "BACKEND_UNAVAILABLE";
      });
      // close follows exit AND stdout/stderr closure. Never release the transaction on timeout alone.
      child.once("close", () => {
        this.children.delete(child);
        if (failure) reject(new Error(failure));
        else resolve(output);
      });
    });
  }
  dispose() {
    this.disposed = true;
    for (const child of this.children) child.kill("SIGKILL");
  }
}
