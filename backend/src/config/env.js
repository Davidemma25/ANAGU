import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: ['.env.local', '.env'] });

const runtimeDevSecret = process.env.VERCEL
  ? crypto
      .createHash('sha256')
      .update(
        process.env.VERCEL_PROJECT_PRODUCTION_URL || 'anagu-vercel-preview-session-key'
      )
      .digest('hex')
  : crypto.randomBytes(32).toString('hex');

export const env = {
  port: Number(process.env.PORT || process.env.ANAGU_DEV_PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret:
    process.env.JWT_SECRET && process.env.JWT_SECRET !== 'CHANGE_ME_TO_A_LONG_RANDOM_SECRET'
      ? process.env.JWT_SECRET
      : runtimeDevSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  pg: {
    enabled: process.env.PG_ENABLED === 'true',
    host: process.env.PG_HOST || 'localhost',
    port: Number(process.env.PG_PORT || 5432),
    database: process.env.PG_DATABASE || 'anagu_db',
    user: process.env.PG_USER || 'anagu_app',
    password: process.env.PG_PASSWORD || '',
  },
  blockchain: {
    rpcUrl:
      process.env.POLYGON_AMOY_RPC_URL ||
      process.env.POLYGON_RPC_URL ||
      process.env.BLOCKCHAIN_RPC_URL ||
      'http://127.0.0.1:8545',
    contractAddress: process.env.ANAGU_CONTRACT_ADDRESS || '',
    escrowAddress: process.env.ANAGU_ESCROW_ADDRESS || '',
    tokenAddress: process.env.ANAGU_TOKEN_ADDRESS || '',
    chainId: Number(process.env.POLYGON_CHAIN_ID || 80002),
    explorerBaseUrl: process.env.POLYGON_AMOY_EXPLORER_URL || 'https://amoy.polygonscan.com',
    strictOnChainMode: process.env.ONCHAIN_STRICT_MODE === 'true',
  },
  ethereumPayment: {
    network: process.env.PAYMENT_NETWORK || 'sepolia',
    chainId: Number(process.env.SEPOLIA_CHAIN_ID || 11155111),
    rpcUrl:
      process.env.PAYMENT_RPC_URL ||
      process.env.SEPOLIA_RPC_URL ||
      'https://ethereum-sepolia-rpc.publicnode.com',
    contractAddress: process.env.ANAGU_PAYMENT_CONTRACT_ADDRESS || '',
    etherscanBaseUrl: process.env.SEPOLIA_ETHERSCAN_URL || 'https://sepolia.etherscan.io',
    testFeeNgn: Number(process.env.REGISTRATION_FEE_TEST_NGN || 15000),
    ethNgnExchangeRate: Number(process.env.ETH_NGN_EXCHANGE_RATE || 4500000),
    rateSource: process.env.ETH_NGN_RATE_SOURCE || 'CONFIGURABLE_TEST_RATE',
    quoteTtlSeconds: Number(process.env.PAYMENT_QUOTE_TTL_SECONDS || 900),
    requiredConfirmations: Number(process.env.PAYMENT_REQUIRED_CONFIRMATIONS || 1),
    quoteSignerPrivateKey: process.env.PAYMENT_QUOTE_SIGNER_PRIVATE_KEY || '',
  },
  token: {
    // 1 ANAGU = $1 USD by default (configurable via USD_PER_ANAGU env var)
    usdPerAnagu: Number(process.env.USD_PER_ANAGU || 1),
  },
  admin: {
    email: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD || '',
    fullName: process.env.ADMIN_FULL_NAME || 'ANAGU Administrator',
  },
  mqtt: {
    brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883',
    useEmbeddedBroker: process.env.MQTT_USE_EMBEDDED_BROKER !== 'false',
  },
  supabase: {
    enabled:
      process.env.SUPABASE_ENABLED !== 'false' &&
      Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY),
    url: (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''),
    publishableKey: (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim(),
    secretKey: (process.env.SUPABASE_SECRET_KEY || '').trim(),
    authRedirectUrl:
      (process.env.SUPABASE_AUTH_REDIRECT_URL ||
        (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000/auth/callback'))
        .trim(),
    jwksUrl: (
      process.env.SUPABASE_JWKS_URL ||
      (process.env.SUPABASE_URL
        ? `${process.env.SUPABASE_URL.trim().replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`
        : '')
    ).trim(),
  },
};

export function getAdminEmail() {
  return (process.env.ADMIN_EMAIL || env.admin.email || '').trim().toLowerCase();
}

export function isDesignatedAdminEmail(email) {
  if (!email) return false;
  return String(email).trim().toLowerCase() === getAdminEmail();
}
