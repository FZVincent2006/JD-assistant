import Foundation

package enum NativeMessageError: Error, Equatable {
    case invalidLength(Int)
    case truncatedPrefix
    case truncatedBody
    case readFailed
    case writeFailed
}

package enum NativeMessage {
    package static let maximumLength = 1_048_576

    package static func validateLength(_ length: Int) throws {
        guard (0...maximumLength).contains(length) else {
            throw NativeMessageError.invalidLength(length)
        }
    }

    package static func read(from stream: InputStream) throws -> Data? {
        stream.open()
        defer { stream.close() }

        var prefix = [UInt8](repeating: 0, count: MemoryLayout<UInt32>.size)
        var prefixOffset = 0
        while prefixOffset < prefix.count {
            let remainingPrefixBytes = prefix.count - prefixOffset
            let bytesRead = prefix.withUnsafeMutableBytes { buffer in
                stream.read(
                    buffer.baseAddress!.assumingMemoryBound(to: UInt8.self).advanced(by: prefixOffset),
                    maxLength: remainingPrefixBytes
                )
            }
            if bytesRead == 0 {
                if prefixOffset == 0 { return nil }
                throw NativeMessageError.truncatedPrefix
            }
            if bytesRead < 0 { throw NativeMessageError.readFailed }
            prefixOffset += bytesRead
        }

        let encodedLength = prefix.withUnsafeBytes { buffer in
            buffer.loadUnaligned(as: UInt32.self)
        }
        let bodyLength = Int(UInt32(littleEndian: encodedLength))
        try validateLength(bodyLength)
        if bodyLength == 0 { return Data() }

        var body = [UInt8](repeating: 0, count: bodyLength)
        var bodyOffset = 0
        while bodyOffset < bodyLength {
            let bytesRead = body.withUnsafeMutableBytes { buffer in
                stream.read(
                    buffer.baseAddress!.assumingMemoryBound(to: UInt8.self).advanced(by: bodyOffset),
                    maxLength: bodyLength - bodyOffset
                )
            }
            if bytesRead == 0 { throw NativeMessageError.truncatedBody }
            if bytesRead < 0 { throw NativeMessageError.readFailed }
            bodyOffset += bytesRead
        }
        return Data(body)
    }

    package static func write(_ body: Data, to stream: OutputStream) throws {
        try validateLength(body.count)
        var encodedLength = UInt32(body.count).littleEndian
        let prefix = withUnsafeBytes(of: &encodedLength) { Data($0) }

        stream.open()
        defer { stream.close() }
        try writeAll(prefix, to: stream)
        try writeAll(body, to: stream)
    }

    private static func writeAll(_ data: Data, to stream: OutputStream) throws {
        let bytes = [UInt8](data)
        var offset = 0
        while offset < bytes.count {
            let bytesWritten = bytes.withUnsafeBufferPointer { buffer in
                stream.write(buffer.baseAddress!.advanced(by: offset), maxLength: bytes.count - offset)
            }
            if bytesWritten <= 0 { throw NativeMessageError.writeFailed }
            offset += bytesWritten
        }
    }
}
