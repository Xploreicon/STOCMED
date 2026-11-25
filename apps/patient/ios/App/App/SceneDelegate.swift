import UIKit
import Capacitor
import WebKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = PatientBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

private final class PatientBridgeViewController: CAPBridgeViewController {
    override func router() -> Router {
        StaticExportRouter()
    }

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let original = super.webViewConfiguration(for: instanceConfiguration)
        let configuration = BundleOnlyWebViewConfiguration()
        configuration.websiteDataStore = original.websiteDataStore
        configuration.preferences = original.preferences
        configuration.defaultWebpagePreferences = original.defaultWebpagePreferences
        configuration.allowsInlineMediaPlayback = original.allowsInlineMediaPlayback
        configuration.suppressesIncrementalRendering = original.suppressesIncrementalRendering
        configuration.allowsAirPlayForMediaPlayback = original.allowsAirPlayForMediaPlayback
        configuration.mediaTypesRequiringUserActionForPlayback = original.mediaTypesRequiringUserActionForPlayback
        configuration.limitsNavigationsToAppBoundDomains = original.limitsNavigationsToAppBoundDomains
        configuration.applicationNameForUserAgent = original.applicationNameForUserAgent
        return configuration
    }
}

private final class BundleOnlyWebViewConfiguration: WKWebViewConfiguration {
    override func setURLSchemeHandler(_ handler: WKURLSchemeHandler?, forURLScheme scheme: String) {
        if scheme == "capacitor", let handler {
            super.setURLSchemeHandler(BundleOnlySchemeHandler(original: handler), forURLScheme: scheme)
        } else {
            super.setURLSchemeHandler(handler, forURLScheme: scheme)
        }
    }
}

private struct StaticExportRouter: Router {
    var basePath = ""

    func route(for path: String) -> String {
        let directory = Bundle.main.bundleURL.appendingPathComponent("public", isDirectory: true)
        guard let relative = BundleAssetPath.relativeRequestPath(path),
              let file = BundleAssetPath.resolve(relative, in: directory) else {
            // A directory cannot be returned as file content by the asset handler.
            return directory.path
        }
        return file.path
    }
}

private final class BundleOnlySchemeHandler: NSObject, WKURLSchemeHandler {
    private let original: WKURLSchemeHandler

    init(original: WKURLSchemeHandler) {
        self.original = original
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let directory = Bundle.main.bundleURL.appendingPathComponent("public", isDirectory: true)
        guard let url = task.request.url,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme == "capacitor", components.host == "localhost",
              components.port == nil, components.user == nil, components.password == nil,
              let relative = BundleAssetPath.relativeRequestPath(components.percentEncodedPath),
              let handlerRelative = BundleAssetPath.relativeRequestPath(url.path),
              relative == handlerRelative,
              BundleAssetPath.resolve(relative, in: directory) != nil else {
            task.didFailWithError(URLError(.resourceUnavailable))
            return
        }

        original.webView(webView, start: task)
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        original.webView(webView, stop: task)
    }
}
