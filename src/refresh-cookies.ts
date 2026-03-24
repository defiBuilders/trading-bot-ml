import dotenv from 'dotenv';
import { Scraper } from '@the-convocation/twitter-scraper';
import { Cookie } from 'tough-cookie';
import { writeFileSync } from 'fs';

dotenv.config();

async function main() {
  const ct0 = process.env.TWITTER_CT0;
  const authToken = process.env.TWITTER_AUTH_TOKEN;

  if (!ct0 || !authToken) {
    console.error('Set TWITTER_CT0 and TWITTER_AUTH_TOKEN in .env');
    console.error('Get them from browser DevTools → Application → Cookies → x.com');
    process.exit(1);
  }

  const scraper = new Scraper();

  // Build cookies from browser values
  const cookies = [
    new Cookie({ key: 'ct0', value: ct0, domain: '.x.com', path: '/' }),
    new Cookie({ key: 'auth_token', value: authToken, domain: '.x.com', path: '/' }),
  ];

  await scraper.setCookies(cookies);

  if (await scraper.isLoggedIn()) {
    console.log('Authenticated via cookies!');

    // Export full cookie jar for future use
    const allCookies = await scraper.getCookies();
    const cookiesJson = JSON.stringify(allCookies);
    writeFileSync('cookies.json', cookiesJson);
    console.log('Full cookies saved to cookies.json');

    // Test: fetch a tweet
    console.log('\nTesting: fetching latest tweet from @Dexerto...');
    const tweet = await scraper.getLatestTweet('Dexerto');
    if (tweet) {
      console.log(`  ID: ${tweet.id}`);
      console.log(`  Text: ${tweet.text?.slice(0, 100)}`);
      console.log(`  Likes: ${tweet.likes} | RTs: ${tweet.retweets} | Views: ${tweet.views}`);
      console.log('\nWorking!');
    } else {
      console.log('  No tweet found (may need to check cookies)');
    }

    console.log('\nAdd to .env:');
    console.log(`TWITTER_COOKIES='${cookiesJson}'`);
  } else {
    console.error('Cookie auth failed — cookies may be expired. Re-export from browser.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
