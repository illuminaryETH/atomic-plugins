import Foundation

struct Atom: Codable, Identifiable, Sendable {
    let id: String
    let content: String
    let sourceUrl: String?
    let source: String?
    let publishedAt: String?
    let createdAt: String
    let updatedAt: String
    let embeddingStatus: String
    let taggingStatus: String
    let tags: [Tag]

    enum CodingKeys: String, CodingKey {
        case id, content, source, tags
        case sourceUrl = "source_url"
        case publishedAt = "published_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case embeddingStatus = "embedding_status"
        case taggingStatus = "tagging_status"
    }
}

struct AtomSummary: Codable, Identifiable, Sendable {
    let id: String
    let title: String
    let snippet: String
    let sourceUrl: String?
    let source: String?
    let publishedAt: String?
    let createdAt: String
    let updatedAt: String
    let embeddingStatus: String
    let taggingStatus: String
    let tags: [Tag]

    enum CodingKeys: String, CodingKey {
        case id, title, snippet, source, tags
        case sourceUrl = "source_url"
        case publishedAt = "published_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case embeddingStatus = "embedding_status"
        case taggingStatus = "tagging_status"
    }
}

struct SourceInfo: Codable, Identifiable, Sendable {
    let source: String
    let atomCount: Int

    var id: String { source }

    enum CodingKeys: String, CodingKey {
        case source
        case atomCount = "atom_count"
    }
}

struct Tag: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let parentId: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, name
        case parentId = "parent_id"
        case createdAt = "created_at"
    }
}

struct TagWithCount: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let parentId: String?
    let createdAt: String
    let atomCount: Int
    let childrenTotal: Int
    var children: [TagWithCount]

    enum CodingKeys: String, CodingKey {
        case id, name, children
        case parentId = "parent_id"
        case createdAt = "created_at"
        case atomCount = "atom_count"
        case childrenTotal = "children_total"
    }
}

struct AtomListResponse: Codable, Sendable {
    let atoms: [AtomSummary]
    let totalCount: Int
    let limit: Int
    let offset: Int

    enum CodingKeys: String, CodingKey {
        case atoms, limit, offset
        case totalCount = "total_count"
    }
}

struct CreateAtomRequest: Codable, Sendable {
    let content: String
    let sourceUrl: String?
    let tagIds: [String]

    enum CodingKeys: String, CodingKey {
        case content
        case sourceUrl = "source_url"
        case tagIds = "tag_ids"
    }
}

struct UpdateAtomBody: Codable, Sendable {
    let content: String
    let sourceUrl: String?

    enum CodingKeys: String, CodingKey {
        case content
        case sourceUrl = "source_url"
    }
}

struct SearchRequest: Codable, Sendable {
    let query: String
    let mode: String
    let limit: Int?
    let threshold: Double?
}

struct PendingAtom: Codable, Identifiable, Sendable {
    let id: String
    let content: String
    let createdAt: Date
}

struct SearchResult: Codable, Identifiable, Sendable {
    let id: String
    let content: String
    let sourceUrl: String?
    let createdAt: String
    let updatedAt: String
    let tags: [Tag]
    let similarityScore: Double
    let matchingChunkContent: String?

    enum CodingKeys: String, CodingKey {
        case id, content, tags
        case sourceUrl = "source_url"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case similarityScore = "similarity_score"
        case matchingChunkContent = "matching_chunk_content"
    }
}
