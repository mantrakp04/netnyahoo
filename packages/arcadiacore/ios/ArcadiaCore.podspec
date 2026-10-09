# The web engine's native side (Expo modules ArcadiaCEF, ArcadiaExtensions, ArcadiaSwipe and
# ArcadiaChromeUI, the names the JS in ../src uses), on our own Chromium layer (engine/arcadiacore).
#
# The engine is Chrome's framework built with engine/arcadiacore ("Chromium Framework.framework"). The app
# target stages a copy of it (packages/arcadiacore/scripts/stage-framework.sh), links that and embeds it
# (scripts/embed.sh); this pod only needs ArcadiaCore's public header.
engine_public = File.expand_path('../../../engine/arcadiacore/src/arcadia/core/public', __dir__)

Pod::Spec.new do |s|
  s.name           = 'ArcadiaCore'
  s.version        = '0.0.0'
  s.summary        = 'Arcadia on ArcadiaCore (our own Chromium layer) for React Native macOS'
  s.author         = ''
  s.homepage       = 'https://github.com/arcadia'
  s.license        = 'Apache-2.0'
  s.platforms      = { :osx => '14.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '*.{h,mm,swift}'
  s.public_header_files = 'ArcadiaCoreHost.h', 'ArcadiaCoreWebView.h', 'ArcadiaCoreTabStrip.h', 'ArcadiaCoreEngineBridge.h', 'ArcadiaCoreServices.h', 'ACSwipe.h', 'ACChromeWindow.h'
  s.resources      = 'page_script.js'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => "\"#{engine_public}\"",
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
  }
end
