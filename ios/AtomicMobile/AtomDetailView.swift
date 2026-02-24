import SwiftUI
import MarkdownUI

struct AtomDetailView: View {
    let api: APIClient
    let atomId: String
    let cache: DiskCache
    let onDelete: (() async -> Void)?

    @State private var atom: Atom?
    @State private var isLoading = true
    @State private var error: String?
    @State private var showEdit = false
    @State private var showDeleteConfirm = false
    @State private var isDeleting = false
    @Environment(\.dismiss) private var dismiss

    init(api: APIClient, atomId: String, cache: DiskCache = DiskCache(), onDelete: (() async -> Void)? = nil) {
        self.api = api
        self.atomId = atomId
        self.cache = cache
        self.onDelete = onDelete
    }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()

            if isLoading {
                ProgressView()
                    .tint(Theme.accent)
            } else if let atom {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Markdown(atom.content)
                            .markdownTheme(MarkdownTheme.atomic)

                        if !atom.tags.isEmpty {
                            FlowLayout(spacing: 6) {
                                ForEach(atom.tags) { tag in
                                    TagBadge(name: tag.name)
                                }
                            }
                        }

                        if atom.source != nil || atom.sourceUrl != nil || atom.publishedAt != nil {
                            VStack(alignment: .leading, spacing: 6) {
                                if let source = atom.source {
                                    HStack(spacing: 6) {
                                        Image(systemName: "link")
                                            .font(.caption2)
                                            .foregroundStyle(Theme.textSecondary)
                                        Text(source)
                                            .font(.caption)
                                            .fontWeight(.medium)
                                            .foregroundStyle(Theme.textSecondary)
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 3)
                                            .background(Theme.elevated, in: Capsule())
                                    }
                                }
                                if let url = atom.sourceUrl, let linkURL = URL(string: url) {
                                    Link(destination: linkURL) {
                                        Text(url)
                                            .font(.caption)
                                            .foregroundStyle(Theme.accent)
                                            .lineLimit(1)
                                    }
                                }
                                if let published = atom.publishedAt {
                                    Text("Published \(relativeDate(published))")
                                        .font(.caption)
                                        .foregroundStyle(Theme.textSecondary)
                                }
                            }
                        }
                    }
                    .padding()
                }
            } else if let error {
                Text(error)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.bg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        showEdit = true
                    } label: {
                        Label("Edit", systemImage: "pencil")
                    }
                    Button(role: .destructive) {
                        showDeleteConfirm = true
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .fontWeight(.medium)
                }
                .tint(Theme.textSecondary)
            }
        }
        .sheet(isPresented: $showEdit) {
            if let atom {
                ComposeView(api: api, editing: atom) {
                    await reload()
                }
            }
        }
        .confirmationDialog("Delete this atom?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                Task { await deleteAtom() }
            }
        } message: {
            Text("This action cannot be undone.")
        }
        .task {
            await reload()
        }
    }

    private func reload() async {
        do {
            let fetched = try await api.getAtom(id: atomId)
            atom = fetched
            cache.save(fetched, forKey: "atom-\(atomId)")
        } catch {
            // Fall back to cached atom detail
            if let cached = cache.load(Atom.self, forKey: "atom-\(atomId)") {
                atom = cached
            } else {
                self.error = error.localizedDescription
            }
        }
        isLoading = false
    }

    private func deleteAtom() async {
        isDeleting = true
        do {
            try await api.deleteAtom(id: atomId)
            await onDelete?()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        isDeleting = false
    }
}

// MARK: - Markdown Theme

@MainActor
enum MarkdownTheme {
    static let atomic: MarkdownUI.Theme = .gitHub
        .text {
            ForegroundColor(.white)
        }
        .code {
            ForegroundColor(Theme.accent)
            FontFamilyVariant(.monospaced)
        }
        .link {
            ForegroundColor(Theme.accent)
        }
        .paragraph { configuration in
            configuration.label
                .padding(.bottom, 8)
        }
        .heading1 { configuration in
            configuration.label
                .markdownTextStyle {
                    ForegroundColor(.white)
                    FontWeight(.bold)
                    FontSize(.em(1.5))
                }
                .padding(.top, 24)
                .padding(.bottom, 12)
        }
        .heading2 { configuration in
            configuration.label
                .markdownTextStyle {
                    ForegroundColor(.white)
                    FontWeight(.semibold)
                    FontSize(.em(1.3))
                }
                .padding(.top, 20)
                .padding(.bottom, 10)
        }
        .heading3 { configuration in
            configuration.label
                .markdownTextStyle {
                    ForegroundColor(.white)
                    FontWeight(.semibold)
                    FontSize(.em(1.1))
                }
                .padding(.top, 16)
                .padding(.bottom, 8)
        }
        .codeBlock { configuration in
            configuration.label
                .markdownTextStyle {
                    ForegroundColor(.white)
                    FontFamilyVariant(.monospaced)
                    FontSize(.em(0.88))
                }
                .padding(12)
                .background(Theme.elevated)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .padding(.top, 8)
        }
        .blockquote { configuration in
            HStack(spacing: 0) {
                RoundedRectangle(cornerRadius: 1)
                    .fill(Theme.accent.opacity(0.5))
                    .frame(width: 3)
                configuration.label
                    .markdownTextStyle {
                        ForegroundColor(Theme.textSecondary)
                    }
                    .padding(.leading, 12)
            }
            .padding(.vertical, 8)
        }
}

// MARK: - Flow Layout

struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var maxX: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            maxX = max(maxX, x)
        }

        return (CGSize(width: maxX, height: y + rowHeight), positions)
    }
}
