import { Connection, Keypair, Transaction, sendAndConfirmTransaction, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  PumpSdk,
  OnlinePumpSdk,
  getBuyTokenAmountFromSolAmount,
  getSellSolAmountFromTokenAmount,
} from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import bs58 from 'bs58';
import logger from './logger';
import type { SocialPost } from './providers';

export interface PumpLaunchConfig {
  rpcUrl: string;
  privateKey: string;
  initialBuySol?: number;
}

export interface TokenParams {
  name: string;
  symbol: string;
  uri: string;
  imageUrl?: string;
  twitter?: string;
  website?: string;
}

export class PumpLauncher {
  private connection: Connection;
  private wallet: Keypair | null;
  private offlineSdk: PumpSdk;
  private onlineSdk: OnlinePumpSdk;
  private dryRun: boolean;

  constructor(private config: PumpLaunchConfig) {
    if (!config.rpcUrl) throw new Error('rpcUrl is required');

    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.offlineSdk = new PumpSdk();
    this.onlineSdk = new OnlinePumpSdk(this.connection);

    if (config.privateKey) {
      this.wallet = Keypair.fromSecretKey(bs58.decode(config.privateKey));
      this.dryRun = false;
      logger.info(`PumpLauncher initialized — wallet: ${this.wallet.publicKey.toBase58()}`);
    } else {
      this.wallet = null;
      this.dryRun = true;
      logger.warn('PumpLauncher in DRY-RUN mode (no SOLANA_PRIVATE_KEY set)');
    }
  }

  deriveTokenParams(post: SocialPost): TokenParams {
    const text = post.text;
    let name: string;
    let symbol: string;

    if (post.hashtags.length > 0) {
      name = post.hashtags[0];
      symbol = post.hashtags[0].slice(0, 6).toUpperCase();
    } else {
      const words = text.split(/\s+/).filter((w) => w.length > 1);
      const capWords = words.filter((w) => /^[A-Z]/.test(w) && !/^(RT|@|http)/.test(w));
      name = capWords.length >= 2
        ? capWords.slice(0, 3).join(' ')
        : words.slice(0, 3).join(' ');
      symbol = name.replace(/[^A-Za-z]/g, '').slice(0, 6).toUpperCase();
    }

    const twitterUrl = post.platform === 'twitter'
      ? `https://x.com/${post.author.username}/status/${post.id}`
      : undefined;

    return {
      name,
      symbol,
      uri: '', // TODO: upload metadata to IPFS
      twitter: twitterUrl,
    };
  }

  async launchToken(params: TokenParams): Promise<{ mint: string; txSignature: string }> {
    if (this.dryRun || !this.wallet) {
      const fakeMint = Keypair.generate().publicKey.toBase58();
      logger.info(`[DRY-RUN] Would launch: ${params.name} (${params.symbol}) — mint: ${fakeMint}`);
      return { mint: fakeMint, txSignature: 'dry-run' };
    }

    logger.info(`Launching token: ${params.name} (${params.symbol})`);

    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey;
    const creator = this.wallet.publicKey;
    const solAmount = new BN((this.config.initialBuySol ?? 0.01) * 1e9);

    const global = await this.onlineSdk.fetchGlobal();
    const feeConfig = await this.onlineSdk.fetchFeeConfig();

    const buyAmount = getBuyTokenAmountFromSolAmount({
      global, feeConfig, mintSupply: null, bondingCurve: null, amount: solAmount,
    });

    const instructions = await this.offlineSdk.createV2AndBuyInstructions({
      global, mint, name: params.name, symbol: params.symbol, uri: params.uri,
      creator, user: creator, solAmount, amount: buyAmount, mayhemMode: false,
    });

    const tx = new Transaction().add(...instructions);
    const txSignature = await sendAndConfirmTransaction(this.connection, tx, [this.wallet, mintKeypair]);

    logger.info(`Token launched! Mint: ${mint.toBase58()}, TX: ${txSignature}`);
    return { mint: mint.toBase58(), txSignature };
  }

  async buyToken(mintAddress: string, solAmount: number): Promise<string> {
    if (!this.wallet) throw new Error('Cannot buy in dry-run mode');
    const mint = new PublicKey(mintAddress);
    const user = this.wallet.publicKey;
    const lamports = new BN(solAmount * 1e9);

    const global = await this.onlineSdk.fetchGlobal();
    const feeConfig = await this.onlineSdk.fetchFeeConfig();
    const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } =
      await this.onlineSdk.fetchBuyState(mint, user);

    const instructions = await this.offlineSdk.buyInstructions({
      global, bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo, mint, user,
      solAmount: lamports,
      amount: getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve, amount: lamports }),
      slippage: 1, tokenProgram: TOKEN_PROGRAM_ID,
    });

    const tx = new Transaction().add(...instructions);
    const sig = await sendAndConfirmTransaction(this.connection, tx, [this.wallet]);
    logger.info(`Bought ${mintAddress}, TX: ${sig}`);
    return sig;
  }

  async sellToken(mintAddress: string, tokenAmount: number): Promise<string> {
    if (!this.wallet) throw new Error('Cannot sell in dry-run mode');
    const mint = new PublicKey(mintAddress);
    const user = this.wallet.publicKey;
    const amount = new BN(tokenAmount);

    const global = await this.onlineSdk.fetchGlobal();
    const feeConfig = await this.onlineSdk.fetchFeeConfig();
    const { bondingCurveAccountInfo, bondingCurve } = await this.onlineSdk.fetchSellState(mint, user);

    const instructions = await this.offlineSdk.sellInstructions({
      global, bondingCurveAccountInfo, bondingCurve, mint, user, amount,
      solAmount: getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply: bondingCurve.tokenTotalSupply, bondingCurve, amount }),
      slippage: 1, tokenProgram: TOKEN_PROGRAM_ID, mayhemMode: false,
    });

    const tx = new Transaction().add(...instructions);
    const sig = await sendAndConfirmTransaction(this.connection, tx, [this.wallet]);
    logger.info(`Sold ${mintAddress}, TX: ${sig}`);
    return sig;
  }
}
