#!/usr/bin/env node

var tmp = require('tmp');
tmp.setGracefulCleanup();

var path = require('path');

const gasLimit = 20000000;
const MNEMONIC = 'concert load couple harbor equip island argue ramp clarify fence smart topic';

// make sourcemaps work!
require('source-map-support').install();

var yargs = require('yargs');
var pkg = require('./package.json');
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
  mnemonic: argv.m,
  total_accounts: argv.a,
  default_balance_ether: argv.e,
  blockTime: argv.b,
  gasPrice: argv.g,
  gasPriceFeeCurrencyRatio: argv.gpfcr,
  gasLimit: argv.l,
  accounts: parseAccounts(argv.account),
  unlocked_accounts: argv.unlock,
  fork: argv.f,
  hardfork: argv.k,
  network_id: argv.i,
  verbose: argv.v,
  secure: argv.n,
  db_path: argv.db,
  db_path_tar: argv.db_tar,
  account_keys_path: argv.account_keys_path,
  vmErrorsOnRPCResponse: !argv.noVMErrorsOnRPCResponse,
  logger: logger,
  allowUnlimitedContractSize: argv.allowUnlimitedContractSize,
  time: argv.t,
  keepAliveTimeout: argv.keepAliveTimeout,
};

var fork_address;

// If we're forking from another client, don't try to use the same port.
if (options.fork) {
  var split = options.fork.split('@');
  fork_address = split[0];
  var block;
  if (split.length > 1) {
    block = split[1];
  }

  if (URL.parse(fork_address).port == options.port) {
    options.port = parseInt(options.port) + 1;
  }

  options.fork = fork_address + (block != null ? '@' + block : '');
}

// Before starting ganache load from tar file

(async () => {
  try {
    if (options.db_path_tar) {
      await runDevChainFromTar(options.db_path_tar);
    }

    var server = ganache.server(options);

    console.log(detailedVersion);

    server.listen(options.port, options.hostname, function (err, result) {
      if (err) {
        console.log(err);
        return;
      }

      var state = result ? result : server.provider.manager.state;

      console.log('');
      console.log('Available Accounts');
      console.log('==================');

      var accounts = state.accounts;
      var addresses = Object.keys(accounts);
      var ethInWei = new BN('1000000000000000000');

      addresses.forEach(function (address, index) {
        var balance = new BN(accounts[address].account.balance);
        var strBalance = balance.divRound(ethInWei).toString();
        var about = balance.mod(ethInWei).isZero() ? '' : '~';
        var line = `(${index}) ${toChecksumAddress(address)} (${about}${strBalance} CELO)`;

        if (state.isUnlocked(address) == false) {
          line += ' 🔒';
        }

        console.log(line);
      });

      console.log('');
      console.log('Private Keys');
      console.log('==================');

      addresses.forEach(function (address, index) {
        console.log('(' + index + ') ' + '0x' + accounts[address].secretKey.toString('hex'));
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

      if (options.fork) {
        console.log('');
        console.log('Forked Chain');
        console.log('==================');
        console.log('Location:    ' + fork_address);
        console.log('Block:       ' + to.number(state.blockchain.fork_block_number));
        console.log('Network ID:  ' + state.net_version);
        console.log('Time:        ' + (state.blockchain.startTime || new Date()).toString());
      }

      console.log('');
      console.log('Listening on ' + options.hostname + ':' + options.port);
    });

    process.on('uncaughtException', function (e) {
      console.log(e.stack);
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

    // process.on('exit', async function () {
    //   console.log('CLOSING');
    //   await compressChain(options.db_path, path.dirname(require.main.filename) + '/devchain2.tar.gz');
    //   console.log('finished');
    // });

    // death(function (signal, err) {
    //   console.log(signal);
    //   console.log(err);
    //   console.log('CLOSING');
    //   await compressChain(options.db_path, path.dirname(require.main.filename) + '/devchain2.tar.gz');

    //   // graceful shutdown
    //   server.close(function (err) {
    //     if (err) {
    //       console.log(err.stack || err);
    //     }
    //     process.exit();
    //   });
    // });

    process.on('SIGINT', async function () {
      console.log('CLOSING');
      await compressChain(options.db_path, path.dirname(require.main.filename) + '/devchain2.tar.gz');

      // graceful shutdown
      server.close(function (err) {
        if (err) {
          console.log(err.stack || err);
        }
        process.exit();
      });
    });
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();

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

// -----------------------------------------------------------

// async function startGanache(
//   datadir,
//   opts,
//   chainCopy
// ) {
//   const logFn = opts.verbose
//     ? // tslint:disable-next-line: no-console
//       (...args) => console.log(...args)
//     : () => {
//         /*nothing*/
//       }

//   const server = ganache.server({
//     default_balance_ether: 200000000,
//     logger: {
//       log: logFn,
//     },
//     network_id: 1101,
//     db_path: datadir,
//     mnemonic: MNEMONIC,
//     gasLimit,
//     allowUnlimitedContractSize: true,
//   })

//   await new Promise((resolve, reject) => {
//     server.listen(8545, (err, blockchain) => {
//       if (err) {
//         reject(err)
//       } else {
//         // tslint:disable-next-line: no-console
//         console.log(chalk.red('Ganache STARTED'))
//         // console.log(blockchain)
//         resolve(blockchain)
//       }
//     })
//   })

//   return () =>
//     new Promise((resolve, reject) => {
//       server.close((err) => {
//         if (chainCopy) {
//           chainCopy.removeCallback()
//         }
//         if (err) {
//           reject(err)
//         } else {
//           resolve()
//         }
//       })
//     })
// }

// export function execCmd(
//   cmd,
//   args,
//   options
// ) {
//   return new Promise(async (resolve, reject) => {
//     const { silent, ...spawnOptions } = options || { silent: false }
//     if (!silent) {
//       console.debug('$ ' + [cmd].concat(args).join(' '))
//     }
//     const process = spawn(cmd, args, {
//       ...spawnOptions,
//       stdio: silent ? 'ignore' : 'inherit',
//     })
//     process.on('close', (code) => {
//       try {
//         resolve(code)
//       } catch (error) {
//         reject(error)
//       }
//     })
//   })
// }

// function exitOnError(p) {
//   p.catch((err) => {
//     console.error(`Command Failed`)
//     console.error(err)
//     process.exit(1)
//   })
// }

// async function resetDir(dir, silent) {
//   if (fs.existsSync(dir)) {
//     await execCmd('rm', ['-rf', dir], { silent })
//   }
// }
// function createDirIfMissing(dir) {
//   if (!fs.existsSync(dir)) {
//     fs.mkdirSync(dir)
//   }
// }

// function runMigrations(opts = {}) {
//   const cmdArgs = ['truffle', 'migrate', '--reset', '--network', 'development']

//   if (opts.upto) {
//     cmdArgs.push('--to')
//     cmdArgs.push(opts.upto.toString())
//   }

//   if (opts.migrationOverride) {
//     cmdArgs.push('--migration_override')
//     cmdArgs.push(fs.readFileSync(opts.migrationOverride).toString())
//   }
//   return execCmd(`yarn`, cmdArgs, { cwd: ProtocolRoot })
// }

// function deployReleaseGold(releaseGoldContracts) {
//   const cmdArgs = ['truffle', 'exec', 'scripts/truffle/deploy_release_contracts.js']
//   cmdArgs.push('--network')
//   // TODO(lucas): investigate if this can be found dynamically
//   cmdArgs.push('development')
//   cmdArgs.push('--from')
//   cmdArgs.push('0x5409ED021D9299bf6814279A6A1411A7e866A631')
//   cmdArgs.push('--grants')
//   cmdArgs.push(releaseGoldContracts)
//   cmdArgs.push('--start_gold')
//   cmdArgs.push('1')
//   cmdArgs.push('--deployed_grants')
//   // Random file name to prevent rewriting to it
//   cmdArgs.push('/tmp/deployedGrants' + Math.floor(1000 * Math.random()) + '.json')
//   cmdArgs.push('--output_file')
//   cmdArgs.push('/tmp/releaseGoldOutput.txt')
//   // --yesreally command to bypass prompts
//   cmdArgs.push('--yesreally')
//   cmdArgs.push('--build_directory')
//   cmdArgs.push(ProtocolRoot + 'build')

//   return execCmd(`yarn`, cmdArgs, { cwd: ProtocolRoot })
// }

// async function runDevChainFromTar(filename) {
//   const chainCopy = tmp.dirSync({ keep: false, unsafeCleanup: true })
//   // tslint:disable-next-line: no-console
//   console.log(`Creating tmp folder: ${chainCopy.name}`)

//   await decompressChain(filename, chainCopy.name)

//   const stopGanache = await startGanache(chainCopy.name, { verbose: true }, chainCopy)
//   return stopGanache
// }

// function decompressChain(tarPath, copyChainPath) {
//   // tslint:disable-next-line: no-console
//   console.log('Decompressing chain')
//   return new Promise((resolve, reject) => {
//     targz.decompress({ src: tarPath, dest: copyChainPath }, (err) => {
//       if (err) {
//         console.error(err)
//         reject(err)
//       } else {
//         // tslint:disable-next-line: no-console
//         console.log('Chain decompressed')
//         resolve()
//       }
//     })
//   })
// }

// async function runDevChain(
//   datadir,
//   opts = {}
// ) {
//   if (opts.reset) {
//     await resetDir(datadir)
//   }
//   createDirIfMissing(datadir)
//   const stopGanache = await startGanache(datadir, { verbose: true })
//   if (opts.reset || opts.runMigrations) {
//     const code = await runMigrations({ upto: opts.upto, migrationOverride: opts.migrationOverride })
//     if (code !== 0) {
//       throw Error('Migrations failed')
//     }
//   }
//   if (opts.releaseGoldContracts) {
//     const code = await deployReleaseGold(opts.releaseGoldContracts)
//     if (code !== 0) {
//       throw Error('ReleaseGold deployment failed')
//     }
//   }
//   return stopGanache
// }

// async function generateDevChain(
//   filePath,
//   opts = {}
// ) {
//   let chainPath = filePath
//   let chainTmp
//   if (opts.targz) {
//     chainTmp = tmp.dirSync({ keep: false, unsafeCleanup: true })
//     chainPath = chainTmp.name
//   } else {
//     fs.ensureDirSync(chainPath)
//   }
//   const stopGanache = await runDevChain(chainPath, {
//     reset: !opts.targz,
//     runMigrations: true,
//     upto: opts.upto,
//     migrationOverride: opts.migrationOverride,
//     releaseGoldContracts: opts.releaseGoldContracts,
//   })
//   await stopGanache()
//   if (opts.targz && chainTmp) {
//     await compressChain(chainPath, filePath)
//     chainTmp.removeCallback()
//   }
// }

// async function compressChain(chainPath, filename) {
//   // tslint:disable-next-line: no-console
//   console.log('Compressing chain')
//   return new Promise((resolve, reject) => {
//     // ensures the path to the file
//     fs.ensureFileSync(filename)
//     targz.compress({ src: chainPath, dest: filename }, async (err) => {
//       if (err) {
//         console.error(err)
//         reject(err)
//       } else {
//         // tslint:disable-next-line: no-console
//         console.log('Chain compressed')
//         resolve()
//       }
//     })
//   })
// }
