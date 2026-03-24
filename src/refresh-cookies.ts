import dotenv from 'dotenv';
import { Scraper } from '@the-convocation/twitter-scraper';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { writeFileSync } from 'fs';

dotenv.config();

async function main() {
  const username = process.env.TWITTER_USERNAME;
  const password = process.env.TWITTER_PASSWORD;
  const email = process.env.TWITTER_EMAIL;
  const proxyUrl = process.env.PROXY_URL;

  if (!username || !password) {
    console.error('Set TWITTER_USERNAME and TWITTER_PASSWORD in .env');
    process.exit(1);
  }

  let scraper: Scraper;
  if (proxyUrl) {
    const proxyAgent = new ProxyAgent(proxyUrl);
    scraper = new Scraper({
      fetch: ((input: any, init?: any) => {
        return undiciFetch(input, { ...init, dispatcher: proxyAgent });
      }) as any,
    });
    console.log(`Using proxy: ${proxyUrl.replace(/:[^:@]+@/, ':***@')}`);
  } else {
    scraper = new Scraper();
  }

  console.log(`Logging in as @${username}...`);
  await scraper.login(username, password, email);

  if (await scraper.isLoggedIn()) {
    console.log('Login successful!');

    const cookies = await scraper.getCookies();
    const cookiesJson = JSON.stringify(cookies);

    // Save to file
    writeFileSync('cookies.json', cookiesJson);
    console.log('Cookies saved to cookies.json');

    // Test: fetch a tweet
    console.log('\nTesting: fetching latest tweet from @Dexerto...');
    const tweet = await scraper.getLatestTweet('Dexerto');
    if (tweet) {
      console.log(`  ID: ${tweet.id}`);
      console.log(`  Text: ${tweet.text?.slice(0, 100)}`);
      console.log(`  Likes: ${tweet.likes} | RTs: ${tweet.retweets} | Views: ${tweet.views}`);
    } else {
      console.log('  No tweet found');
    }

    await scraper.logout();
    console.log('\nDone. Add to your .env:');
    console.log(`TWITTER_COOKIES='${cookiesJson}'`);
  } else {
    console.error('Login failed');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
