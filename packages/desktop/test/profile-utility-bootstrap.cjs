// Preserve real utility IPC and argv while installing the profile guard before ESM linking.
require('./profile-file-guard.cjs');
const { pathToFileURL } = require('node:url');
process.argv.splice(1, 1);
import(pathToFileURL(process.argv[1]).href).catch(error => { console.error(error); process.exitCode = 1; });
