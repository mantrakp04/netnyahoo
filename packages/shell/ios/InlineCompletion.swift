import AppKit
import ExpoModulesCore

/// The command bar's inline autocompletion ("m" → "m[ail.google.com]", the completion selected),
/// written into a React Native text field in one step on the main thread.
///
/// JS computes a completion for the text it last heard from the field, a round trip behind the
/// keyboard. Setting the text and then the selection through TextInput's props lands them in
/// separate main-thread turns, and keys typed in between went after the completion or had their
/// text replaced by a late selection. Here the completion is applied only if the field still shows
/// exactly the text it was computed for (plus the completion shown before, if any, still selected),
/// and text and selection change together, before the next key is handled.
public final class InlineCompletionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooInlineCompletion")

    /// Shows `typed` + `completion` in the TextInput `tag` with the completion selected, if the
    /// field still shows `typed` with the caret after it or the rest of its text (an earlier
    /// completion) selected. 0: refused, nothing changed; 1: the text was already there, only the
    /// selection was set; 2: the text changed, through the field editor like typing, so the
    /// TextInput reports it with an `onChange` (the echo).
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
      // Show the field from its start, as Chrome does, unless that hides where the typing is.
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
