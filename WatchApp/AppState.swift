import Foundation
import Observation

@MainActor
@Observable
final class ProjectsModel {
    var projects: [Project] = []
    var limits: AccountLimits?
    var isLoading = false
    var error: String?

    private let api: APIClient

    init(api: APIClient = APIClient()) {
        self.api = api
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        error = nil
        do {
            async let projectsResult = api.projects()
            async let limitsResult = api.limits()
            projects = try await projectsResult
            limits = try? await limitsResult
        } catch {
            self.error = readable(error)
        }
        isLoading = false
    }

    private func readable(_ error: Error) -> String {
        readableError(error)
    }
}

@MainActor
@Observable
final class ThreadsModel {
    var threads: [CodexThread] = []
    var isLoading = false
    var error: String?
    var createdThread: CodexThread?

    let project: Project
    private let api: APIClient

    init(project: Project, api: APIClient = APIClient()) {
        self.project = project
        self.api = api
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        error = nil
        do {
            threads = try await api.threads(projectId: project.id)
        } catch {
            self.error = readable(error)
        }
        isLoading = false
    }

    func create(title: String) async {
        guard !isLoading else { return }
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTitle.isEmpty else {
            error = "Title is required."
            return
        }
        isLoading = true
        error = nil
        do {
            let thread = try await api.createThread(projectId: project.id, title: cleanTitle)
            createdThread = thread
            isLoading = false
            await load()
        } catch {
            self.error = readable(error)
            isLoading = false
        }
    }

    private func readable(_ error: Error) -> String {
        readableError(error)
    }
}

@MainActor
@Observable
final class ChatModel {
    var thread: CodexThread
    var messages: [ChatMessage] = []
    var input = ""
    var isLoading = false
    var isSending = false
    var error: String?
    var shouldAutoScroll = true

    private let api: APIClient
    private var pollingTask: Task<Void, Never>?

    init(thread: CodexThread, api: APIClient = APIClient()) {
        self.thread = thread
        self.api = api
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        error = nil
        do {
            thread = try await api.thread(thread.id)
            messages = try await api.messages(threadId: thread.id)
            updatePolling()
        } catch {
            self.error = readable(error)
        }
        isLoading = false
    }

    func send() async {
        guard !isSending else { return }
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        input = ""
        isSending = true
        error = nil
        shouldAutoScroll = true
        let optimistic = ChatMessage(id: UUID().uuidString, role: .user, content: text, createdAt: nil, status: nil)
        messages.append(optimistic)
        do {
            thread = try await api.sendMessage(threadId: thread.id, text: text)
            await refresh()
        } catch {
            messages.removeAll { $0.id == optimistic.id }
            self.error = readable(error)
            input = text
        }
        isSending = false
        updatePolling()
    }

    func refresh() async {
        do {
            thread = try await api.thread(thread.id)
            messages = try await api.messages(threadId: thread.id)
            error = nil
        } catch {
            self.error = readable(error)
        }
        updatePolling()
    }

    func stopPolling() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    private func updatePolling() {
        if thread.status.isActive {
            guard pollingTask == nil else { return }
            pollingTask = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(3))
                    guard !Task.isCancelled else { break }
                    await self?.refresh()
                    if self?.thread.status.isActive == false {
                        self?.stopPolling()
                    }
                }
            }
        } else {
            stopPolling()
        }
    }

    private func readable(_ error: Error) -> String {
        readableError(error)
    }
}

private func readableError(_ error: Error) -> String {
    if let urlError = error as? URLError {
        switch urlError.code {
        case .notConnectedToInternet, .networkConnectionLost:
            return "Network is unavailable. Check Wi-Fi and retry."
        case .timedOut:
            return "Request timed out. Retry in a moment."
        case .cannotConnectToHost, .cannotFindHost:
            return "Bridge is unavailable. Check that it is running."
        default:
            return urlError.localizedDescription
        }
    }

    return (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
}
