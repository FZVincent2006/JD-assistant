import Foundation

package struct DownloadedFileChunkRequest: Codable, Equatable {
    package let type: String
    package let path: String
    package let offset: Int
    package let length: Int
    package let expectedName: String
    package let expectedSize: Int
}

package struct DownloadedFileDeleteRequest: Codable, Equatable {
    package let type: String
    package let path: String
}

package struct DownloadedFileSearchRequest: Codable, Equatable {
    package let type: String
    package let sinceMs: Int64
    package let untilMs: Int64
}

package struct DownloadedFileInfo: Codable, Equatable {
    package let path: String
    package let name: String
    package let size: Int
    package let modifiedAtMs: Int64

    package init(path: String, name: String, size: Int, modifiedAtMs: Int64) {
        self.path = path
        self.name = name
        self.size = size
        self.modifiedAtMs = modifiedAtMs
    }
}

package struct DownloadedFileChunk: Equatable {
    package let base64: String
    package let fileSize: Int
    package let eof: Bool

    package init(base64: String, fileSize: Int, eof: Bool) {
        self.base64 = base64
        self.fileSize = fileSize
        self.eof = eof
    }
}

package protocol DownloadedFileReading {
    func read(_ request: DownloadedFileChunkRequest) throws -> DownloadedFileChunk
    func recent(_ request: DownloadedFileSearchRequest) throws -> [DownloadedFileInfo]
    func delete(_ request: DownloadedFileDeleteRequest) throws
}

package struct DownloadedFileReader: DownloadedFileReading {
    private static let maximumFileSize = 30 * 1_024 * 1_024
    private static let maximumChunkSize = 384 * 1_024

    package init() {}

    package func read(_ request: DownloadedFileChunkRequest) throws -> DownloadedFileChunk {
        guard request.type == "READ_DOWNLOADED_FILE_CHUNK",
              request.offset >= 0,
              request.length > 0,
              request.length <= Self.maximumChunkSize else {
            throw TokenExchangeError(message: "Invalid downloaded file range")
        }
        let url = try validatedURL(path: request.path)
        let values = try url.resourceValues(forKeys: [
            .isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey
        ])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              let fileSize = values.fileSize,
              fileSize > 0, fileSize <= Self.maximumFileSize else {
            throw TokenExchangeError(message: "Invalid downloaded file")
        }
        try validateExpectedFile(
            url: url,
            expectedName: request.expectedName,
            expectedSize: request.expectedSize,
            actualSize: fileSize
        )
        guard request.offset <= fileSize else {
            throw TokenExchangeError(message: "Invalid downloaded file range")
        }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        try handle.seek(toOffset: UInt64(request.offset))
        let remaining = fileSize - request.offset
        let data = try handle.read(upToCount: min(request.length, remaining)) ?? Data()
        return DownloadedFileChunk(
            base64: data.base64EncodedString(),
            fileSize: fileSize,
            eof: request.offset + data.count >= fileSize
        )
    }

    package func delete(_ request: DownloadedFileDeleteRequest) throws {
        guard request.type == "DELETE_DOWNLOADED_FILE" else {
            throw TokenExchangeError(message: "Invalid downloaded file cleanup request")
        }
        let url = try validatedURL(path: request.path)
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else {
            throw TokenExchangeError(message: "Invalid downloaded file cleanup target")
        }
        try FileManager.default.removeItem(at: url)
    }

    package func recent(_ request: DownloadedFileSearchRequest) throws -> [DownloadedFileInfo] {
        guard request.type == "LIST_RECENT_DOWNLOADED_FILES",
              request.sinceMs > 0,
              request.untilMs >= request.sinceMs,
              request.untilMs - request.sinceMs <= 60 * 60 * 1_000 else {
            throw TokenExchangeError(message: "Invalid downloaded file search range")
        }
        let downloads = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Downloads", isDirectory: true)
        let keys: Set<URLResourceKey> = [
            .isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey,
            .contentModificationDateKey, .creationDateKey
        ]
        let urls = try FileManager.default.contentsOfDirectory(
            at: downloads,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles, .skipsSubdirectoryDescendants]
        )
        return try urls.compactMap { url in
            let ext = url.pathExtension.lowercased()
            guard ["pdf", "doc", "docx", "png", "jpg", "jpeg", "webp"].contains(ext) else {
                return nil
            }
            let values = try url.resourceValues(forKeys: keys)
            guard values.isRegularFile == true, values.isSymbolicLink != true,
                  let size = values.fileSize,
                  size > 0, size <= Self.maximumFileSize else { return nil }
            let date = values.contentModificationDate ?? values.creationDate
            guard let date else { return nil }
            let modifiedAtMs = Int64(date.timeIntervalSince1970 * 1_000)
            guard modifiedAtMs >= request.sinceMs, modifiedAtMs <= request.untilMs else {
                return nil
            }
            try validateExpectedFile(
                url: url,
                expectedName: url.lastPathComponent,
                expectedSize: size,
                actualSize: size
            )
            return DownloadedFileInfo(
                path: url.standardizedFileURL.path,
                name: url.lastPathComponent,
                size: size,
                modifiedAtMs: modifiedAtMs
            )
        }.sorted { $0.modifiedAtMs > $1.modifiedAtMs }
    }

    private func validatedURL(path: String) throws -> URL {
        let url = URL(fileURLWithPath: path).standardizedFileURL
        let home = FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL.path
        let ext = url.pathExtension.lowercased()
        guard url.path.hasPrefix(home + "/Downloads/"),
              ["pdf", "doc", "docx", "png", "jpg", "jpeg", "webp"].contains(ext),
              !url.path.contains("/../") else {
            throw TokenExchangeError(message: "Downloaded file path is not allowed")
        }
        return url
    }

    private func validateExpectedFile(
        url: URL,
        expectedName: String,
        expectedSize: Int,
        actualSize: Int
    ) throws {
        let ext = URL(fileURLWithPath: expectedName).pathExtension.lowercased()
        guard ["pdf", "doc", "docx", "png", "jpg", "jpeg", "webp"].contains(ext) else {
            throw TokenExchangeError(message: "Downloaded file type is not allowed")
        }
        if expectedSize >= 1_024,
           actualSize < expectedSize / 2 || actualSize > expectedSize + expectedSize / 2 {
            throw TokenExchangeError(message: "Downloaded file size does not match")
        }
        let header = try Data(contentsOf: url, options: .mappedIfSafe).prefix(12)
        let signatures: [String: [UInt8]] = [
            "pdf": [0x25, 0x50, 0x44, 0x46, 0x2d],
            "doc": [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
            "docx": [0x50, 0x4b, 0x03, 0x04],
            "png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
            "jpg": [0xff, 0xd8, 0xff],
            "jpeg": [0xff, 0xd8, 0xff],
            "webp": [0x52, 0x49, 0x46, 0x46]
        ]
        let validWebP = ext == "webp"
            && header.starts(with: signatures["webp"] ?? [])
            && Data(header.dropFirst(8).prefix(4)) == Data("WEBP".utf8)
        guard let signature = signatures[ext],
              (header.starts(with: signature) || (["png", "jpg", "jpeg", "webp"].contains(ext)
                && (header.starts(with: signatures["png"] ?? [])
                  || header.starts(with: signatures["jpg"] ?? [])
                  || validWebP))) else {
            throw TokenExchangeError(message: "Downloaded file content is invalid")
        }
    }
}
