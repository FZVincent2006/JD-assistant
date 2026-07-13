import FeishuAuthHost
import Foundation

func runNativeMessageTests() throws -> Int {
    let ping = Data(#"{"type":"PING"}"#.utf8)
    try expect(
        try NativeMessage.read(from: InputStream(data: frame(ping))) == ping,
        "read little-endian framed JSON"
    )
    try expect(
        try NativeMessage.read(from: InputStream(data: Data())) == nil,
        "clean EOF returns nil"
    )
    try expect(
        try NativeMessage.read(from: InputStream(data: Data(repeating: 0, count: 4))) == Data(),
        "zero-length body"
    )
    try expectThrows("truncated prefix") {
        _ = try NativeMessage.read(from: InputStream(data: Data([1, 0])))
    }

    var bodyLength = UInt32(5).littleEndian
    let truncatedBody = Data(bytes: &bodyLength, count: 4) + Data([1, 2])
    try expectThrows("truncated body") {
        _ = try NativeMessage.read(from: InputStream(data: truncatedBody))
    }

    let unicode = Data(#"{"message":"飞书"}"#.utf8)
    let output = OutputStream.toMemory()
    try NativeMessage.write(unicode, to: output)
    let written = output.property(forKey: .dataWrittenToMemoryStreamKey) as? Data
    try expect(written == frame(unicode), "write Unicode JSON with little-endian prefix")

    try NativeMessage.validateLength(1_048_576)
    try expectThrows("reject more than one MiB") {
        try NativeMessage.validateLength(1_048_577)
    }
    return 7
}

private func frame(_ body: Data) -> Data {
    var size = UInt32(body.count).littleEndian
    return Data(bytes: &size, count: 4) + body
}
