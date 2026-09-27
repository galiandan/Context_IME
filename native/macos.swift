import AppKit
import Carbon
import Foundation

// Short-lived CLI: never activates an application or synthesizes keyboard input.
// TIS Copy/Create results are owned; property pointers are borrowed.
func emit(_ object: [String: Any], code: Int32 = 0) -> Never {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          data.count < 65536 else { exit(1) }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
    exit(code)
}
func fail() -> Never { emit(["version": 1, "status": "failed"], code: 1) }
func identifier(_ source: TISInputSource) -> String? {
    guard let pointer = TISGetInputSourceProperty(source, kTISPropertyInputSourceID) else { return nil }
    let value = Unmanaged<CFString>.fromOpaque(pointer).takeUnretainedValue() as String
    guard !value.isEmpty, value.utf8.count <= 1024,
          !value.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else { return nil }
    return value
}
func current() -> String? {
    guard let source = TISCopyCurrentKeyboardInputSource()?.takeRetainedValue() else { return nil }
    return identifier(source)
}
func foreground(_ executable: String) -> NSRunningApplication? {
    // First .app ancestor covers VS Code's nested Electron Helper.app path.
    let components = URL(fileURLWithPath: executable).standardizedFileURL.pathComponents
    guard executable.hasPrefix("/"),
          let end = components.firstIndex(where: { $0.hasSuffix(".app") }),
          let app = NSWorkspace.shared.frontmostApplication,
          !app.isTerminated, let actual = app.bundleURL else { return nil }
    let expected = URL(fileURLWithPath: NSString.path(withComponents: Array(components[...end])))
    return actual.resolvingSymlinksInPath() == expected.resolvingSymlinksInPath() ? app : nil
}
func enabledSources() -> [TISInputSource] {
    let filter: [String: Any] = [
        kTISPropertyInputSourceIsEnabled as String: true,
        kTISPropertyInputSourceIsSelectCapable as String: true
    ]
    guard let list = TISCreateInputSourceList(filter as CFDictionary, false)?.takeRetainedValue(),
          let sources = list as? [TISInputSource], sources.count <= 512 else { fail() }
    return sources
}
func main() -> Never {
    let args = Array(CommandLine.arguments.dropFirst())
    guard let operation = args.first,
          ["get", "probe", "list", "target", "set"].contains(operation),
          args.count % 2 == 1 else { fail() }
    var options: [String: String] = [:]
    for index in stride(from: 1, to: args.count, by: 2) {
        let key = args[index]
        guard ["--app", "--source", "--target"].contains(key),
              options[key] == nil, !args[index + 1].isEmpty else { fail() }
        options[key] = args[index + 1]
    }
    guard let executable = options["--app"],
          Set(options.keys) == (operation == "set" ? Set(["--app", "--source", "--target"]) : Set(["--app"])) else { fail() }
    if operation == "list" {
        emit(["version": 1, "sources": Array(Set(enabledSources().compactMap(identifier))).sorted()])
    }
    guard let app = foreground(executable) else { fail() }
    let target = String(app.processIdentifier)
    if operation == "target" { emit(["version": 1, "target": target]) }
    if operation == "set" {
        guard options["--target"] == target,
              let desired = options["--source"], desired.utf8.count <= 1024,
              let selected = enabledSources().first(where: { identifier($0) == desired }),
              foreground(executable)?.processIdentifier == app.processIdentifier else { fail() }
        if current() != desired {
            guard TISSelectInputSource(selected) == noErr else { fail() }
            // One bounded settling interval, only when immediate observation differs.
            if current() != desired { CFRunLoopRunInMode(CFRunLoopMode.defaultMode, 0.03, false) }
        }
    }
    guard foreground(executable)?.processIdentifier == app.processIdentifier,
          let observed = current(),
          foreground(executable)?.processIdentifier == app.processIdentifier else { fail() }
    emit(["version": 1, "status": "observed", "sourceId": observed])
}
main()
