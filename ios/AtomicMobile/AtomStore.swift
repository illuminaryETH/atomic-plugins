import Foundation
import SwiftUI

@Observable @MainActor
final class AtomStore {
    var atoms: [AtomSummary] = []
    var totalCount = 0
    var isLoading = false
    var error: String?
    var tags: [TagWithCount] = []
    var selectedTagId: String?

    var sourceFilter: String = "all"
    var sourceValue: String?
    var sortBy: String = "updated"
    var sortOrder: String = "desc"
    var availableSources: [SourceInfo] = []

    let api: APIClient
    let cache: DiskCache
    let offlineQueue: OfflineQueue

    var pendingAtoms: [PendingAtom] { offlineQueue.pending }

    init(api: APIClient, cache: DiskCache = DiskCache(), offlineQueue: OfflineQueue = OfflineQueue()) {
        self.api = api
        self.cache = cache
        self.offlineQueue = offlineQueue
    }

    func loadAtoms() async {
        isLoading = true
        error = nil

        // Load from cache first for instant display
        if atoms.isEmpty, let cached = cache.load(AtomListResponse.self, forKey: "atoms") {
            atoms = cached.atoms
            totalCount = cached.totalCount
        }

        do {
            let response = try await api.listAtoms(
                limit: 50, offset: 0, tagId: selectedTagId,
                source: sourceFilter, sourceValue: sourceValue,
                sortBy: sortBy, sortOrder: sortOrder
            )
            atoms = response.atoms
            totalCount = response.totalCount
            if selectedTagId == nil {
                cache.save(response, forKey: "atoms")
            }
        } catch {
            // Keep showing cached data on network failure
            if atoms.isEmpty {
                self.error = error.localizedDescription
            }
        }
        isLoading = false
    }

    func loadMore() async {
        guard !isLoading, atoms.count < totalCount else { return }
        isLoading = true
        do {
            let response = try await api.listAtoms(
                limit: 50, offset: atoms.count, tagId: selectedTagId,
                source: sourceFilter, sourceValue: sourceValue,
                sortBy: sortBy, sortOrder: sortOrder
            )
            atoms.append(contentsOf: response.atoms)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func loadTags() async {
        // Load from cache first
        if tags.isEmpty, let cached = cache.load([TagWithCount].self, forKey: "tags") {
            tags = cached
        }

        do {
            tags = try await api.getTags()
            cache.save(tags, forKey: "tags")
        } catch {
            // Keep showing cached tags on failure
            if tags.isEmpty {
                self.error = error.localizedDescription
            }
        }
    }

    func loadTagChildren(parentId: String) async {
        do {
            let children = try await api.getTagChildren(parentId: parentId)
            replaceChildren(in: &tags, parentId: parentId, newChildren: children)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func replaceChildren(in nodes: inout [TagWithCount], parentId: String, newChildren: [TagWithCount]) {
        for i in nodes.indices {
            if nodes[i].id == parentId {
                nodes[i].children = newChildren
                return
            }
            if !nodes[i].children.isEmpty {
                replaceChildren(in: &nodes[i].children, parentId: parentId, newChildren: newChildren)
            }
        }
    }

    func selectTag(_ tagId: String?) async {
        selectedTagId = tagId
        await loadAtoms()
    }

    func loadSources() async {
        do {
            availableSources = try await api.getSources()
        } catch {
            // Non-critical, silently ignore
        }
    }

    func setSourceFilter(_ filter: String) async {
        sourceFilter = filter
        if filter != "external" { sourceValue = nil }
        await loadAtoms()
    }

    func setSourceValue(_ value: String?) async {
        sourceValue = value
        sourceFilter = value != nil ? "external" : "all"
        await loadAtoms()
    }

    func setSortBy(_ field: String) async {
        sortBy = field
        await loadAtoms()
    }

    func setSortOrder(_ order: String) async {
        sortOrder = order
        await loadAtoms()
    }

    func createAtom(content: String) async -> Atom? {
        do {
            let atom = try await api.createAtom(content: content)
            await loadAtoms()
            return atom
        } catch {
            // Queue for later sync
            offlineQueue.enqueue(content: content)
            return nil
        }
    }

    func updateAtom(id: String, content: String) async -> Atom? {
        do {
            let atom = try await api.updateAtom(id: id, content: content)
            await loadAtoms()
            return atom
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func deleteAtom(id: String) async -> Bool {
        do {
            try await api.deleteAtom(id: id)
            atoms.removeAll { $0.id == id }
            totalCount -= 1
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func search(query: String) async -> [SearchResult] {
        do {
            return try await api.search(query: query)
        } catch {
            self.error = error.localizedDescription
            return []
        }
    }

    func syncPending() async {
        guard !offlineQueue.pending.isEmpty else { return }
        await offlineQueue.drain(api: api)
        await loadAtoms()
    }
}
