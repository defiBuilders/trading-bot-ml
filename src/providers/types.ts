import { EventEmitter } from 'events';

/** Unified post format across all social platforms. */
export interface SocialPost {
  id: string;
  platform: string;
  text: string;
  author: {
    id: string;
    username: string;
    displayName: string;
  };
  metrics: {
    likes: number;
    shares: number;   // retweets, reposts, etc.
    replies: number;
    views: number;
    bookmarks: number;
  };
  media: Array<{ type: string; url?: string }>;
  hashtags: string[];
  urls: string[];
  createdAt: string;
  rawData?: any;
}

export interface ProviderConfig {
  /** Polling interval in ms for providers that poll (default: 10s) */
  pollIntervalMs?: number;
  /** Accounts to monitor */
  accounts: string[];
}

/**
 * Base interface for all social media providers.
 * Each provider is an EventEmitter that emits 'post' events.
 */
export abstract class SocialProvider extends EventEmitter {
  abstract readonly name: string;

  /** Initialize the provider (login, setup connections). */
  abstract start(): Promise<void>;

  /** Clean shutdown. */
  abstract stop(): Promise<void>;

  /** Add accounts to monitor at runtime. */
  abstract addAccounts(accounts: string[]): Promise<void>;

  /** Search for posts matching a query. */
  abstract search(query: string, limit?: number): Promise<SocialPost[]>;
}
