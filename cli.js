#!/usr/bin/env node

var tmp = require('tmp');
tmp.setGracefulCleanup();

var path = require('path');

const MNEMONIC = 'concert load couple harbor equip island argue ramp clarify fence smart topic';

// make sourcemaps work!
require('source-map-support').install();

var yargs = require('yargs');
var pkg = require('./package.json');
var ContractKit = require('@celo/contractkit');
var { toChecksumAddress, BN } = require('ethereumjs-util');
var ganache;
try {
  ganache = require('./lib');
} catch (e) {
  ganache = require('./build/ganache-core.node.cli.js');
}
var to = ganache.to;
var URL = require('url');
var fs = require('fs-extra');
var initArgs = require('./args');

var detailedVersion = 'Ganache CLI v' + pkg.version + ' (ganache-core: ' + ganache.version + ')';

var isDocker = 'DOCKER' in process.env && process.env.DOCKER.toLowerCase() === 'true';
var argv = initArgs(yargs, detailedVersion, isDocker).argv;

var targz = require('targz');
var death = require('death');

function parseAccounts(accounts) {
  function splitAccount(account) {
    account = account.split(',');
    return {
      secretKey: account[0],
      balance: account[1],
    };
  }

  if (typeof accounts === 'string') return [splitAccount(accounts)];
  else if (!Array.isArray(accounts)) return;

  var ret = [];
  for (var i = 0; i < accounts.length; i++) {
    ret.push(splitAccount(accounts[i]));
  }
  return ret;
}

if (argv.d) {
  argv.s = 'TestRPC is awesome!'; // Seed phrase; don't change to Ganache, maintain original determinism
}

if (typeof argv.unlock == 'string') {
  argv.unlock = [argv.unlock];
}

var logger = console;

// If quiet argument passed, no output
if (argv.q === true) {
  logger = {
    log: function () {},
  };
}

// If the mem argument is passed, only show memory output,
// not transaction history.
if (argv.mem === true) {
  logger = {
    log: function () {},
  };

  setInterval(function () {
    console.log(process.memoryUsage());
  }, 1000);
}

var options = {
  port: argv.p,
  hostname: argv.h,
  debug: argv.debug,
  seed: argv.s,
  mnemonic: argv.m || MNEMONIC,
  total_accounts: argv.a,
  default_balance_ether: argv.e,
  blockTime: argv.b,
  gasPrice: argv.g,
  gasPriceFeeCurrencyRatio: argv.gpfcr,
  gasLimit: argv.l,
  callGasLimit: argv.callGasLimit,
  accounts: parseAccounts(argv.account),
  unlocked_accounts: argv.unlock,
  fork: argv.f,
  forkCacheSize: argv.forkCacheSize,
  hardfork: argv.k,
  network_id: argv.i,
  verbose: argv.v,
  secure: argv.n,
  db_path: argv.db,
  db_path_tar: argv.db_tar,
  hd_path: argv.hdPath,
  account_keys_path: argv.account_keys_path,
  vmErrorsOnRPCResponse: !argv.noVMErrorsOnRPCResponse,
  logger: logger,
  allowUnlimitedContractSize: argv.allowUnlimitedContractSize,
  useExperimentalOpcodes: argv.useExperimentalOpcodes,
  minimumGasPrice: argv.minimumGasPrice,
  time: argv.t,
  keepAliveTimeout: argv.keepAliveTimeout,
  _chainId: argv.chainId,
  // gross!
  _chainIdRpc: argv.chainId,
};

async function startGanache() {
  // db_path_tar is set to 'devchain.tar.gz' by default. Running the devchain from this tar file will include all of the Celo contracts.
  if (options.db_path_tar) {
    await runDevChainFromTar(options.db_path_tar);
  }
  var server = ganache.server(options);
  server.listen(options.port, options.hostname, startedGanache);
}
startGanache();
console.log(detailedVersion);

let started = false;
process.on('uncaughtException', function (e) {
  if (started) {
    console.log(e);
  } else {
    console.log(e.stack);
  }
  process.exit(1);
});

// See http://stackoverflow.com/questions/10021373/what-is-the-windows-equivalent-of-process-onsigint-in-node-js
if (process.platform === 'win32') {
  require('readline')
    .createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    .on('SIGINT', function () {
      process.emit('SIGINT');
    });
}

const closeHandler = function () {
  // graceful shutdown
  server.close(function (err) {
    if (err) {
      // https://nodejs.org/api/process.html#process_process_exit_code
      // writes to process.stdout in Node.js are sometimes asynchronous and may occur over
      // multiple ticks of the Node.js event loop. Calling process.exit(), however, forces
      // the process to exit before those additional writes to stdout can be performed.
      if (process.stdout._handle) process.stdout._handle.setBlocking(true);
      console.log(err.stack || err);
      process.exit();
    } else {
      process.exit(0);
    }
  });
};

process.on('SIGINT', closeHandler);
process.on('SIGTERM', closeHandler);
process.on('SIGHUP', closeHandler);

async function startedGanache(err, result) {
  if (err) {
    console.log(err);
    return;
  }
  started = true;
  var state = result ? result : server.provider.manager.state;

  var accounts = state.accounts;
  var addresses = Object.keys(accounts);
  var ethInWei = new BN('1000000000000000000');

  // Celo protocol contracts import
  // ContractKit was added to get cGLD and cUSD balance
  const kit = ContractKit.newKit(`http://${options.hostname}:${options.port}`);
  const goldtoken = await kit.contracts.getGoldToken();
  const stabletoken = await kit.contracts.getStableToken();
  var balancesArray = [];
  let index = 1;
  for (const address of addresses) {
    var celoBalance = await goldtoken.balanceOf(address);
    var cUSDBalance = await stabletoken.balanceOf(address);
    var balance = new BN(accounts[address].account.balance);
    var strBalanceCelo = celoBalance.dividedToIntegerBy(ethInWei);
    var strBalanceCUSD = cUSDBalance.dividedToIntegerBy(ethInWei);
    var about = balance.mod(ethInWei).isZero() ? '' : '~';
    var line = `(${index}) ${toChecksumAddress(
      address
    )} (${about}${strBalanceCelo} CELO), (${about}${strBalanceCUSD} cUSD)`;
    index++;
    if (state.isUnlocked(address) == false) {
      line += ' 🔒';
    }
    balancesArray.push(line);
  }

  console.log('');
  console.log('Available Accounts');
  console.log('==================');

  balancesArray.forEach(function (line, index) {
    console.log(line);
  });

  console.log('');
  console.log('Private Keys');
  console.log('==================');

  addresses.forEach(function (address, index) {
    console.log(`(${index+1}) 0x${accounts[address].secretKey.toString('hex')}`);
  });

  if (options.account_keys_path != null) {
    console.log('');
    console.log('Accounts and keys saved to ' + options.account_keys_path);
  }

  if (options.accounts == null) {
    console.log('');
    console.log('HD Wallet');
    console.log('==================');
    console.log('Mnemonic:      ' + state.mnemonic);
    console.log('Base HD Path:  ' + state.wallet_hdpath + '{account_index}');
  }

  if (options.gasPrice) {
    console.log('');
    console.log('Gas Price');
    console.log('==================');
    console.log(options.gasPrice);
    if (options.gasPriceFeeCurrencyRatio) {
      console.log('');
      console.log('Gas Price for Non-Native Fee Currency');
      console.log('==================');
      console.log(options.gasPriceFeeCurrencyRatio * options.gasPrice);
    }
  }

  if (options.gasLimit) {
    console.log('');
    console.log('Gas Limit');
    console.log('==================');
    console.log(options.gasLimit);
  }

  if (options.callGasLimit) {
    console.log('');
    console.log('Call Gas Limit');
    console.log('==================');
    console.log(options.callGasLimit);
  }

  if (options.fork) {
    console.log('');
    console.log('Forked Chain');
    console.log('==================');
    console.log('Location:       ' + state.blockchain.options.fork);
    console.log('Block:          ' + to.number(state.blockchain.forkBlockNumber));
    console.log('Network ID:     ' + state.net_version);
    console.log('Time:           ' + (state.blockchain.startTime || new Date()).toString());
    let maxCacheSize;
    if (options.forkCacheSize === -1) {
      maxCacheSize = '∞';
    } else {
      maxCacheSize = options.forkCacheSize + ' bytes';
    }
    console.log('Max Cache Size: ' + maxCacheSize);
  }

  console.log('');
  console.log('Listening on ' + options.hostname + ':' + options.port);
}

// Decompress a given tar.gz chain add the path to 'options.db_path'
async function runDevChainFromTar(filename) {
  const chainCopy = tmp.dirSync({ keep: false, unsafeCleanup: true });

  function decompressChain(tarPath, copyChainPath) {
    return new Promise((resolve, reject) => {
      targz.decompress({ src: tarPath, dest: copyChainPath }, (err) => {
        if (err) {
          console.error(err);
          reject(err);
        } else {
          console.log('Chain decompressed');
          resolve();
        }
      });
    });
  }

  await decompressChain(options.db_path_tar, chainCopy.name);
  options.db_path = chainCopy.name;
}

// Compress a chain into a tar.gz file and save it in project's root folder
async function compressChain(chainPath, filename) {
  console.log('Compressing chain');

  return new Promise((resolve, reject) => {
    // ensures the path to the file
    fs.ensureFileSync(filename);

    targz.compress({ src: chainPath, dest: filename }, async (err) => {
      if (err) {
        console.error(err);
        reject(err);
      } else {
        console.log('Chain compressed');
        resolve();
      }
    });
  });
}
