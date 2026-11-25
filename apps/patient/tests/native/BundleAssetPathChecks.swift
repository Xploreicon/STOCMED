import Foundation

@main
enum BundleAssetPathChecks {
    static func main() throws {
        let files = FileManager.default
        let directory = files.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let bundle = directory.appendingPathComponent("public")
        let dashboard = bundle.appendingPathComponent("dashboard")
        try files.createDirectory(at: dashboard, withIntermediateDirectories: true)
        defer { try? files.removeItem(at: directory) }

        let index = bundle.appendingPathComponent("index.html")
        let route = dashboard.appendingPathComponent("index.html")
        let script = bundle.appendingPathComponent("script.js")
        let sibling = directory.appendingPathComponent("outside.txt")
        for file in [index, route, script, sibling] { try Data("fixture".utf8).write(to: file) }
        try files.createSymbolicLink(at: bundle.appendingPathComponent("outside.txt"), withDestinationURL: sibling)

        precondition(BundleAssetPath.relativeRequestPath("") == "")
        precondition(BundleAssetPath.relativeRequestPath("/dashboard/") == "dashboard")
        precondition(BundleAssetPath.relativeRequestPath("/dashboard") == "dashboard")
        for unsafe in ["../outside.txt", "%2e%2e/outside.txt", "/absolute.txt"] {
            precondition(BundleAssetPath.resolve(unsafe, in: bundle) == nil, unsafe)
        }
        for unsafe in ["/../outside.txt", "/%2e%2e/outside.txt", "//absolute.txt",
                       "/_capacitor_file_/absolute.txt", "/_capacitor_http_interceptor_/request"] {
            precondition(BundleAssetPath.relativeRequestPath(unsafe) == nil, unsafe)
        }
        if let absolute = BundleAssetPath.relativeRequestPath("/absolute.txt") {
            precondition(BundleAssetPath.resolve(absolute, in: bundle) == nil)
        }
        precondition(BundleAssetPath.resolve("outside.txt", in: bundle) == nil)
        precondition(BundleAssetPath.resolve("missing.js", in: bundle) == nil)
        for (path, expected) in [("", index), ("dashboard/", route), ("missing-route", index), ("script.js", script)] {
            precondition(BundleAssetPath.resolve(path, in: bundle)?.path == expected.resolvingSymlinksInPath().path, path)
        }
        try files.removeItem(at: index)
        try files.createSymbolicLink(at: index, withDestinationURL: sibling)
        precondition(BundleAssetPath.resolve("missing-route", in: bundle) == nil)
        print("Bundle asset checks passed")
    }
}
