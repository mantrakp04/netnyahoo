# CEF itself (the framework + helper apps) is copied into the app bundle by
# scripts/embed.sh; this pod only holds the embedding code, which loads the
# framework at runtime (CefScopedLibraryLoader) and links the static C++ wrapper.
# The NN_CEF_ROOT build setting (e.g. `xcodebuild ... NN_CEF_ROOT=<dir>`) builds
# against another CEF install than vendor/cef (scripts/setup.sh CEF_ROOT=<dir>).
cef = "$(NN_CEF_ROOT:default=#{File.expand_path('../vendor/cef', __dir__)})"

Pod::Spec.new do |s|
  s.name           = 'NetnyahooCEF'
  s.version        = '0.0.0'
  s.summary        = 'Chromium Embedded Framework for React Native macOS'
  s.author         = ''
  s.homepage       = 'https://github.com/netnyahoo'
  s.license        = 'MIT'
  s.platforms      = { :osx => '14.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # Touch ID before revealing a saved card number (NNAutofill).
  s.frameworks     = 'LocalAuthentication'
  s.source_files   = '*.{h,mm,swift}'
  s.public_header_files = 'NNCef.h', 'NNExtensions.h', 'NNSwipe.h'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => "\"#{cef}\"",
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
    # Must match how libcef_dll_wrapper was built (Release): DCHECK_IS_ON changes class layouts.
    'OTHER_CPLUSPLUSFLAGS' => '$(inherited) -DNDEBUG',
  }
  s.user_target_xcconfig = {
    'OTHER_LDFLAGS' => "$(inherited) \"#{cef}/build/libcef_dll_wrapper/libcef_dll_wrapper.a\"",
  }
end
