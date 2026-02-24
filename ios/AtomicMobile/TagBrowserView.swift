import SwiftUI

struct DrawerView: View {
    @Bindable var store: AtomStore
    @Binding var serverURL: String
    @Binding var apiToken: String
    var dismiss: () -> Void

    @State private var expandedTagIds: Set<String> = []
    @State private var showSettings = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            Text("Atomic")
                .font(.title2)
                .fontWeight(.bold)
                .foregroundStyle(Theme.textPrimary)
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 12)

            Divider()
                .overlay(Theme.border)

            // Tag tree
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // All Atoms row
                    Button {
                        Task {
                            await store.selectTag(nil)
                            dismiss()
                        }
                    } label: {
                        HStack {
                            Text("All Atoms")
                                .foregroundStyle(Theme.textPrimary)
                            Spacer()
                            if store.selectedTagId == nil {
                                Image(systemName: "checkmark")
                                    .font(.caption)
                                    .foregroundStyle(Theme.accent)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .contentShape(Rectangle())
                    }

                    ForEach(store.tags) { tag in
                        TagNodeView(
                            tag: tag,
                            level: 0,
                            selectedTagId: store.selectedTagId,
                            expandedTagIds: $expandedTagIds,
                            onSelect: { id in
                                Task {
                                    await store.selectTag(id)
                                    dismiss()
                                }
                            },
                            loadChildren: { parentId in
                                await store.loadTagChildren(parentId: parentId)
                            }
                        )
                    }
                }
                .padding(.top, 4)
            }

            Divider()
                .overlay(Theme.border)

            // Footer with settings
            HStack {
                Spacer()
                Button {
                    showSettings = true
                } label: {
                    Image(systemName: "gearshape")
                        .font(.body)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .frame(width: 300)
        .frame(maxHeight: .infinity)
        .background(Theme.bg)
        .shadow(color: .black.opacity(0.3), radius: 10, x: 5, y: 0)
        .sheet(isPresented: $showSettings) {
            SettingsView(serverURL: $serverURL, apiToken: $apiToken)
        }
    }
}

// MARK: - Tag Node View

struct TagNodeView: View {
    let tag: TagWithCount
    let level: Int
    let selectedTagId: String?
    @Binding var expandedTagIds: Set<String>
    let onSelect: (String) -> Void
    var loadChildren: ((String) async -> Void)?

    private var isExpanded: Bool { expandedTagIds.contains(tag.id) }
    private var hasChildren: Bool { !tag.children.isEmpty || tag.childrenTotal > 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                // Chevron
                if hasChildren {
                    Button {
                        Task {
                            if !isExpanded && tag.childrenTotal > tag.children.count {
                                await loadChildren?(tag.id)
                            }
                            withAnimation(.easeInOut(duration: 0.2)) {
                                if isExpanded {
                                    expandedTagIds.remove(tag.id)
                                } else {
                                    expandedTagIds.insert(tag.id)
                                }
                            }
                        }
                    } label: {
                        Image(systemName: "chevron.right")
                            .font(.caption2)
                            .foregroundStyle(Theme.textSecondary)
                            .rotationEffect(.degrees(isExpanded ? 90 : 0))
                            .frame(width: 16, height: 16)
                    }
                } else {
                    Spacer()
                        .frame(width: 16)
                }

                // Tag name - tap to expand if parent, filter if leaf
                Button {
                    if hasChildren {
                        Task {
                            if !isExpanded && tag.childrenTotal > tag.children.count {
                                await loadChildren?(tag.id)
                            }
                            withAnimation(.easeInOut(duration: 0.2)) {
                                if isExpanded {
                                    expandedTagIds.remove(tag.id)
                                } else {
                                    expandedTagIds.insert(tag.id)
                                }
                            }
                        }
                    } else {
                        onSelect(tag.id)
                    }
                } label: {
                    HStack {
                        Text(tag.name)
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        Spacer()
                        if selectedTagId == tag.id {
                            Image(systemName: "checkmark")
                                .font(.caption)
                                .foregroundStyle(Theme.accent)
                        } else if tag.atomCount > 0 {
                            Text("\(tag.atomCount)")
                                .font(.caption)
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                    .contentShape(Rectangle())
                }
            }
            .padding(.leading, CGFloat(8 + level * 16))
            .padding(.trailing, 16)
            .padding(.vertical, 8)

            // Children
            if hasChildren && isExpanded {
                ForEach(tag.children) { child in
                    TagNodeView(
                        tag: child,
                        level: level + 1,
                        selectedTagId: selectedTagId,
                        expandedTagIds: $expandedTagIds,
                        onSelect: onSelect,
                        loadChildren: loadChildren
                    )
                }
            }
        }
    }
}
