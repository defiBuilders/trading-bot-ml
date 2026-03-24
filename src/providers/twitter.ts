import { Scraper, SearchMode, type Tweet } from '@the-convocation/twitter-scraper';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { SocialProvider, type SocialPost, type ProviderConfig } from './types';
import logger from '../logger';

export interface TwitterConfig extends ProviderConfig {
  username: string;
  password: string;
  email?: string;
  /** Cached cookies JSON to skip login */
  cookiesJson?: string;
  /** HTTP(S) proxy URL e.g. http://user:pass@host:port */
  proxyUrl?: string;
}

export class TwitterProvider extends SocialProvider {
  readonly name = 'twitter';

  private scraper: Scraper;
  private config: TwitterConfig;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs: number;
  private lastSeenIds = new Map<string, string>(); // account -> last tweet id

  constructor(config: TwitterConfig) {
    super();
    this.config = config;
    if (config.proxyUrl) {
      const proxyAgent = new ProxyAgent(config.proxyUrl);
      this.scraper = new Scraper({
        fetch: ((input: any, init?: any) => {
          return undiciFetch(input, { ...init, dispatcher: proxyAgent });
        }) as any,
      });
      logger.info(`Twitter: using proxy ${config.proxyUrl.replace(/:[^:@]+@/, ':***@')}`);
    } else {
      this.scraper = new Scraper();
    }
    this.pollIntervalMs = config.pollIntervalMs ?? 10_000;
  }

  async start(): Promise<void> {
    // Restore cookies if available, otherwise login
    if (this.config.cookiesJson) {
      try {
        const cookies = JSON.parse(this.config.cookiesJson);
        await this.scraper.setCookies(cookies);
        if (await this.scraper.isLoggedIn()) {
          logger.info('Twitter: restored session from cookies');
        } else {
          await this.login();
        }
      } catch {
        await this.login();
      }
    } else {
      await this.login();
    }

    // Initialize watched accounts
    await this.addAccounts(this.config.accounts);

    // Start polling
    this.pollTimer = setInterval(() => this.pollAll(), this.pollIntervalMs);
    logger.info(`Twitter: polling ${this.lastSeenIds.size} accounts every ${this.pollIntervalMs / 1000}s`);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    await this.scraper.logout();
    logger.info('Twitter: stopped');
  }

  async addAccounts(accounts: string[]): Promise<void> {
    for (const username of accounts) {
      const cleaned = username.replace(/^@/, '');
      if (this.lastSeenIds.has(cleaned)) continue;

      try {
        // Fetch the latest tweet to set the high-water mark
        const latest = await this.scraper.getLatestTweet(cleaned);
        this.lastSeenIds.set(cleaned, latest?.id ?? '0');
        logger.info(`Twitter: watching @${cleaned} (latest: ${latest?.id ?? 'none'})`);
      } catch (err) {
        logger.error(`Twitter: failed to init @${cleaned}:`, err);
        // Still add so we retry on next poll
        this.lastSeenIds.set(cleaned, '0');
      }
    }
  }

  async search(query: string, limit = 20): Promise<SocialPost[]> {
    const results: SocialPost[] = [];
    try {
      const tweets = this.scraper.searchTweets(query, limit, SearchMode.Latest);
      for await (const tweet of tweets) {
        results.push(this.tweetToPost(tweet));
        if (results.length >= limit) break;
      }
    } catch (err) {
      logger.error(`Twitter search error "${query}":`, err);
    }
    return results;
  }

  /** Get cookies for caching (save to .env or file). */
  async exportCookies(): Promise<string> {
    const cookies = await this.scraper.getCookies();
    return JSON.stringify(cookies);
  }

  // ── Private ───────────────────────────────────────────────

  private async login(): Promise<void> {
    logger.info(`Twitter: logging in as @${this.config.username}`);
    await this.scraper.login(
      this.config.username,
      this.config.password,
      this.config.email,
    );

    if (await this.scraper.isLoggedIn()) {
      logger.info('Twitter: login successful');
      // Log cookies so user can cache them
      const cookies = await this.exportCookies();
      logger.debug(`Twitter: cookies (save these): ${cookies}`);
    } else {
      throw new Error('Twitter login failed');
    }
  }

  private async pollAll(): Promise<void> {
    for (const [username, lastSeenId] of this.lastSeenIds.entries()) {
      try {
        const tweets: Tweet[] = [];
        const stream = this.scraper.getTweets(username, 5);
        for await (const tweet of stream) {
          if (!tweet.id) continue;
          // Stop at the high-water mark
          if (tweet.id === lastSeenId) break;
          // Only include tweets newer than our mark
          if (lastSeenId !== '0' && BigInt(tweet.id) <= BigInt(lastSeenId)) break;
          tweets.push(tweet);
        }

        if (tweets.length === 0) continue;

        // Update high-water mark to newest tweet
        this.lastSeenIds.set(username, tweets[0].id!);

        for (const tweet of tweets) {
          const post = this.tweetToPost(tweet);
          this.emit('post', post);
        }

        logger.info(`Twitter: @${username} — ${tweets.length} new tweet(s)`);
      } catch (err) {
        logger.error(`Twitter: poll error @${username}:`, err);
      }
    }
  }

  private tweetToPost(tweet: Tweet): SocialPost {
    const likes = tweet.likes ?? 0;
    const retweets = tweet.retweets ?? 0;
    const views = tweet.views ?? 0;

    return {
      id: tweet.id ?? '',
      platform: 'twitter',
      text: tweet.text ?? '',
      author: {
        id: tweet.userId ?? '',
        username: tweet.username ?? '',
        displayName: tweet.name ?? '',
      },
      metrics: {
        likes,
        shares: retweets,
        replies: tweet.replies ?? 0,
        views,
        bookmarks: tweet.bookmarkCount ?? 0,
      },
      media: [
        ...(tweet.photos ?? []).map((p) => ({ type: 'photo' as const, url: p.url })),
        ...(tweet.videos ?? []).map((v) => ({ type: 'video' as const, url: v.url ?? undefined })),
      ],
      hashtags: tweet.hashtags ?? [],
      urls: tweet.urls ?? [],
      createdAt: tweet.timeParsed?.toISOString() ?? '',
      rawData: tweet,
    };
  }
}
