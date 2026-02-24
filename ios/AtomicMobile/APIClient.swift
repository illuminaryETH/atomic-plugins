import Foundation

@Observable
final class APIClient: Sendable {
    let baseURL: URL
    let token: String

    init(baseURL: URL, token: String) {
        self.baseURL = baseURL
        self.token = token
    }

    private func request(_ path: String, method: String = "GET", body: (any Encodable & Sendable)? = nil) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIError.httpError(0)
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let body {
            req.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await URLSession.shared.data(for: req)

        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            let http = response as? HTTPURLResponse
            throw APIError.httpError(http?.statusCode ?? 0)
        }

        return data
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        try JSONDecoder().decode(type, from: data)
    }

    func listAtoms(
        limit: Int = 50,
        offset: Int = 0,
        tagId: String? = nil,
        source: String? = nil,
        sourceValue: String? = nil,
        sortBy: String? = nil,
        sortOrder: String? = nil
    ) async throws -> AtomListResponse {
        var path = "/api/atoms?limit=\(limit)&offset=\(offset)"
        if let tagId { path += "&tag_id=\(tagId)" }
        if let source, source != "all" { path += "&source=\(source)" }
        if let sourceValue { path += "&source_value=\(sourceValue.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? sourceValue)" }
        if let sortBy, sortBy != "updated" { path += "&sort_by=\(sortBy)" }
        if let sortOrder, sortOrder != "desc" { path += "&sort_order=\(sortOrder)" }
        let data = try await request(path)
        return try decode(AtomListResponse.self, from: data)
    }

    func getSources() async throws -> [SourceInfo] {
        let data = try await request("/api/atoms/sources")
        return try decode([SourceInfo].self, from: data)
    }

    func getAtom(id: String) async throws -> Atom {
        let data = try await request("/api/atoms/\(id)")
        return try decode(Atom.self, from: data)
    }

    func createAtom(content: String, sourceUrl: String? = nil) async throws -> Atom {
        let body = CreateAtomRequest(content: content, sourceUrl: sourceUrl, tagIds: [])
        let data = try await request("/api/atoms", method: "POST", body: body)
        return try decode(Atom.self, from: data)
    }

    func updateAtom(id: String, content: String, sourceUrl: String? = nil) async throws -> Atom {
        let body = UpdateAtomBody(content: content, sourceUrl: sourceUrl)
        let data = try await request("/api/atoms/\(id)", method: "PUT", body: body)
        return try decode(Atom.self, from: data)
    }

    func deleteAtom(id: String) async throws {
        _ = try await request("/api/atoms/\(id)", method: "DELETE")
    }

    func getTags() async throws -> [TagWithCount] {
        let data = try await request("/api/tags")
        return try decode([TagWithCount].self, from: data)
    }

    func getTagChildren(parentId: String) async throws -> [TagWithCount] {
        let data = try await request("/api/tags/\(parentId)/children?min_count=0")
        return try decode([TagWithCount].self, from: data)
    }

    func search(query: String, mode: String = "hybrid", limit: Int = 20) async throws -> [SearchResult] {
        let body = SearchRequest(query: query, mode: mode, limit: limit, threshold: nil)
        let data = try await request("/api/search", method: "POST", body: body)
        return try decode([SearchResult].self, from: data)
    }
}

enum APIError: LocalizedError {
    case httpError(Int)

    var errorDescription: String? {
        switch self {
        case .httpError(let code): "Server error (\(code))"
        }
    }
}
