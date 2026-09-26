Pod::Spec.new do |s|
  s.name           = 'NetnyahooShell'
  s.version        = '0.0.0'
  s.summary        = 'Window chrome and menus'
  s.author         = ''
  s.homepage       = 'https://github.com/netnyahoo'
  s.license        = 'MIT'
  s.platforms      = { :osx => '14.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # Auto-updates (Updater.swift).
  s.dependency 'Sparkle', '~> 2.9'
  s.frameworks     = 'AppKit', 'LocalAuthentication', 'ServiceManagement', 'UniformTypeIdentifiers', 'UserNotifications', 'CoreImage', 'EventKit', 'Security', 'NaturalLanguage', 'SwiftUI'
  # Page translation (TranslateModule.swift): new in macOS 15, weakly linked for 14.
  s.weak_frameworks = 'Translation'
  s.source_files   = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
