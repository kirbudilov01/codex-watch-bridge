import SwiftUI

struct HomeView: View {
    @State private var model = ProjectsModel()

    var body: some View {
        NavigationStack {
            List {
                LimitsRow(limits: model.limits, isLoading: model.isLoading)

                NavigationLink {
                    ProjectsView()
                } label: {
                    Label("Projects", systemImage: "folder")
                }
                NavigationLink {
                    ActiveStatusView()
                } label: {
                    Label("Active", systemImage: "bolt.circle")
                }
            }
            .navigationTitle("Codex")
            .task { await model.load() }
            .refreshable { await model.load() }
        }
    }
}

struct LimitsRow: View {
    let limits: AccountLimits?
    let isLoading: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label("Limits", systemImage: "gauge.with.dots.needle.67percent")
                    .font(.headline)
                Spacer()
                if let percent = limits?.primary?.leftPercent {
                    Text("\(percent)% left")
                        .font(.headline)
                        .foregroundStyle(color(for: percent))
                }
            }

            if let limit = limits?.primary, let percent = limit.leftPercent {
                ProgressView(value: Double(percent), total: 100)
                    .tint(color(for: percent))
                Text(limit.displayName)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            } else {
                Text(isLoading ? "Loading..." : "Limits unavailable")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private func color(for percent: Int) -> Color {
        if percent <= 10 { return .red }
        if percent <= 30 { return .orange }
        return .green
    }
}

struct ProjectsView: View {
    @State private var model = ProjectsModel()

    var body: some View {
        List {
            LoadingErrorSection(
                isLoading: model.isLoading,
                loadingText: "Loading projects...",
                error: model.error,
                retry: { Task { await model.load() } }
            )

            if !model.isLoading && model.error == nil && model.projects.isEmpty {
                EmptyStateRow(title: "No projects", subtitle: "Open Codex on Mac, then pull to refresh.")
            }

            ForEach(model.projects) { project in
                NavigationLink {
                    ThreadsView(project: project)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(project.name)
                            .font(.headline)
                            .lineLimit(2)
                        if let cwd = project.cwd, !cwd.isEmpty, cwd != project.name {
                            Text(compactPath(cwd))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        HStack {
                            Text("\(project.threadCount) chats")
                            if project.activeCount > 0 {
                                CountBadge(text: "\(project.activeCount) active", color: .orange)
                            }
                        }
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .navigationTitle("Projects")
        .task { await model.load() }
        .refreshable { await model.load() }
    }
}

struct ActiveStatusView: View {
    @State private var model = ProjectsModel()

    var activeProjects: [Project] {
        model.projects.filter { $0.activeCount > 0 }
    }

    var body: some View {
        List {
            LoadingErrorSection(
                isLoading: model.isLoading,
                loadingText: "Loading status...",
                error: model.error,
                retry: { Task { await model.load() } }
            )

            if !model.isLoading && activeProjects.isEmpty {
                Text("No active tasks")
                    .foregroundStyle(.secondary)
            }

            ForEach(activeProjects) { project in
                NavigationLink {
                    ThreadsView(project: project)
                } label: {
                    VStack(alignment: .leading) {
                        Text(project.name)
                        CountBadge(text: "\(project.activeCount) active", color: .orange)
                    }
                }
            }
        }
        .navigationTitle("Active")
        .task { await model.load() }
        .refreshable { await model.load() }
    }
}

struct ThreadsView: View {
    @State private var model: ThreadsModel
    @State private var filter = ""

    init(project: Project) {
        _model = State(initialValue: ThreadsModel(project: project))
    }

    private var visibleThreads: [CodexThread] {
        let cleanFilter = filter.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanFilter.isEmpty else { return model.threads }
        return model.threads.filter { thread in
            thread.title.localizedCaseInsensitiveContains(cleanFilter)
                || (thread.preview?.localizedCaseInsensitiveContains(cleanFilter) ?? false)
        }
    }

    var body: some View {
        List {
            NavigationLink {
                CreateThreadView(model: model)
            } label: {
                Label("New Chat", systemImage: "plus")
            }
            .foregroundStyle(.green)

            if model.threads.count > 12 {
                TextField("Filter chats", text: $filter)
            }

            LoadingErrorSection(
                isLoading: model.isLoading,
                loadingText: "Loading chats...",
                error: model.error,
                retry: { Task { await model.load() } }
            )

            if !model.isLoading && model.error == nil && !model.threads.isEmpty {
                let shownCount = visibleThreads.count
                Text(shownCount == model.threads.count ? "\(model.threads.count) chats" : "\(shownCount) of \(model.threads.count) chats")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if !model.isLoading && model.error == nil && model.threads.isEmpty {
                EmptyStateRow(title: "No chats", subtitle: "Create one from the watch.")
            }

            if !model.isLoading && model.error == nil && !filter.isEmpty && visibleThreads.isEmpty {
                EmptyStateRow(title: "No matches", subtitle: "Clear the filter and retry.")
            }

            ForEach(visibleThreads) { thread in
                NavigationLink {
                    ChatView(thread: thread)
                } label: {
                    ThreadRow(thread: thread)
                }
            }
        }
        .navigationTitle(model.project.name)
        .task { await model.load() }
        .refreshable { await model.load() }
        .navigationDestination(item: Binding(
            get: { model.createdThread },
            set: { model.createdThread = $0 }
        )) { thread in
            ChatView(thread: thread)
        }
    }
}

private func compactPath(_ path: String) -> String {
    let parts = path.split(separator: "/").suffix(2)
    guard !parts.isEmpty else { return path }
    return ".../" + parts.joined(separator: "/")
}

struct CreateThreadView: View {
    @Bindable var model: ThreadsModel
    @State private var title = ""

    var body: some View {
        List {
            Section {
                TextField("Chat title", text: $title)
                Button("Create") {
                    Task { await model.create(title: title) }
                }
                .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isLoading)
            }

            LoadingErrorSection(
                isLoading: model.isLoading,
                loadingText: "Creating...",
                error: model.error,
                retry: nil
            )
        }
        .navigationTitle("New Chat")
    }
}

struct ChatView: View {
    @State private var model: ChatModel

    init(thread: CodexThread) {
        _model = State(initialValue: ChatModel(thread: thread))
    }

    var body: some View {
        VStack(spacing: 6) {
            StatusHeader(status: model.thread.status, tokenUsage: model.thread.tokenUsage)

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        LoadingErrorSection(
                            isLoading: model.isLoading,
                            loadingText: "Loading messages...",
                            error: model.error,
                            retry: { Task { await model.load() } }
                        )

                        ForEach(model.messages) { message in
                            MessageRow(message: message)
                                .id(message.id)
                        }

                        if !model.isLoading && model.error == nil && model.messages.isEmpty {
                            EmptyStateRow(title: "No messages", subtitle: "Dictate a prompt below.")
                        }

                        if model.isSending {
                            Text("Sending...")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else if model.thread.status.isActive {
                            Text("Working...")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.horizontal, 4)
                }
                .onChange(of: model.messages.count) {
                    guard model.shouldAutoScroll, let last = model.messages.last else { return }
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }

            HStack(spacing: 4) {
                TextField("Prompt", text: $model.input)
                Button {
                    Task { await model.send() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                }
                .disabled(model.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isSending)
                .buttonStyle(.plain)
                .font(.title3)
                .foregroundStyle(model.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isSending ? Color.secondary : Color.green)
            }
        }
        .navigationTitle(model.thread.title)
        .task { await model.load() }
        .onDisappear { model.stopPolling() }
    }
}

struct ThreadRow: View {
    let thread: CodexThread

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(thread.title)
                    .font(.headline)
                    .lineLimit(2)
                Spacer(minLength: 4)
                StatusBadge(status: thread.status, compact: true)
            }
            if let preview = thread.preview, !preview.isEmpty {
                Text(preview)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            if thread.status.isActive || thread.status == .failed {
                Text(thread.status.title)
                    .font(.caption2)
                    .foregroundStyle(thread.status.color)
            }
        }
        .padding(.vertical, 4)
    }
}

struct MessageRow: View {
    let message: ChatMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(message.role.label)
                    .font(.caption2)
                    .fontWeight(.semibold)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(labelColor.opacity(0.86))
                    .clipShape(Capsule())
                if let status = message.status {
                    StatusBadge(status: status, compact: true)
                }
            }
            Text(message.content)
                .font(.body)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(background)
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(labelColor.opacity(0.22), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var labelColor: Color {
        switch message.role {
        case .user: return .blue
        case .codex, .assistant: return .green
        case .status: return .orange
        case .system: return .secondary
        }
    }

    private var background: Color {
        switch message.role {
        case .user: return .blue.opacity(0.16)
        case .codex, .assistant: return .green.opacity(0.14)
        case .status: return .orange.opacity(0.14)
        case .system: return .gray.opacity(0.14)
        }
    }
}

struct StatusHeader: View {
    let status: ThreadStatus
    let tokenUsage: TokenUsage?

    var body: some View {
        HStack {
            StatusBadge(status: status, compact: false)
            Spacer()
            if let percent = tokenUsage?.limitLeftPercent {
                Text("\(percent)% left")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.gray.opacity(0.16))
                    .clipShape(Capsule())
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
    }
}

struct StatusDot: View {
    let status: ThreadStatus

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
    }

    private var color: Color {
        status.color
    }
}

struct StatusBadge: View {
    let status: ThreadStatus
    let compact: Bool

    var body: some View {
        HStack(spacing: 4) {
            StatusDot(status: status)
            if !compact {
                Text(status.title)
            }
        }
        .font(.caption2)
        .fontWeight(.medium)
        .foregroundStyle(status.color)
        .padding(.horizontal, compact ? 0 : 7)
        .padding(.vertical, compact ? 0 : 3)
        .background(compact ? Color.clear : status.color.opacity(0.14))
        .clipShape(Capsule())
    }
}

struct CountBadge: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(color)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(color.opacity(0.14))
            .clipShape(Capsule())
    }
}

struct LoadingErrorSection: View {
    let isLoading: Bool
    let loadingText: String
    let error: String?
    let retry: (() -> Void)?

    var body: some View {
        if isLoading {
            HStack {
                ProgressView()
                Text(loadingText)
                    .foregroundStyle(.secondary)
            }
        }
        if let error {
            VStack(alignment: .leading, spacing: 6) {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                if let retry {
                    Button("Retry", action: retry)
                }
            }
        }
    }
}

struct EmptyStateRow: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.caption)
                .fontWeight(.semibold)
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 6)
    }
}

private extension ThreadStatus {
    var color: Color {
        switch self {
        case .idle: return .gray
        case .queued: return .yellow
        case .running: return .orange
        case .waitingForInput: return .blue
        case .completed: return .green
        case .failed: return .red
        case .cancelled: return .gray
        }
    }
}
