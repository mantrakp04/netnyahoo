#include "arcadia/core/ac_tab_info.h"

#include <utility>

#include "base/strings/sys_string_conversions.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/ssl_status.h"
#include "content/public/browser/web_contents.h"
#include "net/cert/cert_status_flags.h"
#include "net/cert/x509_certificate.h"
#include "net/ssl/ssl_connection_status_flags.h"
#include "url/gurl.h"

namespace arcadiacore {

namespace {

NSString* NS(const std::string& s) {
  return base::SysUTF8ToNSString(s);
}

NSString* Hex(base::span<const uint8_t> bytes, NSString* separator) {
  NSMutableArray* parts = [NSMutableArray arrayWithCapacity:bytes.size()];
  for (uint8_t b : bytes) {
    [parts addObject:[NSString stringWithFormat:@"%02X", b]];
  }
  return [parts componentsJoinedByString:separator];
}

NSDictionary* Principal(const net::CertPrincipal& p) {
  NSMutableArray* organizations = [NSMutableArray array];
  for (const std::string& o : p.organization_names) {
    [organizations addObject:NS(o)];
  }
  return @{
    @"commonName" : NS(p.common_name),
    @"displayName" : NS(p.GetDisplayName()),
    @"organizations" : organizations,
    @"country" : NS(p.country_name),
  };
}

NSArray<NSString*>* CertErrorNames(net::CertStatus status) {
  static const std::pair<net::CertStatus, NSString*> kErrors[] = {
      {net::CERT_STATUS_COMMON_NAME_INVALID, @"nameMismatch"},
      {net::CERT_STATUS_DATE_INVALID, @"dateInvalid"},
      {net::CERT_STATUS_AUTHORITY_INVALID, @"authorityInvalid"},
      {net::CERT_STATUS_REVOKED, @"revoked"},
      {net::CERT_STATUS_INVALID, @"invalid"},
      {net::CERT_STATUS_WEAK_SIGNATURE_ALGORITHM, @"weakSignature"},
      {net::CERT_STATUS_NON_UNIQUE_NAME, @"nonUniqueName"},
      {net::CERT_STATUS_WEAK_KEY, @"weakKey"},
      {net::CERT_STATUS_PINNED_KEY_MISSING, @"pinnedKeyMissing"},
      {net::CERT_STATUS_NAME_CONSTRAINT_VIOLATION, @"nameConstraint"},
      {net::CERT_STATUS_VALIDITY_TOO_LONG, @"validityTooLong"},
      {net::CERT_STATUS_CERTIFICATE_TRANSPARENCY_REQUIRED,
       @"certificateTransparency"},
  };
  NSMutableArray* names = [NSMutableArray array];
  for (const auto& [bit, name] : kErrors) {
    if (status & bit) {
      [names addObject:name];
    }
  }
  return names;
}

NSDictionary* CertificateInfo(const net::X509Certificate* cert) {
  if (!cert) {
    return nil;
  }
  const net::SHA256HashValue sha256 =
      net::X509Certificate::CalculateFingerprint256(cert->cert_buffer());
  return @{
    @"subject" : Principal(cert->subject()),
    @"issuer" : Principal(cert->issuer()),
    @"validFrom" : @(cert->valid_start().InMillisecondsFSinceUnixEpoch()),
    @"validUntil" : @(cert->valid_expiry().InMillisecondsFSinceUnixEpoch()),
    @"chainLength" : @(cert->intermediate_buffers().size() + 1),
    @"serialNumber" : Hex(cert->serial_number(), @":"),
    @"sha256" : Hex(sha256, @":"),
  };
}

NSString* TLSVersion(int connection_status) {
  switch (net::SSLConnectionStatusToVersion(connection_status)) {
    case net::SSL_CONNECTION_VERSION_TLS1:
      return @"TLS 1.0";
    case net::SSL_CONNECTION_VERSION_TLS1_1:
      return @"TLS 1.1";
    case net::SSL_CONNECTION_VERSION_TLS1_2:
      return @"TLS 1.2";
    case net::SSL_CONNECTION_VERSION_TLS1_3:
      return @"TLS 1.3";
    case net::SSL_CONNECTION_VERSION_QUIC:
      return @"QUIC";
    default:
      return nil;
  }
}

// CEF's mask: errors, not "couldn't check revocation".
constexpr net::CertStatus kCertErrorMask =
    net::CERT_STATUS_ALL_ERRORS & ~(net::CERT_STATUS_NO_REVOCATION_MECHANISM |
                                    net::CERT_STATUS_UNABLE_TO_CHECK_REVOCATION);

}  // namespace

NSString* OriginOf(const GURL& url) {
  if (!url.SchemeIsHTTPOrHTTPS() || url.host().empty()) {
    return nil;
  }
  std::string origin = std::string(url.scheme()) + "://" + std::string(url.host());
  if (url.has_port()) {
    origin += ":" + std::string(url.port());
  }
  return NS(origin);
}

NSDictionary* SecurityInfoFor(content::WebContents* contents) {
  if (!contents) {
    return @{@"level" : @"none"};
  }
  content::NavigationEntry* entry = contents->GetController().GetVisibleEntry();
  const GURL url = entry ? entry->GetURL() : contents->GetVisibleURL();
  NSMutableDictionary* info = [@{
    @"url" : NS(url.spec()),
    @"origin" : OriginOf(url) ?: NSNull.null,
  } mutableCopy];
  if (url.SchemeIs("http") || url.SchemeIs("ws")) {
    info[@"level"] = @"insecure";
    return info;
  }
  if (!url.SchemeIs("https") && !url.SchemeIs("wss")) {
    info[@"level"] =
        !url.is_empty() && url != GURL("about:blank") ? @"local" : @"none";
    return info;
  }
  if (!entry) {
    info[@"level"] = @"none";
    return info;
  }
  const content::SSLStatus& ssl = entry->GetSSL();
  const net::CertStatus errors = ssl.cert_status & kCertErrorMask;
  const int content = ssl.content_status;
  NSString* level = @"secure";
  if (errors || !ssl.certificate) {
    level = @"certificateError";
  } else if (content & (content::SSLStatus::RAN_INSECURE_CONTENT |
                        content::SSLStatus::DISPLAYED_INSECURE_CONTENT |
                        content::SSLStatus::RAN_CONTENT_WITH_CERT_ERRORS |
                        content::SSLStatus::DISPLAYED_CONTENT_WITH_CERT_ERRORS)) {
    level = @"mixed";
  }
  info[@"level"] = level;
  info[@"certificateErrors"] = CertErrorNames(errors);
  info[@"mixedContent"] = (content & (content::SSLStatus::RAN_INSECURE_CONTENT |
                                      content::SSLStatus::RAN_CONTENT_WITH_CERT_ERRORS))
                              ? @"ran"
                          : (content & (content::SSLStatus::DISPLAYED_INSECURE_CONTENT |
                                        content::SSLStatus::DISPLAYED_CONTENT_WITH_CERT_ERRORS))
                              ? @"displayed"
                              : (id)NSNull.null;
  info[@"isEV"] = @((ssl.cert_status & net::CERT_STATUS_IS_EV) != 0);
  if (NSString* tls = TLSVersion(ssl.connection_status)) {
    info[@"protocol"] = tls;
  }
  if (NSDictionary* cert = CertificateInfo(ssl.certificate.get())) {
    info[@"certificate"] = cert;
  }
  return info;
}

}  // namespace arcadiacore
