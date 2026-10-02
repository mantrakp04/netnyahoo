Pod::Spec.new do |s|
  s.name           = 'NetnyahooImport'
  s.version        = '0.0.0'
  s.summary        = 'Import bookmarks, history, tabs and logins from other browsers'
  s.author         = ''
  s.homepage       = 'https://github.com/netnyahoo'
  s.license        = 'MIT'
  s.platforms      = { :osx => '14.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # Imported cookies and cards go straight to the engine (NNCoreEngineBridge), never through JS.
  s.dependency 'NetnyahooNNCore'
  s.frameworks     = 'AppKit', 'Security'
  s.libraries      = 'sqlite3'
  # Core/ is plain Swift with no Expo dependency; it's also built and tested on its own by
  # ../Package.swift (`pnpm --filter @netnyahoo/import test`).
  s.source_files   = 'ImportModule.swift', 'ImportWriter.swift', 'Core/**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
