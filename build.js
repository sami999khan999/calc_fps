// Builds release/, the folder Load unpacked selects: the extension's files copied unchanged
// (same paths, so the manifest needs no rewriting). release/ is committed, so any device can
// load it without building. Run `node build.js` after any change and commit the result.
//   node build.js
const fs = require('fs');
const path = require('path');

const root = __dirname;
const RELEASE_DIR = path.join(root, 'release');
const ENTRIES = ['manifest.json', 'icons', 'content.js', 'popup.html', 'popup.css', 'popup.js'];

fs.rmSync(RELEASE_DIR, { recursive: true, force: true });
for (const entry of ENTRIES) {
    fs.cpSync(path.join(root, entry), path.join(RELEASE_DIR, entry), { recursive: true });
}
console.log(`✅ Build complete: release/ (${ENTRIES.join(', ')})`);
