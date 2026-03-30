# BlocklistBot

**⚠️ Important Notice**

This project is published **for transparency purposes only**.  
It is **not licensed for use**.  

You are **not permitted** to run, deploy, host, modify, or use this bot in any way.  
It is made public solely so that the community can see and audit the code.

See the [LICENSE](LICENSE) file for full details.

VRChat blocklist bot for Discord. Lets people report VRChat users into different categories, the community can vote to take posts down if they dont belong there.

Built with discord.js v14 and MySQL.

## Commands

/paste - report a VRChat user to the blocklist
/tdr - file a takedown request, community votes for 7 days
/setup - see which channels are set up
/edit - change the VRChat login (owner only)
/status - check if the VRChat account still works
/rules-setup - post a rules button
/deepl-usage - check how much of the DeepL free tier is used
/migrate-reasons - pulls reasons from old posts into the database (run once)

## You need

- Node.js 18+
- MySQL or MariaDB
- Discord bot with Guilds, Guild Messages, Guild Members intents
- VRChat account
- DeepL API key if you want auto translation (free tier is enough)

## Setup

Clone it, install dependencies, copy the env file and fill it in.

    git clone https://github.com/SilentByQuiet/BlocklistBot.git
    cd BlocklistBot
    npm install
    cp .env.example .env

Edit .env with your stuff, then start:

    npm start

Database and tables get created on first start, you dont need to do anything there.

## How TDRs work

Someone runs /tdr with the ref ID from a post. Bot posts a vote in the announcements channel. People have 7 days to vote keep or remove. If theres 12 more removes than keeps the post gets deleted. Theres a 14 day cooldown after that.

## Other things

- posts use the new Discord Components V2 layout
- reasons get translated to english automatically if DeepL is set up
- bot checks every hour if posts are still there and reposts missing ones
- daily check for VRChat name changes
- user IDs are hashed, nothing personal gets stored
- reporting someone whos already listed just adds the new reason to the existing post

## Files

    index.js                  main file, handles interactions
    commands/
      paste.js                blocklist reports
      tdr.js                  takedown requests and voting
      setup.js                channel overview
      edit.js                 update vrchat login
      status.js               vrchat status check
      rules.js                rules button
      test.js                 layout preview (admin)
      deepl-usage.js          translation stats
      migrate-reasons.js      migration helper
    database/
      db.js                   mysql connection
      migrations.js           table setup
    events/
      ready.js                startup
      guildmemberadd.js       role check on join
      guildmemberremove.js    cleanup on leave
    helper/
      buildContainer.js       builds the post layout
      deepl.js                translation api
      postSyncScheduler.js    hourly sync + name check
      tdrScheduler.js         checks vote deadlines
      vrchat.js               vrchat api
      webhooks.js             webhook cache

---

made by [SilentByQuiet](https://github.com/SilentByQuiet)
