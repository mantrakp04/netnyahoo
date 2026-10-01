# The web engine's native side (Expo modules NetnyahooCEF, NetnyahooExtensions, NetnyahooSwipe and
# NetnyahooChromeUI, the names the JS in ../src uses), on our own Chromium layer (engine/nncore).
#
# The engine is Chrome's framework built with engine/nncore ("Chromium Framework.framework"). The app
# target stages a copy of it (packages/nncore/scripts/stage-framework.sh), links that and embeds it
# (scripts/embed.sh); this pod only needs NNCore's public header.
engine_public = File.expand_path('../../../engine/nncore/src/netnyahoo/core/public', __dir__)

Pod::Spec.new do |s|
  s.name           = 'NetnyahooNNCore'
  s.version        = '0.0.0'
  s.summary        = 'Netnyahoo on NNCore (our own Chromium layer) for React Native macOS'
  s.author         = ''
  s.homepage       = 'https://github.com/netnyahoo'
  s.license        = 'Apache-2.0'
  s.platforms      = { :osx => '14.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '*.{h,mm,swift}'
  s.public_header_files = 'NNCoreHost.h', 'NNCoreWebView.h', 'NNCoreTabStrip.h', 'NNCoreEngineBridge.h', 'NNCoreServices.h', 'NNSwipe.h', 'NNChromeWindow.h'
  s.resources      = 'page_script.js'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => "\"#{engine_public}\"",
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
  }
end
