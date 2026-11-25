import UIKit
import Capacitor

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
}

private struct StaticExportRouter: Router {
    private var fallback = CapacitorRouter()

    var basePath: String {
        get { fallback.basePath }
        set { fallback.basePath = newValue }
    }

    func route(for path: String) -> String {
        if URL(fileURLWithPath: path).pathExtension.isEmpty {
            let root = URL(fileURLWithPath: basePath, isDirectory: true).standardizedFileURL
            let relative = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            let index = root.appendingPathComponent(relative, isDirectory: true)
                .appendingPathComponent("index.html").standardizedFileURL
            if index.path.hasPrefix(root.path + "/"), FileManager.default.fileExists(atPath: index.path) {
                return index.path
            }
        }
        return fallback.route(for: path)
    }
}
