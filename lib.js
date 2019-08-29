// make sourcemaps work!
require('source-map-support').install();

module.exports = require("@celo/ganache-core/public-exports.js");
module.exports.version = require("@celo/ganache-core/package.json").version;
module.exports.to = require("@celo/ganache-core/lib/utils/to");
