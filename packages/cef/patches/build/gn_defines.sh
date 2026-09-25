# GN args for the Netnyahoo CEF build (sourced by the step scripts).
# CEF adds its own required args (enable_widevine, clang_use_chrome_plugins=false,
# enable_rlz, enable_cdm_*...) in tools/gn_args.py.
_gn_args=(
  # Fast release build: no official/LTO/PGO, no DCHECKs, no symbols.
  is_official_build=false
  is_debug=false
  dcheck_always_on=false
  use_thin_lto=false
  chrome_pgo_phase=0
  symbol_level=0 blink_symbol_level=0 v8_symbol_level=0
  # Codecs: H.264 / AAC (VideoToolbox + ffmpeg "Chrome" branding), MPEG2-TS MSE.
  proprietary_codecs=true
  'ffmpeg_branding="Chrome"'
  enable_mse_mpeg2ts_stream_parser=true
  enable_widevine=true
  # Newer SDK than Chromium expects: never fail on warnings.
  treat_warnings_as_errors=false
  fatal_linker_warnings=false
  # ungoogled-chromium flags.gn (154.0.8037.57-1), the subset that is safe with CEF.
  # Not used: safe_browsing_mode=0, enable_mdns/enable_service_discovery/enable_reporting=false
  # (build-breaking risk with CEF; domain substitution already cuts their Google endpoints).
  disable_fieldtrial_testing_config=true
  enable_hangout_services_extension=false
  enable_remoting=false
  exclude_unwind_tables=true
  'google_api_key=""'
  'google_default_client_id=""'
  'google_default_client_secret=""'
  use_official_google_api_keys=false
  use_unofficial_version_number=false
  v8_drumbrake_bounds_checks=true
  enable_iterator_debugging=false
  enable_updater=false
  # Netnyahoo's bundle and team id (webauthn/payments keychain access groups);
  # product names stay "Chromium" (patches/chromium-passkeys.patch).
  'branding_file_path="//chrome/app/theme/netnyahoo/BRANDING"'
)
export GN_DEFINES="${_gn_args[*]}"
