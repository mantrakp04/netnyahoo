// Sparkle's EdDSA (Ed25519) signatures, with no private key of the release's:
//   ed25519 verify <file> <base64 signature> <base64 public key>   as Sparkle checks an update before installing it
//   ed25519 generate <private key file>                             a throwaway pair; prints the public key
//   ed25519 sign <file> <private key file>                          prints the base64 signature
import CryptoKit
import Foundation

func fail(_ s: String) -> Never { FileHandle.standardError.write((s + "\n").data(using: .utf8)!); exit(2) }
let args = CommandLine.arguments
switch (args.count > 1 ? args[1] : "", args.count) {
case ("verify", 5):
  guard let data = FileManager.default.contents(atPath: args[2]), let signature = Data(base64Encoded: args[3]),
        let raw = Data(base64Encoded: args[4]), let key = try? Curve25519.Signing.PublicKey(rawRepresentation: raw)
  else { fail("verify: unreadable file, signature or key") }
  exit(key.isValidSignature(signature, for: data) ? 0 : 1)
case ("generate", 3):
  let key = Curve25519.Signing.PrivateKey()
  FileManager.default.createFile(atPath: args[2], contents: key.rawRepresentation.base64EncodedData(), attributes: [.posixPermissions: 0o600])
  print(key.publicKey.rawRepresentation.base64EncodedString())
case ("sign", 4):
  guard let data = FileManager.default.contents(atPath: args[2]),
        let stored = FileManager.default.contents(atPath: args[3]), let raw = Data(base64Encoded: stored),
        let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: raw), let signature = try? key.signature(for: data)
  else { fail("sign: unreadable file or key") }
  print(signature.base64EncodedString())
default:
  fail("usage: ed25519 verify <file> <signature> <public key> | generate <key file> | sign <file> <key file>")
}
