const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, 'package.json');
const commandsPath = path.join(__dirname, 'commands.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const commandsJson = JSON.parse(fs.readFileSync(commandsPath, 'utf8'));

// Merge configuration
pkg.contributes = pkg.contributes || {};
pkg.contributes.configuration = commandsJson.configuration;
pkg.contributes.commands = commandsJson.commands;

// Write back to package.json
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
console.log('Merged commands.json into package.json');
