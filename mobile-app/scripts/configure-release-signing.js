/**
 * Configures the generated android/app/build.gradle to sign the release
 * build with the HR MAX upload keystore (read from gradle.properties
 * HRMAX_UPLOAD_* keys, injected by the CI workflow).
 */
const fs = require('fs');
const path = require('path');

const buildGradlePath = path.join(process.cwd(), 'android', 'app', 'build.gradle');
if (!fs.existsSync(buildGradlePath)) {
  console.error(`Missing ${buildGradlePath}`);
  process.exit(1);
}

let bg = fs.readFileSync(buildGradlePath, 'utf8');

// 1) Inject a `release` signing config inside the signingConfigs block.
const marker = 'signingConfigs {';
const idx = bg.indexOf(marker);
if (idx === -1) {
  console.error('signingConfigs block not found in build.gradle');
  process.exit(1);
}
const openBraceIdx = bg.indexOf('{', idx);
if (openBraceIdx === -1) {
  console.error('Could not locate signingConfigs opening brace');
  process.exit(1);
}

const releaseSigning = `
    release {
        if (project.hasProperty('HRMAX_UPLOAD_STORE_FILE')) {
            storeFile file(HRMAX_UPLOAD_STORE_FILE)
            storePassword HRMAX_UPLOAD_STORE_PASSWORD
            keyAlias HRMAX_UPLOAD_KEY_ALIAS
            keyPassword HRMAX_UPLOAD_KEY_PASSWORD
        }
    }`;

const insertAt = openBraceIdx + 1;
bg = bg.slice(0, insertAt) + '\n' + releaseSigning + '\n' + bg.slice(insertAt);

// 2) Point the release buildType at the release signing config.
// The debug buildType also references signingConfigs.debug; we must only
// rewrite the LAST occurrence (inside the release block).
const debugRef = 'signingConfig signingConfigs.debug';
const lastIdx = bg.lastIndexOf(debugRef);
if (lastIdx === -1) {
  console.error(`Expected '${debugRef}' in build.gradle release buildType`);
  process.exit(1);
}
bg =
  bg.slice(0, lastIdx) +
  'signingConfig signingConfigs.release' +
  bg.slice(lastIdx + debugRef.length);

fs.writeFileSync(buildGradlePath, bg);
console.log('OK: release signing configured with HRMAX_UPLOAD_* keystore');