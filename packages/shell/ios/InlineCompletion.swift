import AppKit
import ExpoModulesCore

/// Apply text and selection together before the next key is handled.
public final class InlineCompletionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArcadiaInlineCompletion")

    AsyncFunction("complete") { (tag: Int, typed: String, completion: String) -> Int in
      guard let host = self.appContext?.findView(withTag: tag, ofType: NSView.self),
            let field = textField(in: host),
            let editor = field.currentEditor() as? NSTextView,
            !editor.hasMarkedText()
      else { return 0 }
      let text = editor.string as NSString
      let typedLength = (typed as NSString).length
      let selection = editor.selectedRange()
      guard text.length >= typedLength, text.substring(to: typedLength) == typed,
            selection.location == typedLength, NSMaxRange(selection) == text.length
      else { return 0 }
      let tail = NSRange(location: typedLength, length: text.length - typedLength)
      var result = 1
      if text.substring(with: tail) != completion {
        guard editor.shouldChangeText(in: tail, replacementString: completion) else { return 0 }
        editor.replaceCharacters(in: tail, with: completion)
        editor.didChangeText()
        result = 2
      }
      editor.setSelectedRange(NSRange(location: typedLength, length: (completion as NSString).length))
      editor.scrollRangeToVisible(NSRange(location: 0, length: 0))
      editor.scrollRangeToVisible(NSRange(location: typedLength, length: 0))
      return result
    }.runOnQueue(.main)
  }
}

private func textField(in view: NSView) -> NSTextField? {
  if let field = view as? NSTextField { return field }
  for sub in view.subviews {
    if let field = textField(in: sub) { return field }
  }
  return nil
}
