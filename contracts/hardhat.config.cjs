const path = require('node:path');
const { subtask } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('@nomicfoundation/hardhat-toolbox');

// Use locally installed npm solc (offline-safe & deterministic)
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async () => {
  const solc = require('solc');
  const fullVersion = solc.version();
  const shortVersion = fullVersion.split('+')[0];
  return {
    compilerPath: require.resolve('solc/soljson.js'),
    isSolcJs: true,
    version: shortVersion,
    longVersion: fullVersion,
  };
});

const SEPOLIA_PRIVATE_KEY =
  process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY || process.env.REGISTRAR_PRIVATE_KEY || '';

module.exports = {
  solidity: {
    version: '0.8.38',
    settings: {
      evmVersion: 'cancun',
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: path.join(__dirname, 'contracts'),
    tests: path.join(__dirname, 'test'),
    cache: path.join(__dirname, 'cache'),
    artifacts: path.join(__dirname, 'artifacts'),
  },
  networks: {
    hardhat: {
      chainId: 31337,
      hardfork: 'cancun',
    },
    localhost: {
      url: process.env.SEPOLIA_LOCAL_RPC_URL || process.env.POLYGON_RPC_URL || 'http://127.0.0.1:8545',
      chainId: 31337,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
      chainId: 11155111,
      accounts: SEPOLIA_PRIVATE_KEY ? [SEPOLIA_PRIVATE_KEY] : [],
    },
    polygonAmoy: {
      url:
        process.env.POLYGON_AMOY_RPC_URL ||
        process.env.POLYGON_RPC_URL ||
        'https://polygon-amoy-bor-rpc.publicnode.com',
      chainId: 80002,
      accounts: process.env.REGISTRAR_PRIVATE_KEY ? [process.env.REGISTRAR_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || '',
      polygonAmoy: process.env.POLYGONSCAN_API_KEY || '',
    },
    customChains: [
      {
        network: 'polygonAmoy',
        chainId: 80002,
        urls: {
          apiURL: 'https://api-amoy.polygonscan.com/api',
          browserURL: 'https://amoy.polygonscan.com',
        },
      },
    ],
  },
};
