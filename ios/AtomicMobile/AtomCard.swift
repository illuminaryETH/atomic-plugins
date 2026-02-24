import SwiftUI

struct AtomCard: View {
    let atom: AtomSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(atom.title.isEmpty ? "Untitled" : atom.title)
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)

            if !atom.snippet.isEmpty {
                Text(atom.snippet)
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(3)
            }

            HStack(spacing: 6) {
                if !atom.tags.isEmpty {
                    ForEach(atom.tags.prefix(2)) { tag in
                        TagBadge(name: tag.name)
                    }
                    if atom.tags.count > 2 {
                        Text("+\(atom.tags.count - 2)")
                            .font(.caption2)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }

                Spacer()

                if let sourceLabel = atom.source ?? hostFromURL(atom.sourceUrl) {
                    HStack(spacing: 3) {
                        Image(systemName: "link")
                            .font(.system(size: 8))
                        Text(sourceLabel)
                            .lineLimit(1)
                    }
                    .font(.caption2)
                    .foregroundStyle(Theme.textSecondary)
                    .layoutPriority(1)
                }

                Text(shortDate(atom.publishedAt ?? atom.updatedAt))
                    .font(.caption2)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize()
            }
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct TagBadge: View {
    let name: String

    var body: some View {
        Text(name)
            .font(.caption2)
            .fontWeight(.medium)
            .foregroundStyle(Theme.accent)
            .lineLimit(1)
            .truncationMode(.tail)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Theme.accent.opacity(0.15), in: Capsule())
    }
}

struct SearchResultCard: View {
    let result: SearchResult

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let chunk = result.matchingChunkContent {
                Text(chunk)
                    .font(.subheadline)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(4)
            } else {
                Text(String(result.content.prefix(200)))
                    .font(.subheadline)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(4)
            }

            HStack {
                ForEach(result.tags.prefix(2)) { tag in
                    TagBadge(name: tag.name)
                }
                Spacer()
                Text("\(Int(result.similarityScore * 100))% match")
                    .font(.caption2)
                    .foregroundStyle(Theme.accent)
            }
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
    }
}

func hostFromURL(_ urlString: String?) -> String? {
    guard let urlString, let url = URL(string: urlString) else { return nil }
    return url.host
}

func shortDate(_ iso: String) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = formatter.date(from: iso) ?? {
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso)
    }()
    guard let date else { return "" }
    let seconds = Int(-date.timeIntervalSinceNow)
    if seconds < 60 { return "now" }
    if seconds < 3600 { return "\(seconds / 60)m" }
    if seconds < 86400 { return "\(seconds / 3600)h" }
    if seconds < 604800 { return "\(seconds / 86400)d" }
    if seconds < 2_592_000 { return "\(seconds / 604800)w" }
    if seconds < 31_536_000 { return "\(seconds / 2_592_000)mo" }
    return "\(seconds / 31_536_000)y"
}

func relativeDate(_ iso: String) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = formatter.date(from: iso) else {
        // Try without fractional seconds
        formatter.formatOptions = [.withInternetDateTime]
        guard let date = formatter.date(from: iso) else { return "" }
        return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: .now)
    }
    return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: .now)
}
