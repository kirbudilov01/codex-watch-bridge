import Foundation

struct Project: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let cwd: String?
    let threadCount: Int
    let activeCount: Int
    let updatedAt: String?

    init(id: String, name: String, cwd: String?, threadCount: Int, activeCount: Int, updatedAt: String?) {
        self.id = id
        self.name = name
        self.cwd = cwd
        self.threadCount = threadCount
        self.activeCount = activeCount
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? container.decodeFlexibleString(forKey: .id)) ?? UUID().uuidString
        name = (try? container.decodeFlexibleString(forKey: .name)) ?? "Project"
        cwd = try? container.decodeFlexibleString(forKey: .cwd)
        threadCount = (try? container.decodeFlexibleInt(forKey: .threadCount)) ?? 0
        activeCount = (try? container.decodeFlexibleInt(forKey: .activeCount)) ?? 0
        updatedAt = try? container.decodeFlexibleString(forKey: .updatedAt)
    }
}

struct CodexThread: Codable, Identifiable, Hashable {
    let id: String
    let source: String?
    let projectId: String
    let title: String
    let preview: String?
    let updatedAt: String?
    let status: ThreadStatus
    let codexThreadId: String?
    let tokenUsage: TokenUsage?

    init(id: String, source: String?, projectId: String, title: String, preview: String?, updatedAt: String?, status: ThreadStatus, codexThreadId: String?, tokenUsage: TokenUsage?) {
        self.id = id
        self.source = source
        self.projectId = projectId
        self.title = title
        self.preview = preview
        self.updatedAt = updatedAt
        self.status = status
        self.codexThreadId = codexThreadId
        self.tokenUsage = tokenUsage
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? container.decodeFlexibleString(forKey: .id)) ?? UUID().uuidString
        source = try? container.decodeFlexibleString(forKey: .source)
        projectId = (try? container.decodeFlexibleString(forKey: .projectId)) ?? ""
        title = (try? container.decodeFlexibleString(forKey: .title)) ?? "Untitled"
        preview = try? container.decodeFlexibleString(forKey: .preview)
        updatedAt = try? container.decodeFlexibleString(forKey: .updatedAt)
        status = (try? container.decode(ThreadStatus.self, forKey: .status)) ?? .idle
        codexThreadId = try? container.decodeFlexibleString(forKey: .codexThreadId)
        tokenUsage = try? container.decode(TokenUsage.self, forKey: .tokenUsage)
    }
}

struct TokenUsage: Codable, Hashable {
    let contextTokens: Int?
    let contextWindow: Int?
    let contextPercent: Int?
    let rateLimitPercent: Double?
    let updatedAt: String?

    init(contextTokens: Int?, contextWindow: Int?, contextPercent: Int?, rateLimitPercent: Double?, updatedAt: String?) {
        self.contextTokens = contextTokens
        self.contextWindow = contextWindow
        self.contextPercent = contextPercent
        self.rateLimitPercent = rateLimitPercent
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        contextTokens = try? container.decodeFlexibleInt(forKey: .contextTokens)
        contextWindow = try? container.decodeFlexibleInt(forKey: .contextWindow)
        contextPercent = try? container.decodeFlexibleInt(forKey: .contextPercent)
        rateLimitPercent = try? container.decodeFlexibleDouble(forKey: .rateLimitPercent)
        updatedAt = try? container.decodeFlexibleString(forKey: .updatedAt)
    }

    var limitPercent: Int? {
        if let rateLimitPercent {
            return Int(rateLimitPercent.rounded())
        }
        return nil
    }

    var limitLeftPercent: Int? {
        guard let rateLimitPercent else { return nil }
        return max(0, min(100, Int((100 - rateLimitPercent).rounded(.down))))
    }
}

struct AccountLimits: Codable, Hashable {
    let primary: AccountLimit?
    let buckets: [AccountLimit]
    let updatedAt: String?
    let source: String?
}

struct AccountLimit: Codable, Identifiable, Hashable {
    let id: String?
    let name: String?
    let usedPercent: Double?
    let secondaryUsedPercent: Double?
    let windowDurationMins: Int?
    let resetsAt: Double?
    let planType: String?
    let reached: Bool?

    var displayName: String {
        name ?? id ?? "Codex"
    }

    var roundedPercent: Int? {
        guard let usedPercent else { return nil }
        return Int(usedPercent.rounded())
    }

    var leftPercent: Int? {
        guard let usedPercent else { return nil }
        return max(0, min(100, Int((100 - usedPercent).rounded(.down))))
    }
}

struct ChatMessage: Codable, Identifiable, Hashable {
    let id: String
    let role: MessageRole
    let content: String
    let createdAt: String?
    let status: ThreadStatus?

    enum CodingKeys: String, CodingKey {
        case id
        case role
        case content
        case createdAt
        case status
    }

    init(id: String, role: MessageRole, content: String, createdAt: String?, status: ThreadStatus?) {
        self.id = id
        self.role = role
        self.content = content
        self.createdAt = createdAt
        self.status = status
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? container.decodeFlexibleString(forKey: .id)) ?? UUID().uuidString
        role = (try? container.decode(MessageRole.self, forKey: .role)) ?? .system
        createdAt = try? container.decodeFlexibleString(forKey: .createdAt)
        status = try? container.decode(ThreadStatus.self, forKey: .status)

        if let stringContent = try? container.decode(String.self, forKey: .content) {
            content = stringContent
        } else if let flexibleContent = try? container.decode(FlexibleText.self, forKey: .content) {
            content = flexibleContent.text
        } else {
            content = ""
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(role, forKey: .role)
        try container.encode(content, forKey: .content)
        try container.encodeIfPresent(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(status, forKey: .status)
    }
}

private struct FlexibleText: Decodable {
    let text: String

    init(from decoder: Decoder) throws {
        if let container = try? decoder.singleValueContainer() {
            if container.decodeNil() {
                text = ""
                return
            }
            if let string = try? container.decode(String.self) {
                text = string
                return
            }
            if let int = try? container.decode(Int.self) {
                text = String(int)
                return
            }
            if let double = try? container.decode(Double.self) {
                text = String(double)
                return
            }
            if let bool = try? container.decode(Bool.self) {
                text = String(bool)
                return
            }
            if let array = try? container.decode([FlexibleText].self) {
                text = array.map(\.text).filter { !$0.isEmpty }.joined(separator: "\n")
                return
            }
            if let object = try? container.decode([String: FlexibleText].self) {
                let preferredKeys = ["text", "input_text", "output_text", "message", "content", "summary"]
                let preferred = preferredKeys.compactMap { object[$0]?.text }.filter { !$0.isEmpty }
                if !preferred.isEmpty {
                    text = preferred.joined(separator: "\n")
                    return
                }
                let ignoredKeys = Set(["id", "type", "role", "status", "metadata", "created_at", "updated_at"])
                text = object
                    .filter { !ignoredKeys.contains($0.key) }
                    .map(\.value.text)
                    .filter { !$0.isEmpty }
                    .joined(separator: "\n")
                return
            }
        }
        text = ""
    }
}

enum MessageRole: String, Codable {
    case user
    case codex
    case assistant
    case system
    case status

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = ((try? container.decode(String.self)) ?? "").lowercased()
        switch raw {
        case "user", "you": self = .user
        case "codex", "assistant", "agent": self = .codex
        case "status", "event": self = .status
        case "system": self = .system
        default: self = .system
        }
    }

    var label: String {
        switch self {
        case .user: return "YOU"
        case .codex, .assistant: return "CODEX"
        case .status: return "STATUS"
        case .system: return "SYSTEM"
        }
    }
}

enum ThreadStatus: String, Codable, Hashable {
    case idle
    case queued
    case running
    case waitingForInput = "waiting_for_input"
    case completed
    case failed
    case cancelled

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = ((try? container.decode(String.self)) ?? "").lowercased()
        if raw.contains("wait") {
            self = .waitingForInput
        } else if raw.contains("queue") {
            self = .queued
        } else if raw.contains("run") || raw.contains("work") || raw.contains("progress") {
            self = .running
        } else if raw.contains("fail") || raw.contains("error") {
            self = .failed
        } else if raw.contains("cancel") {
            self = .cancelled
        } else if raw.contains("complete") || raw.contains("done") || raw.contains("finish") {
            self = .completed
        } else {
            self = .idle
        }
    }

    var title: String {
        switch self {
        case .idle: return "Idle"
        case .queued: return "Queued"
        case .running: return "Working..."
        case .waitingForInput: return "Waiting"
        case .completed: return "Completed"
        case .failed: return "Failed"
        case .cancelled: return "Cancelled"
        }
    }

    var isActive: Bool {
        self == .queued || self == .running || self == .waitingForInput
    }
}

struct ProjectsResponse: Codable {
    let projects: [Project]
}

struct ThreadsResponse: Codable {
    let threads: [CodexThread]
}

struct ThreadResponse: Codable {
    let thread: CodexThread
}

struct MessagesResponse: Codable {
    let messages: [ChatMessage]
}

struct StatusResponse: Codable {
    let status: ThreadStatus
}

struct LimitsResponse: Codable {
    let limits: AccountLimits
}

struct ErrorResponse: Codable {
    let error: String
}

private extension KeyedDecodingContainer {
    func decodeFlexibleString(forKey key: Key) throws -> String? {
        if try decodeNil(forKey: key) { return nil }
        if let value = try? decode(String.self, forKey: key) { return value }
        if let value = try? decode(Int.self, forKey: key) { return String(value) }
        if let value = try? decode(Double.self, forKey: key) { return String(value) }
        if let value = try? decode(Bool.self, forKey: key) { return String(value) }
        if let value = try? decode(FlexibleText.self, forKey: key), !value.text.isEmpty { return value.text }
        return nil
    }

    func decodeFlexibleInt(forKey key: Key) throws -> Int? {
        if try decodeNil(forKey: key) { return nil }
        if let value = try? decode(Int.self, forKey: key) { return value }
        if let value = try? decode(Double.self, forKey: key) { return Int(value.rounded()) }
        if let value = try? decode(String.self, forKey: key) { return Int(Double(value) ?? .nan) }
        return nil
    }

    func decodeFlexibleDouble(forKey key: Key) throws -> Double? {
        if try decodeNil(forKey: key) { return nil }
        if let value = try? decode(Double.self, forKey: key) { return value }
        if let value = try? decode(Int.self, forKey: key) { return Double(value) }
        if let value = try? decode(String.self, forKey: key) { return Double(value) }
        return nil
    }
}
