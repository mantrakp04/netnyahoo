Pod::Spec.new do |s|
  s.name           = 'NetnyahooSync'
  s.version        = '0.0.0'
  s.summary        = 'End-to-end-encrypted sync through a folder the user chooses'
  s.author         = ''
  s.homepage       = 'https://github.com/netnyahoo'
  s.license        = 'MIT'
  s.platforms      = { :osx => '14.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # Reads this app's own saved passwords with the importer's Chromium reader.
  s.dependency 'NetnyahooImport'
  s.frameworks     = 'AppKit', 'CoreImage', 'CryptoKit', 'Security'
  # Core/ is plain Swift with no Expo dependency; it's also built and tested on its own by
  # ../Package.swift (`pnpm --filter @netnyahoo/sync test`).
  s.source_files   = 'SyncModule.swift', 'Core/**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
