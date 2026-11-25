import Foundation

enum BundleAssetPath {
    static func relativeRequestPath(_ encodedPath: String) -> String? {
        if encodedPath.isEmpty { return "" }
        guard let path = encodedPath.removingPercentEncoding,
              path.hasPrefix("/") else { return nil }
        let relative = String(path.dropFirst())
        guard isValidRelativePath(relative) else { return nil }
        return relative.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private static func isValidRelativePath(_ path: String) -> Bool {
        guard !path.hasPrefix("/"), !path.contains("\\"), !path.contains("%"),
              !path.contains("\0"),
              !path.hasPrefix("_capacitor_file_"),
              !path.hasPrefix("_capacitor_http_interceptor_") else { return false }
        return !path.split(separator: "/").contains { $0 == "." || $0 == ".." }
    }

    static func resolve(_ relative: String, in directory: URL) -> URL? {
        guard isValidRelativePath(relative) else { return nil }
        let root = directory.standardizedFileURL.resolvingSymlinksInPath()
        if !(relative as NSString).pathExtension.isEmpty {
            return containedFile(relative, in: root)
        }
        let index = relative.isEmpty ? "index.html" : relative + "/index.html"
        return containedFile(index, in: root) ?? containedFile("index.html", in: root)
    }

    private static func containedFile(_ relative: String, in root: URL) -> URL? {
        let file = root.appendingPathComponent(relative).standardizedFileURL.resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        guard file.path.hasPrefix(root.path + "/"),
              FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory),
              !isDirectory.boolValue else { return nil }
        return file
    }
}
