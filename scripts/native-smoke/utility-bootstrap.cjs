// Preserve real utility-process IPC/entry; install OS guards before ESM linking.
require('./guard.cjs');
const { pathToFileURL } = require('node:url');
process.argv.splice(1, 1);
const entry = process.argv[1];
import(pathToFileURL(entry).href).catch(error => { console.error(error); process.exitCode = 1; });
