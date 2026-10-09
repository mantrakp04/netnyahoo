extension CefModule {
  /// The //chrome/browser/arcadia exports the JS may call through `engineCall`, as packages/cef's ACEngineBridge
  /// allows them (history, favicons, closed tabs, bookmarks). The app's own services call the rest natively.
  static let engineCalls: Set<String> = [
    "ac_history_query", "ac_history_add", "ac_history_import", "ac_history_delete_urls", "ac_history_watch",
    "ac_favicons_get", "ac_favicons_set",
    "ac_tab_restore_load",
    "ac_bookmarks_tree", "ac_bookmarks_apply", "ac_bookmarks_watch",
    "ac_omnibox_opened",
  ]
}
