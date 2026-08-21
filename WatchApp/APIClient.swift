import Foundation

enum APIError: LocalizedError {
    case badURL
    case badResponse
    case bridgeUnavailable
    case server(String)

    var errorDescription: String? {
        switch self {
        case .badURL: return "Backend URL is invalid."
        case .badResponse: return "Backend did not return a valid response."
        case .bridgeUnavailable: return "Bridge is unavailable. Check that the Mac bridge and tunnel are running."
        case .server(let message): return message
        }
    }
}

final class APIClient: @unchecked Sendable {
    private let baseURLs: [URL]
    private let token: String?
    private let session: URLSession
    private let lock = NSLock()
    private var activeBaseURL: URL?

    init(baseURLs: [URL] = BridgeConfig.baseURLs, token: String? = BridgeConfig.bearerToken, session: URLSession = APIClient.makeSession()) {
        self.baseURLs = baseURLs
        self.token = token
        self.session = session
    }

    func projects() async throws -> [Project] {
        try await get("projects", as: ProjectsResponse.self).projects
    }

    func limits() async throws -> AccountLimits {
        try await get("limits", as: LimitsResponse.self).limits
    }

    func threads(projectId: String) async throws -> [CodexThread] {
        try await get("projects/\(projectId.urlPathEscaped)/threads", as: ThreadsResponse.self).threads
    }

    func createThread(projectId: String, title: String) async throws -> CodexThread {
        try await post("projects/\(projectId.urlPathEscaped)/threads", body: ["title": title], as: ThreadResponse.self).thread
    }

    func thread(_ id: String) async throws -> CodexThread {
        try await get("threads/\(id.urlPathEscaped)", as: ThreadResponse.self).thread
    }

    func messages(threadId: String) async throws -> [ChatMessage] {
        try await get("threads/\(threadId.urlPathEscaped)/messages", as: MessagesResponse.self).messages
    }

    func status(threadId: String) async throws -> ThreadStatus {
        try await get("threads/\(threadId.urlPathEscaped)/status", as: StatusResponse.self).status
    }

    func sendMessage(threadId: String, text: String) async throws -> CodexThread {
        try await post("threads/\(threadId.urlPathEscaped)/messages", body: ["text": text], as: ThreadResponse.self).thread
    }

    private func get<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        try await request(path, method: "GET", body: Optional<[String: String]>.none, as: type)
    }

    private func post<T: Decodable>(_ path: String, body: [String: String], as type: T.Type) async throws -> T {
        try await request(path, method: "POST", body: body, as: type)
    }

    private func request<Body: Encodable, T: Decodable>(_ path: String, method: String, body: Body?, as type: T.Type) async throws -> T {
        do {
            return try await request(path, method: method, body: body, as: type, baseURL: try await resolvedBaseURL())
        } catch {
            guard shouldRediscover(after: error, method: method) else { throw error }
            clearActiveBaseURL()
            return try await request(path, method: method, body: body, as: type, baseURL: try await resolvedBaseURL())
        }
    }

    private func request<Body: Encodable, T: Decodable>(_ path: String, method: String, body: Body?, as type: T.Type, baseURL: URL) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw APIError.badURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.badResponse }
        if (200..<300).contains(http.statusCode) {
            return try JSONDecoder().decode(T.self, from: data)
        }
        if let error = try? JSONDecoder().decode(ErrorResponse.self, from: data) {
            throw APIError.server(error.error)
        }
        throw APIError.server("Backend returned HTTP \(http.statusCode).")
    }

    private func resolvedBaseURL() async throws -> URL {
        if let active = readActiveBaseURL() {
            return active
        }

        for candidate in baseURLs {
            if await isHealthy(candidate) {
                writeActiveBaseURL(candidate)
                return candidate
            }
        }

        throw APIError.bridgeUnavailable
    }

    private func isHealthy(_ baseURL: URL) async -> Bool {
        guard let url = URL(string: "health", relativeTo: baseURL) else { return false }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 4
        request.setValue("application/json", forHTTPHeaderField: "accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        }

        do {
            let (_, response) = try await session.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    private func shouldRediscover(after error: Error, method: String) -> Bool {
        guard let urlError = error as? URLError else { return false }
        switch urlError.code {
        case .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed, .notConnectedToInternet:
            return true
        case .networkConnectionLost, .timedOut:
            return method == "GET"
        default:
            return false
        }
    }

    private func readActiveBaseURL() -> URL? {
        lock.lock()
        defer { lock.unlock() }
        return activeBaseURL
    }

    private func writeActiveBaseURL(_ url: URL) {
        lock.lock()
        activeBaseURL = url
        lock.unlock()
    }

    private func clearActiveBaseURL() {
        lock.lock()
        activeBaseURL = nil
        lock.unlock()
    }

    private static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 30
        return URLSession(configuration: configuration)
    }
}

private extension String {
    var urlPathEscaped: String {
        addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? self
    }
}
