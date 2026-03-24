import { EventEmitter } from 'events';
import { type SocialProvider, type SocialPost } from './providers';
import logger from './logger';

// ── Search queries for supplementary discovery ──────────────

const MEMECOIN_QUERIES = [
  'dog viral min_faves:5000',
  'cat viral min_faves:5000',
  'animal escaped min_faves:3000',
  'corgi min_faves:5000',
  'capybara min_faves:3000',
  'frog meme min_faves:5000',
  'florida man min_faves:5000',
  '"gone viral" min_faves:10000',
  'elon musk min_faves:20000',
];

// ── Accounts to monitor ────────────────────────────────────

export const VIRAL_ACCOUNTS = [
  'Dexerto',
  'PopCrave',
  'unusual_whales',
  'cb_doge',
  'Culture_Crave',
  'DiscussingFilm',
  'IGN',
];

// ── Scoring ─────────────────────────────────────────────────

export interface MemeScore {
  total: number;
  viralScore: number;
  memeScore: number;
  freshnessScore: number;
  reasons: string[];
}

const MEME_KEYWORDS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  { pattern: /\b(dog|dogs|puppy|puppies|corgi|shiba|doge)\b/i, weight: 20, label: 'dog' },
  { pattern: /\b(cat|cats|kitten|kittens)\b/i, weight: 18, label: 'cat' },
  { pattern: /\b(frog|frogs|pepe)\b/i, weight: 18, label: 'frog' },
  { pattern: /\b(monkey|monkeys|ape|apes|chimp)\b/i, weight: 15, label: 'monkey' },
  { pattern: /\b(capybara|duck|ducks|penguin|penguins)\b/i, weight: 15, label: 'animal' },
  { pattern: /\b(bear|bears|bull|bulls)\b/i, weight: 12, label: 'market-animal' },
  { pattern: /\b(viral|gone viral|blowing up)\b/i, weight: 12, label: 'viral' },
  { pattern: /\b(florida man|bizarre|insane|unbelievable)\b/i, weight: 10, label: 'absurd' },
  { pattern: /\b(rescued|escaped|stolen|found)\b/i, weight: 8, label: 'narrative' },
  { pattern: /\b(hero|legend|goat|iconic)\b/i, weight: 10, label: 'hero' },
  { pattern: /\b(elon|musk|trump)\b/i, weight: 15, label: 'celebrity' },
  { pattern: /\b(meme|memes|lmao|lol)\b/i, weight: 8, label: 'meme' },
  { pattern: /\b(moon|to the moon|wagmi|lfg)\b/i, weight: 10, label: 'crypto-culture' },
  { pattern: /\b(wholesome|heartwarming|adorable|cute)\b/i, weight: 10, label: 'emotion' },
  { pattern: /\b(revenge|justice|karma)\b/i, weight: 8, label: 'justice' },
];

const BLACKLIST_PATTERNS = [
  /\b(death|died|killed|murder|shooting|suicide)\b/i,
  /\b(scam|rug pull|hack|exploit|drained)\b/i,
  /\b(war|bombing|terrorist|attack)\b/i,
  /\b(child abuse|trafficking)\b/i,
  /\b(sponsored|ad |#ad)\b/i,
];

// ── Scanner ─────────────────────────────────────────────────

export class MemecoinScanner extends EventEmitter {
  private providers: SocialProvider[] = [];
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private seenPostIds = new Set<string>();
  private launchedPostIds = new Set<string>();
  private scanIntervalMs: number;

  constructor(opts?: { scanIntervalMs?: number }) {
    super();
    this.scanIntervalMs = opts?.scanIntervalMs ?? 60_000;
  }

  /** Register a social media provider. */
  addProvider(provider: SocialProvider): void {
    this.providers.push(provider);
    provider.on('post', (post: SocialPost) => {
      this.evaluatePost(post);
    });
    logger.info(`Scanner: added provider "${provider.name}"`);
  }

  scoreTweet(post: SocialPost): MemeScore {
    const reasons: string[] = [];

    for (const bl of BLACKLIST_PATTERNS) {
      if (bl.test(post.text)) {
        return { total: 0, viralScore: 0, memeScore: 0, freshnessScore: 0, reasons: ['blacklisted'] };
      }
    }

    // Viral score (0-35)
    let viralScore = 0;
    const { likes, shares, views, bookmarks } = post.metrics;

    if (views > 10_000_000) { viralScore += 35; reasons.push(`${(views / 1e6).toFixed(1)}M views`); }
    else if (views > 1_000_000) { viralScore += 25; reasons.push(`${(views / 1e6).toFixed(1)}M views`); }
    else if (views > 100_000) { viralScore += 15; reasons.push(`${(views / 1e3).toFixed(0)}K views`); }
    else if (views > 10_000) { viralScore += 5; }

    if (likes > 50_000) { viralScore = Math.min(35, viralScore + 10); reasons.push(`${(likes / 1e3).toFixed(0)}K likes`); }
    else if (likes > 10_000) { viralScore = Math.min(35, viralScore + 5); }

    if (shares > 10_000) { viralScore = Math.min(35, viralScore + 5); reasons.push(`${(shares / 1e3).toFixed(0)}K shares`); }
    if (bookmarks > 1000) { viralScore = Math.min(35, viralScore + 3); }

    // Meme score (0-45)
    let memeScore = 0;
    const matchedLabels = new Set<string>();
    for (const kw of MEME_KEYWORDS) {
      if (kw.pattern.test(post.text) && !matchedLabels.has(kw.label)) {
        memeScore += kw.weight;
        matchedLabels.add(kw.label);
        reasons.push(kw.label);
      }
    }
    memeScore = Math.min(45, memeScore);
    if (post.media.length > 0) { memeScore = Math.min(45, memeScore + 5); reasons.push('has-media'); }

    // Freshness score (0-20)
    let freshnessScore = 0;
    if (post.createdAt) {
      const ageHours = (Date.now() - new Date(post.createdAt).getTime()) / 3_600_000;
      if (ageHours < 1) { freshnessScore = 20; reasons.push('< 1hr old'); }
      else if (ageHours < 3) { freshnessScore = 15; }
      else if (ageHours < 6) { freshnessScore = 10; }
      else if (ageHours < 12) { freshnessScore = 5; }
    }

    return { total: viralScore + memeScore + freshnessScore, viralScore, memeScore, freshnessScore, reasons };
  }

  async start(): Promise<void> {
    logger.info('MemecoinScanner starting...');

    // Start all providers
    for (const provider of this.providers) {
      await provider.start();
    }

    // Run supplementary search scans
    await this.runSearchScan();
    this.scanTimer = setInterval(() => this.runSearchScan(), this.scanIntervalMs);

    logger.info(`MemecoinScanner running — ${this.providers.length} provider(s), ${MEMECOIN_QUERIES.length} search queries`);
  }

  stop(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    for (const provider of this.providers) {
      provider.stop();
    }
    logger.info('MemecoinScanner stopped');
  }

  private evaluatePost(post: SocialPost): void {
    const key = `${post.platform}:${post.id}`;
    if (this.seenPostIds.has(key)) return;
    this.seenPostIds.add(key);

    if (this.seenPostIds.size > 10_000) {
      this.seenPostIds = new Set(Array.from(this.seenPostIds).slice(5_000));
    }

    const score = this.scoreTweet(post);

    if (score.total >= 40) {
      logger.info(
        `[CANDIDATE] ${score.total}/100 [${post.platform}] @${post.author.username}: "${post.text.slice(0, 80)}..."`,
      );
      logger.info(`  viral=${score.viralScore} meme=${score.memeScore} fresh=${score.freshnessScore} | ${score.reasons.join(', ')}`);
      this.emit('candidate', { post, score });
    }

    if (score.total >= 65 && !this.launchedPostIds.has(key)) {
      this.launchedPostIds.add(key);
      logger.info(`[LAUNCH] ${score.total}/100 [${post.platform}] @${post.author.username}`);
      this.emit('launch', { post, score });
    }
  }

  private async runSearchScan(): Promise<void> {
    for (const provider of this.providers) {
      for (const query of MEMECOIN_QUERIES) {
        try {
          const posts = await provider.search(query, 10);
          for (const post of posts) {
            this.evaluatePost(post);
          }
        } catch (err: any) {
          logger.error(`Search error [${provider.name}] "${query}":`, err);
        }
      }
    }
  }
}

export { MEMECOIN_QUERIES };
