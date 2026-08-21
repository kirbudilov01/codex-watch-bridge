import SwiftUI

@main
struct CodexHostApp: App {
    var body: some Scene {
        WindowGroup {
            VStack(spacing: 12) {
                Image(systemName: "applewatch")
                    .font(.system(size: 44, weight: .semibold))
                    .foregroundStyle(.green)

                Text("Codex Watch")
                    .font(.title2.weight(.semibold))

                Text("The Codex interface runs on Apple Watch.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
            .padding()
        }
    }
}
