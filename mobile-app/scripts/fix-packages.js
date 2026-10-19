const fs = require('fs');
const path = require('path');

const packages = [
  { name: 'react-native-reanimated', field: 'react-native', from: 'src/index', to: 'lib/module/index' },
  { name: 'react-native-worklets', field: 'react-native', from: './src/index', to: './lib/module/index' },
];

for (const pkg of packages) {
  const pkgPath = path.join(__dirname, '..', 'node_modules', pkg.name, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.log(`[fix-packages] ${pkg.name} not found, skipping`);
    continue;
  }
  const json = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (json[pkg.field] === pkg.from) {
    json[pkg.field] = pkg.to;
    fs.writeFileSync(pkgPath, JSON.stringify(json, null, 2) + '\n');
    console.log(`[fix-packages] Fixed ${pkg.name}: ${pkg.field} ${pkg.from} -> ${pkg.to}`);
  } else if (json[pkg.field] === pkg.to) {
    console.log(`[fix-packages] ${pkg.name} already fixed`);
  } else {
    console.log(`[fix-packages] ${pkg.name}: unexpected value '${json[pkg.field]}', skipping`);
  }
}
