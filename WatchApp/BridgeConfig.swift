import Foundation

enum BridgeConfig {
    static let baseURL: URL = {
        baseURLs.first!
    }()

    static let baseURLs: [URL] = {
        let value = ProcessInfo.processInfo.environment["CODEX_WATCH_BRIDGE_URL"]
            ?? Bundle.main.object(forInfoDictionaryKey: "CodexBridgeURL") as? String
            ?? "http://127.0.0.1:8765"
        let candidates = [
            value,
            "http://Kirills-MacBook-Pro.local:8767",
            "http://192.168.1.116:8767",
            "http://192.168.1.103:8767",
            "http://192.168.3.1:8767",
            "http://192.168.2.1:8767",
            "http://127.0.0.1:8767",
            "http://127.0.0.1:8765"
        ]
        var seen = Set<String>()
        return candidates.compactMap { candidate in
            guard let url = URL(string: candidate), seen.insert(url.absoluteString).inserted else { return nil }
            return url
        }
    }()

    static let bearerToken: String? = {
        let value = ProcessInfo.processInfo.environment["CODEX_WATCH_BRIDGE_TOKEN"]
            ?? Bundle.main.object(forInfoDictionaryKey: "CodexBridgeToken") as? String
        guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return value
    }()
}
