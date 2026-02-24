import SwiftUI

struct ContentView: View {
    @State private var store: AtomStore
    @State private var selectedAtomId: String?
    @State private var showCompose = false
    @State private var showDrawer = false
    @State private var searchText = ""
    @State private var searchResults: [SearchResult] = []
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?

    @Binding var serverURL: String
    @Binding var apiToken: String

    @Environment(NetworkMonitor.self) private var networkMonitor

    private let api: APIClient
    private let cache: DiskCache

    init(api: APIClient, serverURL: Binding<String>, apiToken: Binding<String>) {
        self.api = api
        self.cache = DiskCache()
        let queue = OfflineQueue()
        self._store = State(initialValue: AtomStore(api: api, cache: cache, offlineQueue: queue))
        self._serverURL = serverURL
        self._apiToken = apiToken
    }

    private var isSearchActive: Bool { !searchText.isEmpty }

    private var selectedTagName: String? {
        guard let id = store.selectedTagId else { return nil }
        return findTag(id: id, in: store.tags)?.name
    }

    private func findTag(id: String, in tags: [TagWithCount]) -> TagWithCount? {
        for tag in tags {
            if tag.id == id { return tag }
            if let found = findTag(id: id, in: tag.children) { return found }
        }
        return nil
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.bg.ignoresSafeArea()

                VStack(spacing: 0) {
                    if !networkMonitor.isConnected {
                        offlineBanner
                    }

                    if !isSearchActive {
                        FilterBar(store: store)
                    }

                    Group {
                        if isSearchActive {
                            searchResultsList
                        } else if store.isLoading && store.atoms.isEmpty && store.pendingAtoms.isEmpty {
                            ProgressView()
                                .tint(Theme.accent)
                        } else if let error = store.error, store.atoms.isEmpty {
                            errorView(error)
                        } else if store.atoms.isEmpty && store.pendingAtoms.isEmpty {
                            emptyView
                        } else {
                            atomList
                        }
                    }
                    .frame(maxHeight: .infinity)
                }
            }
            .navigationTitle(selectedTagName ?? "Atomic")
            .toolbarBackground(Theme.bg, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .searchable(text: $searchText, prompt: "Search atoms")
            .disabled(!networkMonitor.isConnected && isSearchActive)
            .onChange(of: searchText) { _, query in
                searchTask?.cancel()
                if query.isEmpty {
                    searchResults = []
                    isSearching = false
                    return
                }
                guard networkMonitor.isConnected else { return }
                searchTask = Task {
                    try? await Task.sleep(for: .milliseconds(300))
                    guard !Task.isCancelled else { return }
                    isSearching = true
                    searchResults = await store.search(query: query)
                    isSearching = false
                }
            }
            .onChange(of: networkMonitor.isConnected) { _, connected in
                if connected {
                    Task {
                        await store.syncPending()
                        await store.loadAtoms()
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        withAnimation(.spring(duration: 0.3)) {
                            showDrawer = true
                        }
                    } label: {
                        Image(systemName: "line.3.horizontal")
                            .fontWeight(.medium)
                    }
                    .tint(store.selectedTagId != nil ? Theme.accent : Theme.textSecondary)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showCompose = true
                    } label: {
                        Image(systemName: "square.and.pencil")
                            .fontWeight(.medium)
                    }
                    .tint(Theme.accent)
                }
            }
            .sheet(isPresented: $showCompose) {
                ComposeView(store: store) {
                    await store.loadAtoms()
                }
            }
            .navigationDestination(item: $selectedAtomId) { id in
                AtomDetailView(api: api, atomId: id, cache: cache) {
                    await store.loadAtoms()
                }
            }
        }
        .overlay {
            if showDrawer {
                Color.black.opacity(0.4)
                    .ignoresSafeArea()
                    .onTapGesture {
                        withAnimation(.spring(duration: 0.3)) {
                            showDrawer = false
                        }
                    }
            }
        }
        .overlay(alignment: .leading) {
            if showDrawer {
                DrawerView(store: store, serverURL: $serverURL, apiToken: $apiToken) {
                    withAnimation(.spring(duration: 0.3)) {
                        showDrawer = false
                    }
                }
                .transition(.move(edge: .leading))
            }
        }
        .preferredColorScheme(.dark)
        .task {
            await store.syncPending()
            await store.loadAtoms()
            await store.loadTags()
            await store.loadSources()
        }
    }

    private var offlineBanner: some View {
        HStack(spacing: 6) {
            Image(systemName: "wifi.slash")
                .font(.caption2)
            Text("Offline — showing cached data")
                .font(.caption)
        }
        .foregroundStyle(Theme.textSecondary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(Theme.surface)
    }

    private var atomList: some View {
        List {
            if !store.pendingAtoms.isEmpty {
                Section {
                    ForEach(store.pendingAtoms) { pending in
                        PendingAtomCard(pending: pending)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    }
                }
            }

            ForEach(store.atoms) { atom in
                AtomCard(atom: atom)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    .onTapGesture { selectedAtomId = atom.id }
                    .onAppear {
                        if atom.id == store.atoms.last?.id {
                            Task { await store.loadMore() }
                        }
                    }
            }
            .onDelete { indexSet in
                Task {
                    for index in indexSet {
                        let atom = store.atoms[index]
                        _ = await store.deleteAtom(id: atom.id)
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .refreshable {
            await store.loadAtoms()
        }
    }

    private var emptyView: some View {
        VStack(spacing: 12) {
            Image(systemName: "doc.text")
                .font(.system(size: 40))
                .foregroundStyle(Theme.textSecondary)
            Text(store.selectedTagId != nil ? "No atoms with this tag" : "No atoms yet")
                .foregroundStyle(Theme.textSecondary)
            if store.selectedTagId == nil {
                Button("Create one") { showCompose = true }
                    .buttonStyle(.bordered)
                    .tint(Theme.accent)
            }
        }
    }

    private var searchResultsList: some View {
        ScrollView {
            if !networkMonitor.isConnected {
                VStack(spacing: 8) {
                    Image(systemName: "wifi.slash")
                        .font(.title3)
                    Text("Search requires a connection")
                        .font(.caption)
                }
                .foregroundStyle(Theme.textSecondary)
                .padding(.top, 40)
            } else if isSearching {
                ProgressView()
                    .tint(Theme.accent)
                    .padding(.top, 40)
            } else if searchResults.isEmpty {
                Text("No results")
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.top, 40)
            } else {
                LazyVStack(spacing: 12) {
                    ForEach(searchResults) { result in
                        SearchResultCard(result: result)
                            .onTapGesture { selectedAtomId = result.id }
                    }
                }
                .padding(.horizontal)
                .padding(.top, 8)
            }
        }
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 40))
                .foregroundStyle(Theme.textSecondary)
            Text(message)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
            Button("Retry") {
                Task { await store.loadAtoms() }
            }
            .buttonStyle(.bordered)
            .tint(Theme.accent)
        }
        .padding()
    }
}

// MARK: - Pending Atom Card

struct PendingAtomCard: View {
    let pending: PendingAtom

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
            Text(pending.content.prefix(100))
                .font(.subheadline)
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(2)
            Spacer()
        }
        .padding(12)
        .background(Theme.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
    }
}
