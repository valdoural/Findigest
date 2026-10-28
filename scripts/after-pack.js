'use strict';
/**
 * Вшивает иконку и сведения о версии в FinDigest.exe без Wine (чистый JS, resedit).
 * Нужен при сборке Windows-установщика на Linux/macOS; на Windows тоже работает.
 */
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const R = ResEdit.default || ResEdit;
  const pkg = ctx.packager.appInfo;
  const exe = path.join(ctx.appOutDir, `${ctx.packager.platformSpecificBuildOptions.executableName || pkg.productFilename}.exe`);
  const data = fs.readFileSync(exe);
  const ex = R.NtExecutable.from(data, { ignoreCert: true });
  const res = R.NtExecutableResource.from(ex);

  const ico = R.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico')));
  R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, ico.icons.map(i => i.data));

  const v = pkg.version.split('.').map(n => parseInt(n, 10) || 0);
  const vi = R.Resource.VersionInfo.fromEntries(res.entries)[0] || R.Resource.VersionInfo.createEmpty();
  vi.setFileVersion(v[0], v[1], v[2], 0, 1033);
  vi.setProductVersion(v[0], v[1], v[2], 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'Финансовый дайджест',
    ProductName: 'Финансовый дайджест',
    CompanyName: 'Vlad Nikolaev',
    LegalCopyright: '© Vlad Nikolaev',
    OriginalFilename: path.basename(exe),
    InternalName: 'FinDigest',
    FileVersion: pkg.version,
    ProductVersion: pkg.version,
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(ex);
  fs.writeFileSync(exe, Buffer.from(ex.generate()));
  console.log('  • иконка и версия вшиты в', path.basename(exe));
};
