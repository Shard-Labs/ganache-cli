// make sourcemaps work!
require('source-map-support').install();

module.exports = require("../ganache-core-celo/public-exports.js");
module.exports.version = require("../ganache-core-celo/package.json").version;
module.exports.to = require("../ganache-core-celo/lib/utils/to");
