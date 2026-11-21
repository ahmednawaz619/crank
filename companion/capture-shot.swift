import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct ShotRequest: Decodable {
  let title: String
  let match: String
  let screenX: Double
  let screenY: Double
  let screenLeft: Double
  let screenTop: Double
  let screenWidth: Double
  let screenHeight: Double
  let outerWidth: Double
  let outerHeight: Double
  let innerWidth: Double
  let innerHeight: Double
  let frameLeft: Double
  let frameTop: Double
  let frameWidth: Double
  let frameHeight: Double
  let locate: Bool
  let anchorX: Double
  let anchorY: Double
  let pixelScale: Double
  let markerInner: Double
  let viewCenterX: Double
  let viewCenterY: Double
  let viewWidth: Double
  let viewHeight: Double
  let selLeft: Double
  let selTop: Double
  let selWidth: Double
  let selHeight: Double

  enum CodingKeys: String, CodingKey {
    case title, match, screenX, screenY, screenLeft, screenTop, screenWidth, screenHeight
    case outerWidth, outerHeight, innerWidth, innerHeight
    case frameLeft, frameTop, frameWidth, frameHeight
    case locate, anchorX, anchorY, pixelScale, markerInner, viewCenterX, viewCenterY, viewWidth, viewHeight
    case selLeft, selTop, selWidth, selHeight
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
    match = try c.decodeIfPresent(String.self, forKey: .match) ?? ""
    screenX = try c.decodeIfPresent(Double.self, forKey: .screenX) ?? 0
    screenY = try c.decodeIfPresent(Double.self, forKey: .screenY) ?? 0
    screenLeft = try c.decodeIfPresent(Double.self, forKey: .screenLeft) ?? 0
    screenTop = try c.decodeIfPresent(Double.self, forKey: .screenTop) ?? 0
    screenWidth = try c.decodeIfPresent(Double.self, forKey: .screenWidth) ?? 0
    screenHeight = try c.decodeIfPresent(Double.self, forKey: .screenHeight) ?? 0
    outerWidth = try c.decodeIfPresent(Double.self, forKey: .outerWidth) ?? 0
    outerHeight = try c.decodeIfPresent(Double.self, forKey: .outerHeight) ?? 0
    innerWidth = try c.decodeIfPresent(Double.self, forKey: .innerWidth) ?? 0
    innerHeight = try c.decodeIfPresent(Double.self, forKey: .innerHeight) ?? 0
    frameLeft = try c.decodeIfPresent(Double.self, forKey: .frameLeft) ?? 0
    frameTop = try c.decodeIfPresent(Double.self, forKey: .frameTop) ?? 0
    frameWidth = try c.decodeIfPresent(Double.self, forKey: .frameWidth) ?? 0
    frameHeight = try c.decodeIfPresent(Double.self, forKey: .frameHeight) ?? 0
    locate = try c.decodeIfPresent(Bool.self, forKey: .locate) ?? false
    anchorX = try c.decodeIfPresent(Double.self, forKey: .anchorX) ?? -1
    anchorY = try c.decodeIfPresent(Double.self, forKey: .anchorY) ?? -1
    pixelScale = try c.decodeIfPresent(Double.self, forKey: .pixelScale) ?? 0
    markerInner = try c.decodeIfPresent(Double.self, forKey: .markerInner) ?? 12
    viewCenterX = try c.decodeIfPresent(Double.self, forKey: .viewCenterX) ?? -1
    viewCenterY = try c.decodeIfPresent(Double.self, forKey: .viewCenterY) ?? -1
    viewWidth = try c.decodeIfPresent(Double.self, forKey: .viewWidth) ?? 0
    viewHeight = try c.decodeIfPresent(Double.self, forKey: .viewHeight) ?? 0
    selLeft = try c.decodeIfPresent(Double.self, forKey: .selLeft) ?? -1
    selTop = try c.decodeIfPresent(Double.self, forKey: .selTop) ?? -1
    selWidth = try c.decodeIfPresent(Double.self, forKey: .selWidth) ?? 0
    selHeight = try c.decodeIfPresent(Double.self, forKey: .selHeight) ?? 0
  }
}

struct Win {
  let id: CGWindowID
  let owner: String
  let name: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

func fail(_ message: String) -> Never {
  fputs(message + "\n", stderr)
  exit(1)
}

let args = CommandLine.arguments
if args.count < 3 {
  fail("usage: crank-shot out.png request.json")
}
let outURL = URL(fileURLWithPath: args[1])
let requestURL = URL(fileURLWithPath: args[2])
let request = try JSONDecoder().decode(ShotRequest.self, from: Data(contentsOf: requestURL))

func windows() -> [Win] {
  let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
  var list: [Win] = []
  for item in info {
    guard let number = item[kCGWindowNumber as String] as? Int,
          let bounds = item[kCGWindowBounds as String] as? [String: Any] else { continue }
    let width = (bounds["Width"] as? NSNumber)?.doubleValue ?? 0
    let height = (bounds["Height"] as? NSNumber)?.doubleValue ?? 0
    if width < 240 || height < 180 { continue }
    list.append(Win(
      id: CGWindowID(number),
      owner: item[kCGWindowOwnerName as String] as? String ?? "",
      name: item[kCGWindowName as String] as? String ?? "",
      x: (bounds["X"] as? NSNumber)?.doubleValue ?? 0,
      y: (bounds["Y"] as? NSNumber)?.doubleValue ?? 0,
      width: width,
      height: height
    ))
  }
  return list
}

func isBrowser(_ owner: String) -> Bool {
  let name = owner.lowercased()
  return ["chrome", "chromium", "safari", "firefox", "arc", "edge", "brave", "orion", "dia", "vivaldi", "electron", "cursor"]
    .contains { name.contains($0) }
}

func globalOrigin(_ request: ShotRequest) -> (Double, Double) {
  let x = request.screenX
  let y = request.screenY
  let left = request.screenLeft
  let top = request.screenTop
  let width = request.screenWidth
  let height = request.screenHeight
  if width > 1 && height > 1 {
    let onScreen = x >= left - 20 && x <= left + width + 20 && y >= top - 20 && y <= top + height + 20
    if onScreen { return (x, y) }
    return (left + x, top + y)
  }
  return (x, y)
}

func overlap(_ window: Win, _ originX: Double, _ originY: Double, _ width: Double, _ height: Double) -> Double {
  let iw = max(0, min(originX + width, window.x + window.width) - max(originX, window.x))
  let ih = max(0, min(originY + height, window.y + window.height) - max(originY, window.y))
  return iw * ih
}

func onSameScreen(_ window: Win, _ request: ShotRequest, _ originX: Double, _ originY: Double) -> Bool {
  if request.screenWidth < 2 || request.screenHeight < 2 { return true }
  let left = request.screenLeft - 40
  let top = request.screenTop - 40
  let right = request.screenLeft + request.screenWidth + 40
  let bottom = request.screenTop + request.screenHeight + 40
  let cx = originX + request.outerWidth / 2
  let cy = originY + request.outerHeight / 2
  let wx = window.x + window.width / 2
  let wy = window.y + window.height / 2
  let browserOnScreen = cx >= left && cx <= right && cy >= top && cy <= bottom
  let windowOnScreen = wx >= left && wx <= right && wy >= top && wy <= bottom
  return browserOnScreen && windowOnScreen
}

func bestOverlap(_ list: [Win], _ originX: Double, _ originY: Double, _ width: Double, _ height: Double) -> Win? {
  list.max { overlap($0, originX, originY, width, height) < overlap($1, originX, originY, width, height) }
}

func windowForRequest(_ request: ShotRequest) -> Win? {
  let origin = globalOrigin(request)
  let token = request.match.trimmingCharacters(in: .whitespacesAndNewlines)
  if token.count >= 6 {
    for attempt in 0..<6 {
      let named = windows().filter { $0.name.contains(token) }
      if let hit = bestOverlap(named, origin.0, origin.1, request.outerWidth, request.outerHeight) {
        return hit
      }
      if attempt < 5 { Thread.sleep(forTimeInterval: 0.12) }
    }
  }
  let area = max(1, request.outerWidth * request.outerHeight)
  let browsers = windows().filter { isBrowser($0.owner) && onSameScreen($0, request, origin.0, origin.1) }
  let ranked = browsers.map { ($0, overlap($0, origin.0, origin.1, request.outerWidth, request.outerHeight)) }
  if let hit = ranked.max(by: { $0.1 < $1.1 }), hit.1 > area * 0.35 {
    return hit.0
  }
  return nil
}

guard let window = windowForRequest(request) else {
  fail("No browser window on this screen to capture")
}

let rawURL = outURL.deletingLastPathComponent().appendingPathComponent("crank-window-\(window.id).png")
let capture = Process()
capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
capture.arguments = ["-x", "-o", "-l", String(window.id), rawURL.path]
try capture.run()
capture.waitUntilExit()
if capture.terminationStatus != 0 || !FileManager.default.fileExists(atPath: rawURL.path) {
  fail("Could not capture the browser window")
}

guard let source = CGImageSourceCreateWithURL(rawURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
  fail("Could not read the window capture")
}

func rgba(_ image: CGImage) -> (Data, Int, Int) {
  let width = image.width
  let height = image.height
  let row = width * 4
  var buffer = Data(count: row * height)
  buffer.withUnsafeMutableBytes { raw in
    guard let ctx = CGContext(
      data: raw.baseAddress,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: row,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return }
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  }
  return (buffer, width, height)
}

func markerCenter(_ image: CGImage, _ innerCss: Double) -> (Double, Double, Double)? {
  let (buffer, width, height) = rgba(image)
  let inner = max(4, innerCss)
  return buffer.withUnsafeBytes { raw -> (Double, Double, Double)? in
    guard let data = raw.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return nil }
    var points: [(Int, Int)] = []
    points.reserveCapacity(4000)
    for y in 0..<height {
      let row = y * width * 4
      for x in 0..<width {
        let i = row + x * 4
        let r = data[i]
        let g = data[i + 1]
        let b = data[i + 2]
        if r > 235 && g < 30 && b > 235 {
          points.append((x, y))
        }
      }
    }
    if points.count < 12 { return nil }
    var occupied = Set<Int>()
    occupied.reserveCapacity(points.count)
    for point in points { occupied.insert(point.1 * width + point.0) }
    var seen = Set<Int>()
    var best: (Int, Int, Int, Int, Int)?
    var bestScore = Int.max
    for point in points {
      let start = point.1 * width + point.0
      if seen.contains(start) { continue }
      var stack = [point]
      seen.insert(start)
      var minX = point.0
      var maxX = point.0
      var minY = point.1
      var maxY = point.1
      var count = 0
      while let current = stack.popLast() {
        count += 1
        minX = min(minX, current.0)
        maxX = max(maxX, current.0)
        minY = min(minY, current.1)
        maxY = max(maxY, current.1)
        let neighbors = [(current.0 + 1, current.1), (current.0 - 1, current.1), (current.0, current.1 + 1), (current.0, current.1 - 1)]
        for neighbor in neighbors {
          if neighbor.0 < 0 || neighbor.1 < 0 || neighbor.0 >= width || neighbor.1 >= height { continue }
          let key = neighbor.1 * width + neighbor.0
          if occupied.contains(key) && !seen.contains(key) {
            seen.insert(key)
            stack.append(neighbor)
          }
        }
      }
      let boxW = maxX - minX + 1
      let boxH = maxY - minY + 1
      if boxW < 6 || boxH < 6 || boxW > 160 || boxH > 160 { continue }
      let target = Int((inner * 2) * (inner * 2))
      let score = abs(count - target) + abs(boxW - boxH) * 8
      if score < bestScore {
        bestScore = score
        best = (minX, minY, maxX, maxY, count)
      }
    }
    guard let box = best else { return nil }
    let scale = Double(box.2 - box.0 + 1) / inner
    if scale < 0.5 || scale > 6 { return nil }
    return (Double(box.0 + box.2) / 2, Double(box.1 + box.3) / 2, scale)
  }
}

let anchor: (Double, Double, Double)
if request.anchorX >= 0 && request.anchorY >= 0 && request.pixelScale > 0.5 {
  anchor = (request.anchorX, request.anchorY, request.pixelScale)
} else if let found = markerCenter(image, request.markerInner) {
  anchor = found
} else {
  try? FileManager.default.removeItem(at: rawURL)
  fail("Could not see the selection in the browser window")
}

if request.locate {
  let payload: [String: Any] = ["ok": true, "x": anchor.0, "y": anchor.1, "scale": anchor.2]
  if let body = try? JSONSerialization.data(withJSONObject: payload), let text = String(data: body, encoding: .utf8) {
    print(text)
  }
  try? FileManager.default.removeItem(at: rawURL)
  exit(0)
}

var srcW = max(1, request.frameWidth * anchor.2)
var srcH = max(1, request.frameHeight * anchor.2)
var srcX = anchor.0 - srcW / 2
var srcY = anchor.1 - srcH / 2
if request.viewCenterX >= 0 && request.viewCenterY >= 0 && request.innerWidth > 1 && request.innerHeight > 1 {
  let seenW = request.viewWidth > 1 ? request.viewWidth : request.innerWidth
  let seenH = request.viewHeight > 1 ? request.viewHeight : request.innerHeight
  let viewL = anchor.0 - request.viewCenterX * anchor.2
  let viewT = anchor.1 - request.viewCenterY * anchor.2
  let viewR = viewL + seenW * anchor.2
  let viewB = viewT + seenH * anchor.2
  if srcW > viewR - viewL { srcW = max(1, viewR - viewL) }
  if srcH > viewB - viewT { srcH = max(1, viewB - viewT) }
  srcX = min(max(srcX, viewL), viewR - srcW)
  srcY = min(max(srcY, viewT), viewB - srcH)
}
let fit = min(1, 1400 / srcW, 900 / srcH)
let outW = max(1, Int((srcW * fit).rounded()))
let outH = max(1, Int((srcH * fit).rounded()))
guard let context = CGContext(
  data: nil,
  width: outW,
  height: outH,
  bitsPerComponent: 8,
  bytesPerRow: 0,
  space: CGColorSpaceCreateDeviceRGB(),
  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
  fail("Could not prepare the thumbnail")
}
context.setFillColor(CGColor(gray: 0.96, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: outW, height: outH))
let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
let requested = CGRect(x: srcX, y: srcY, width: srcW, height: srcH)
let visible = requested.intersection(bounds).integral
if let part = image.cropping(to: visible) {
  let destX = (visible.minX - srcX) * fit
  let destY = (visible.minY - srcY) * fit
  context.draw(part, in: CGRect(x: destX, y: destY, width: visible.width * fit, height: visible.height * fit))
}
if request.selWidth > 1 && request.selHeight > 1 && request.viewCenterX >= 0 && request.viewCenterY >= 0 && anchor.2 > 0.5 {
  let scale = anchor.2
  let viewL = anchor.0 - request.viewCenterX * scale
  let viewT = anchor.1 - request.viewCenterY * scale
  let left = (viewL + request.selLeft * scale - srcX) * fit
  let top = (viewT + request.selTop * scale - srcY) * fit
  let markW = request.selWidth * scale * fit
  let markH = request.selHeight * scale * fit
  let canvas = CGRect(x: 0, y: 0, width: outW, height: outH)
  let box = CGRect(x: left, y: Double(outH) - top - markH, width: markW, height: markH).intersection(canvas)
  if box.width > 4 && box.height > 4 {
    let weight = max(4, Double(min(outW, outH)) * 0.02)
    context.setStrokeColor(CGColor(red: 0.86, green: 0.15, blue: 0.15, alpha: 1))
    context.setLineWidth(weight)
    context.stroke(box.insetBy(dx: weight / 2, dy: weight / 2))
  }
}
guard let cropped = context.makeImage() else {
  fail("Could not crop the thumbnail")
}

guard let destination = CGImageDestinationCreateWithURL(outURL as CFURL, UTType.png.identifier as CFString, 1, nil) else {
  fail("Could not write the thumbnail")
}
CGImageDestinationAddImage(destination, cropped, nil)
if !CGImageDestinationFinalize(destination) {
  fail("Could not write the thumbnail")
}
try? FileManager.default.removeItem(at: rawURL)
