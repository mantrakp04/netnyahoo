import AppKit
import ExpoModulesCore
import NaturalLanguage
import SwiftUI
@_weakLinked import Translation

public class TranslateModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooTranslate")

    Constant("available") { () -> Bool in
      if #available(macOS 26.0, *) { return true }
      return false
    }

    Function("userLanguages") { () -> [String] in Locale.preferredLanguages }

    Function("languageName") { (identifier: String) -> String in
      Locale.current.localizedString(forIdentifier: identifier) ?? identifier
    }

    AsyncFunction("detect") { (text: String) -> String? in
      let recognizer = NLLanguageRecognizer()
      recognizer.processString(text)
      guard let (language, confidence) = recognizer.languageHypotheses(withMaximum: 1).first, confidence >= 0.5 else { return nil }
      return language.rawValue
    }

    AsyncFunction("status") { (source: String, target: String) async -> String in
      guard #available(macOS 26.0, *) else { return "unsupported" }
      switch await LanguageAvailability().status(from: Locale.Language(identifier: source), to: Locale.Language(identifier: target)) {
      case .installed: return "installed"
      case .supported: return "supported"
      default: return "unsupported"
      }
    }

    AsyncFunction("supportedLanguages") { () async -> [String] in
      guard #available(macOS 26.0, *) else { return [] }
      return await LanguageAvailability().supportedLanguages.map { $0.minimalIdentifier }
    }

    AsyncFunction("prepare") { (source: String, target: String) async throws in
      guard #available(macOS 26.0, *) else { throw TranslateError.unavailable }
      try await DownloadPrompt.run(source: Locale.Language(identifier: source), target: Locale.Language(identifier: target))
    }

    AsyncFunction("translateBlocks") { (source: String, target: String, blocks: [[String]]) async -> [[String]?] in
      guard #available(macOS 26.4, *) else { return blocks.map { _ in nil } }
      let session = await Self.session(source: source, target: target)
      var out: [[String]?] = blocks.map { _ in nil }
      for (b, pieces) in blocks.enumerated() {
        var text = AttributedString()
        for (i, piece) in pieces.enumerated() {
          var run = AttributedString(piece)
          run.link = URL(string: "nn-piece:\(i)")
          text += run
        }
        guard let translated = try? await session.translate(text).attributedTargetText else { continue }
        var parts = Array(repeating: "", count: pieces.count)
        var order: [Int] = []
        var last = 0
        for run in translated.runs {
          let words = String(translated[run.range].characters)
          if let link = run.link, link.scheme == "nn-piece", let i = Int(link.absoluteString.dropFirst("nn-piece:".count)), parts.indices.contains(i) {
            order.append(i)
            last = i
            parts[i] += words
          } else {
            parts[last] += words
          }
        }
        guard !order.isEmpty else { continue }
        if zip(order, order.dropFirst()).contains(where: { $0 > $1 }) {
          parts = Self.distribute(String(translated.characters), over: pieces)
        }
        out[b] = parts
      }
      return out
    }

    AsyncFunction("translate") { (source: String, target: String, texts: [String]) async throws -> [String] in
      guard #available(macOS 26.0, *) else { throw TranslateError.unavailable }
      let session = await Self.session(source: source, target: target)
      let requests = texts.enumerated().map { TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset)) }
      var out = texts
      for response in try await session.translations(from: requests) {
        if let i = response.clientIdentifier.flatMap(Int.init), out.indices.contains(i) { out[i] = response.targetText }
      }
      return out
    }
  }
}

extension TranslateModule {
  @available(macOS 26.0, *)
  static func session(source: String, target: String) async -> TranslationSession {
    let from = Locale.Language(identifier: source), to = Locale.Language(identifier: target)
    if #available(macOS 26.4, *), await LanguageAvailability(preferredStrategy: .lowLatency).status(from: from, to: to) == .installed {
      return TranslationSession(installedSource: from, target: to, preferredStrategy: .lowLatency)
    }
    return TranslationSession(installedSource: from, target: to)
  }
}

extension TranslateModule {
  static func distribute(_ text: String, over pieces: [String]) -> [String] {
    let chars = Array(text)
    let total = max(1, pieces.reduce(0) { $0 + $1.count })
    var out: [String] = []
    var start = 0
    var seen = 0
    for (i, piece) in pieces.enumerated() {
      seen += piece.count
      var end = i == pieces.count - 1 ? chars.count : min(chars.count, Int((Double(seen) / Double(total) * Double(chars.count)).rounded()))
      if end < chars.count, end > start {
        let window = 12
        if let space = (0...window).lazy.flatMap({ [end + $0, end - $0] }).first(where: { $0 > start && $0 < chars.count && chars[$0] == " " }) {
          end = space + 1
        }
      }
      end = max(start, end)
      out.append(String(chars[start..<end]))
      start = end
    }
    return out
  }
}

enum TranslateError: LocalizedError {
  case unavailable, noWindow
  var errorDescription: String? {
    switch self {
    case .unavailable: return "needs macOS 26"
    case .noWindow: return "no window to ask in"
    }
  }
}

@available(macOS 26.0, *)
@MainActor
enum DownloadPrompt {
  static func run(source: Locale.Language, target: Locale.Language) async throws {
    guard let content = (NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first { $0.isVisible })?.contentView else {
      throw TranslateError.noWindow
    }
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      var host: NSView?
      var finished = false
      let view = DownloadPromptView(configuration: .init(source: source, target: target)) { result in
        guard !finished else { return }
        finished = true
        host?.removeFromSuperview()
        continuation.resume(with: result)
      }
      let hosting = NSHostingView(rootView: view)
      hosting.frame = NSRect(x: 0, y: 0, width: 1, height: 1)
      host = hosting
      content.addSubview(hosting)
    }
  }
}

@available(macOS 26.0, *)
private struct DownloadPromptView: View {
  let configuration: TranslationSession.Configuration
  let done: (Result<Void, Error>) -> Void
  var body: some View {
    Color.clear.translationTask(configuration) { session in
      do {
        try await session.prepareTranslation()
        done(.success(()))
      } catch {
        done(.failure(error))
      }
    }
  }
}
