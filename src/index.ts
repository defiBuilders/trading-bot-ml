import dotenv from 'dotenv';
import logger from './logger';
import { TwitterProvider } from './providers';
import { type SocialPost } from './providers';
import { PumpLauncher } from './pump-launcher';
import { MemecoinScanner, VIRAL_ACCOUNTS, type MemeScore } from './memecoin-scanner';

dotenv.config();

async function main() {
  logger.info('Starting memecoin scanner bot');

  // ── Twitter provider ──────────────────────────────────────
  const twitterUser = process.env.TWITTER_USERNAME;
  const twitterPass = process.env.TWITTER_PASSWORD;
  if (!twitterUser || !twitterPass) {
    logger.error('TWITTER_USERNAME and TWITTER_PASSWORD required');
    process.exit(1);
  }

  const twitter = new TwitterProvider({
    username: twitterUser,
    password: twitterPass,
    email: process.env.TWITTER_EMAIL,
    cookiesJson: process.env.TWITTER_COOKIES,
    proxyUrl: process.env.PROXY_URL,
    accounts: VIRAL_ACCOUNTS,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? '10000'),
  });

  // ── Pump launcher ────────────────────────────────────────
  const launcher = new PumpLauncher({
    rpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
    privateKey: process.env.SOLANA_PRIVATE_KEY ?? '',
    initialBuySol: Number(process.env.INITIAL_BUY_SOL ?? '0.01'),
  });

  // ── Scanner ──────────────────────────────────────────────
  const scanner = new MemecoinScanner({
    scanIntervalMs: Number(process.env.SCAN_INTERVAL_MS ?? '60000'),
  });

  scanner.addProvider(twitter);
  // scanner.addProvider(instagramProvider); // future
  // scanner.addProvider(tiktokProvider);    // future

  scanner.on('candidate', ({ post, score }: { post: SocialPost; score: MemeScore }) => {
    logger.info(`[CANDIDATE] ${score.total}/100 [${post.platform}] @${post.author.username}: ${post.text.slice(0, 100)}`);
  });

  scanner.on('launch', async ({ post, score }: { post: SocialPost; score: MemeScore }) => {
    logger.info(`[LAUNCH] ${score.total}/100 [${post.platform}] @${post.author.username}`);
    const params = launcher.deriveTokenParams(post);
    logger.info(`Token: ${params.name} (${params.symbol})`);

    try {
      const result = await launcher.launchToken(params);
      logger.info(`Launched! Mint: ${result.mint} TX: ${result.txSignature}`);
    } catch (err) {
      logger.error('Launch failed:', err);
    }
  });

  await scanner.start();
  logger.info('Bot running. Ctrl+C to stop.');

  process.on('SIGINT', () => {
    scanner.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error('Fatal', err);
  process.exit(1);
});
