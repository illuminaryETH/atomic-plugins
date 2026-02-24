import SwiftUI

struct FilterBar: View {
    @Bindable var store: AtomStore

    private var hasActiveFilter: Bool {
        store.sourceFilter != "all" || store.sortBy != "updated" || store.sortOrder != "desc"
    }

    private var activeFilterLabel: String? {
        var parts: [String] = []
        if let value = store.sourceValue {
            parts.append(value)
        } else if store.sourceFilter == "manual" {
            parts.append("Manual")
        } else if store.sourceFilter == "external" {
            parts.append("External")
        }
        if store.sortBy != "updated" {
            parts.append(store.sortBy.capitalized)
        }
        if store.sortOrder == "asc" {
            parts.append("Asc")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " \u{00B7} ")
    }

    var body: some View {
        HStack(spacing: 8) {
            sourceMenu
            sortMenu

            if let label = activeFilterLabel {
                Button {
                    Task {
                        await store.setSourceFilter("all")
                        await store.setSortBy("updated")
                        await store.setSortOrder("desc")
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(label)
                            .font(.caption2)
                        Image(systemName: "xmark")
                            .font(.system(size: 8, weight: .bold))
                    }
                    .foregroundStyle(Theme.accent)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Theme.accent.opacity(0.15), in: Capsule())
                }
            }

            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Theme.surface)
    }

    private var sourceMenu: some View {
        Menu {
            Button {
                Task { await store.setSourceFilter("all") }
            } label: {
                Label("All", systemImage: store.sourceFilter == "all" && store.sourceValue == nil ? "checkmark" : "")
            }
            Button {
                Task { await store.setSourceFilter("manual") }
            } label: {
                Label("Manual", systemImage: store.sourceFilter == "manual" ? "checkmark" : "")
            }
            Button {
                Task { await store.setSourceFilter("external") }
            } label: {
                Label("External", systemImage: store.sourceFilter == "external" && store.sourceValue == nil ? "checkmark" : "")
            }

            if !store.availableSources.isEmpty {
                Divider()
                ForEach(store.availableSources) { source in
                    Button {
                        Task { await store.setSourceValue(source.source) }
                    } label: {
                        Label(
                            "\(source.source) (\(source.atomCount))",
                            systemImage: store.sourceValue == source.source ? "checkmark" : ""
                        )
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "line.3.horizontal.decrease")
                    .font(.caption)
                Text("Source")
                    .font(.caption)
            }
            .foregroundStyle(Theme.textSecondary)
        }
    }

    private var sortMenu: some View {
        Menu {
            Section("Sort by") {
                ForEach(["updated", "created", "published", "title"], id: \.self) { field in
                    Button {
                        Task { await store.setSortBy(field) }
                    } label: {
                        Label(field.capitalized, systemImage: store.sortBy == field ? "checkmark" : "")
                    }
                }
            }
            Divider()
            Section("Order") {
                Button {
                    Task { await store.setSortOrder("desc") }
                } label: {
                    Label("Newest first", systemImage: store.sortOrder == "desc" ? "checkmark" : "")
                }
                Button {
                    Task { await store.setSortOrder("asc") }
                } label: {
                    Label("Oldest first", systemImage: store.sortOrder == "asc" ? "checkmark" : "")
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "arrow.up.arrow.down")
                    .font(.caption)
                Text("Sort")
                    .font(.caption)
            }
            .foregroundStyle(Theme.textSecondary)
        }
    }
}
