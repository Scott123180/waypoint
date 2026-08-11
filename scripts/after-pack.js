"use strict";

const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

/**
 * Ad-hoc signs the macOS bundle.
 *
 * Apple Silicon refuses to execute an unsigned arm64 binary. Electron ships
 * signed, but repackaging it — adding app.asar, the whisper resources, renaming
 * the bundle — invalidates that signature, and `identity: null` means nothing
 * re-applies one. The result launches nowhere and macOS reports it as "Waypoint
 * is damaged and can't be opened", which reads like a corrupt download and
 * cannot be dismissed with right-click → Open.
 *
 * An ad-hoc signature (`--sign -`) is not a Developer ID and does not notarize
 * anything. It does exactly one thing: makes the binary loadable. Gatekeeper
 * still asks about an unidentified developer on first launch, which *is*
 * bypassable. Real signing and notarization remain deferred.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  // --deep is discouraged for Developer ID signing, where each nested component
  // needs its own entitlements, but it is the right tool for a blanket ad-hoc
  // pass over Electron's frameworks and helper apps.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });

  // Verify rather than assume: a signature that did not take would reproduce
  // the exact failure this hook exists to prevent, and silently.
  execFileSync("codesign", ["--verify", "--verbose=2", appPath], {
    stdio: "inherit",
  });

  console.log(`  • ad-hoc signed  ${appPath}`);
};
