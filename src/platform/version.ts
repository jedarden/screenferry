/**
 * Version information for ScreenFerry
 *
 * Provides semver version from package.json combined with git build hash
 * for the version footer (bf-13h)
 */

import packageJson from '../../package.json';

interface VersionInfo {
  version: string;
  buildHash: string;
  buildTime: string;
  fullVersion: string;
}

/**
 * Get complete version information including semver and build hash
 */
export function getVersionInfo(): VersionInfo {
  const version = packageJson.version;
  const buildHash = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev';
  const buildTime = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : new Date().toISOString();

  // Format: "0.1.0+47f869c" - semver with build metadata
  const fullVersion = `${version}+${buildHash}`;

  return {
    version,
    buildHash,
    buildTime,
    fullVersion,
  };
}

/**
 * Get HTML for version footer element
 */
export function getVersionFooterHTML(): string {
  const { version, buildHash, fullVersion } = getVersionInfo();

  return `
    <footer class="version-footer" style="
      margin-top: 2rem;
      padding: 1rem;
      border-top: 1px solid #333;
      font-size: 11px;
      color: #666;
      text-align: center;
    ">
      <div>
        <strong>ScreenFerry</strong> v${fullVersion}
      </div>
      <div style="margin-top: 0.25rem; font-size: 10px;">
        <a href="https://github.com/jedarden/screenferry" style="color: #666; text-decoration: none;" target="_blank" rel="noopener">
          github.com/jedarden/screenferry
        </a>
      </div>
    </footer>
  `;
}
