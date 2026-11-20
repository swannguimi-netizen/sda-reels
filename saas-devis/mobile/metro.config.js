// Partage du code métier avec l'application web (calcul des totaux, statuts) : ../src/lib
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const config = getDefaultConfig(__dirname)
config.watchFolders = [path.resolve(__dirname, '../src/lib')]
module.exports = config
