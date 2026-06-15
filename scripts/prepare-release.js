#!/usr/bin/env node

/**
 * Release preparation script.
 * Bumps the version in package.json. Changelog is not maintained in-repo.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Deskmate.app release preparation tool');
console.log('=====================================\n');

// Read command line arguments.
const args = process.argv.slice(2);
const versionType = args[0] || 'patch'; // patch, minor, major, or an explicit version

// Validate the version argument.
const validTypes = ['patch', 'minor', 'major'];
const isCustomVersion = !validTypes.includes(versionType) && /^\d+\.\d+\.\d+$/.test(versionType);

if (!validTypes.includes(versionType) && !isCustomVersion) {
  console.error('❌ Invalid version type');
  console.log('Usage: node scripts/prepare-release.js [patch|minor|major|x.y.z]');
  console.log('Examples:');
  console.log('  node scripts/prepare-release.js patch    # 1.0.7 -> 1.0.8');
  console.log('  node scripts/prepare-release.js minor    # 1.0.7 -> 1.1.0');
  console.log('  node scripts/prepare-release.js major    # 1.0.7 -> 2.0.0');
  console.log('  node scripts/prepare-release.js 1.0.8    # Use an explicit version');
  process.exit(1);
}

try {
  // 1. Read the current version.
  const packagePath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const currentVersion = packageJson.version;

  console.log(`📦 Current version: ${currentVersion}`);

  // 2. Bump the version.
  console.log(`🔄 Updating version (${versionType})...`);

  let newVersion;
  if (isCustomVersion) {
    // Use the requested explicit version.
    newVersion = versionType;
    execSync(`npm version ${newVersion} --no-git-tag-version`, { stdio: 'inherit' });
  } else {
    // Use a semantic version bump type.
    const result = execSync(`npm version ${versionType} --no-git-tag-version`, { encoding: 'utf8', stdio: 'pipe' });
    newVersion = result.trim().substring(1); // Drop the leading v.
  }

  console.log(`✅ Version updated: ${currentVersion} -> ${newVersion}`);

  console.log('\n🎉 Release preparation completed');
  console.log('=====================================');
  console.log(`New version: ${newVersion}`);
  console.log('Next steps:');
  console.log('1. Commit the changes: git add . && git commit -m "Prepare release v' + newVersion + '"');
  console.log('2. Create the release tag: git tag v' + newVersion);
  console.log('3. Push to remote: git push origin main --tags');

} catch (error) {
  console.error('❌ Release preparation failed:', error.message);
  process.exit(1);
}
