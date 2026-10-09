# GN args for the Arcadia engine build, all of them (02-gn-args.sh writes args.gn from this list).
_gn_args=(
  # Fast release build: no official/LTO/PGO, no DCHECKs, no symbols.
  is_official_build=false
  is_debug=false
  dcheck_always_on=false
  use_thin_lto=false
  chrome_pgo_phase=0
  symbol_level=0 blink_symbol_level=0 v8_symbol_level=0
  is_component_build=false
  forbid_non_component_debug_builds=false
  target_cpu='"arm64"'
  # Codecs: H.264 / AAC (VideoToolbox + ffmpeg "Chrome" branding), MPEG2-TS MSE, Widevine.
  proprietary_codecs=true
  'ffmpeg_branding="Chrome"'
  enable_mse_mpeg2ts_stream_parser=true
  enable_widevine=true
  enable_cdm_host_verification=true
  enable_cdm_storage_id=true
  # Widevine's storage id: changing it loses every user's licences.
  'alternate_cdm_storage_id_key="968b476909da4373b08903c28e859454"'
  # Newer SDK than Chromium expects: never fail on warnings.
  treat_warnings_as_errors=false
  fatal_linker_warnings=false
  clang_use_chrome_plugins=false
  enable_precompiled_headers=false
  # ungoogled-chromium flags.gn (154.0.8037.97-1), as the CEF-era build had them.
  # Not used: safe_browsing_mode=0, enable_mdns/enable_service_discovery/enable_reporting=false
  # (kept as in the CEF-era build; domain substitution already cuts their Google endpoints).
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
  # Formerly merged in by CEF's tools/gn_args.py; the values the shipped builds had.
  enable_background_mode=false
  enable_downgrade_processing=false
  enable_resource_allowlist_generation=false
  enable_rlz=true
  optimize_webui=true
  # Was is_debug || enable_cef: Release logs to chrome_debug.log, which our diagnostics read.
  chrome_enable_logging_by_default=true
  # Arcadia's bundle and team id (webauthn/payments keychain access groups);
  # product names stay "Chromium" (chromium-branding.patch).
  'branding_file_path="//chrome/app/theme/arcadia/BRANDING"'
)
export GN_DEFINES="${_gn_args[*]}"
