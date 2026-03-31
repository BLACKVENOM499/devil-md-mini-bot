const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const { sms, downloadMediaMessage } = require("./msg");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('@whiskeysockets/baileys');

// ==================== CONFIGURATION ====================
const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'false',
    AUTO_UPDATE: 'true', // New auto-update feature
    AUTO_LIKE_EMOJI: ['💋', '🍬', '🫆', '💗', '🎈', '🎉', '🥳', '❤️', '🧫', '🐭'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/E3BUVhFw6GIEVVjerzeC9C?mode=gi_t',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: 'https://files.catbox.moe/eebv7z.jpg',
    NEWSLETTER_JID: '120363424740976142@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    OWNER_NUMBER: '94764703165',
    OWNER_NAME: '𝐀𝐊𝐈𝐍𝐃𝐔',
    BOT_NAME: '𝐀𝐊𝐈𝐍𝐃𝐔 𝐌𝐈𝐍𝐈',
    BOT_EMOJI: '🤖',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbC6NCl59PwPLJlvGt21',
    DEV_NAME: '𝐀𝐊𝐈𝐍𝐃𝐔 𝐌𝐈𝐍𝐈' // Changed from DTZ RAVIYA to SHANUKA SHAMEEN
};

// GitHub Configuration - Update these with your details
const octokit = new Octokit({ auth: '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' });
const owner = 'YT-BASE-BOT';
const repo = 'SO-MD-MINI';
const CURRENT_VERSION = '1.0.0'; // Current version of the bot
const VERSION_CHECK_URL = 'https://raw.githubusercontent.com/YT-BASE-BOT/SO-MD-MINI/main/version.json'; // Version check URL

// ==================== GLOBAL VARIABLES ====================
const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();
let updateInProgress = false; // Flag to prevent multiple updates

// Create session directory if not exists
if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

// ==================== AUTO UPDATE FUNCTIONS ====================
async function checkForUpdates() {
    try {
        const response = await axios.get(VERSION_CHECK_URL);
        const remoteVersion = response.data.version;
        const updateUrl = response.data.updateUrl || 'https://github.com/Raviya-cmd/SO-MD-MINI';
        
        if (remoteVersion !== CURRENT_VERSION) {
            console.log(`🔄 Update available! Current: ${CURRENT_VERSION}, Latest: ${remoteVersion}`);
            return {
                available: true,
                version: remoteVersion,
                url: updateUrl
            };
        }
        return { available: false };
    } catch (error) {
        console.error('❌ Failed to check for updates:', error.message);
        return { available: false };
    }
}

async function performAutoUpdate() {
    if (updateInProgress) {
        console.log('⚠️ Update already in progress...');
        return false;
    }

    updateInProgress = true;
    console.log('🔄 Starting auto-update process...');

    try {
        // Notify all active bots about the update
        for (const [number, socket] of activeSockets) {
            try {
                const userJid = jidNormalizedUser(socket.user.id);
                await socket.sendMessage(userJid, {
                    image: { url: config.RCD_IMAGE_PATH },
                    caption: formatMessage(
                        '🔄 AUTO UPDATE',
                        `The bot is being updated to the latest version.\nPlease wait a moment...\n\n👑 Developer: ${config.DEV_NAME}`,
                        config.BOT_NAME
                    )
                }, { quoted: shonux });
            } catch (error) {
                console.error(`Failed to notify ${number} about update:`, error);
            }
        }

        // Pull latest changes from GitHub
        const repoPath = path.join(__dirname, '..');
        await new Promise((resolve, reject) => {
            exec('git pull origin main', { cwd: repoPath }, (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ Git pull failed:', error);
                    reject(error);
                } else {
                    console.log('✅ Git pull completed:', stdout);
                    resolve(stdout);
                }
            });
        });

        // Install any new dependencies
        await new Promise((resolve, reject) => {
            exec('npm install', { cwd: repoPath }, (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ NPM install failed:', error);
                    reject(error);
                } else {
                    console.log('✅ NPM install completed:', stdout);
                    resolve(stdout);
                }
            });
        });

        console.log('✅ Auto-update completed successfully!');

        // Notify all active bots about successful update
        for (const [number, socket] of activeSockets) {
            try {
                const userJid = jidNormalizedUser(socket.user.id);
                await socket.sendMessage(userJid, {
                    image: { url: config.RCD_IMAGE_PATH },
                    caption: formatMessage(
                        '✅ UPDATE COMPLETED',
                        `Bot has been successfully updated to the latest version!\n\n👑 Developer: ${config.DEV_NAME}`,
                        config.BOT_NAME
                    )
                }, { quoted: shonux });
            } catch (error) {
                console.error(`Failed to notify ${number} about update completion:`, error);
            }
        }

        // Restart the bot to apply changes
        setTimeout(() => {
            console.log('🔄 Restarting bot to apply updates...');
            process.exit(0);
        }, 5000);

        return true;
    } catch (error) {
        console.error('❌ Auto-update failed:', error);
        
        // Notify about update failure
        for (const [number, socket] of activeSockets) {
            try {
                const userJid = jidNormalizedUser(socket.user.id);
                await socket.sendMessage(userJid, {
                    image: { url: config.RCD_IMAGE_PATH },
                    caption: formatMessage(
                        '❌ UPDATE FAILED',
                        `Auto-update failed. Please check the logs.\n\n👑 Developer: ${config.DEV_NAME}`,
                        config.BOT_NAME
                    )
                }, { quoted: shonux });
            } catch (error) {
                console.error(`Failed to notify ${number} about update failure:`, error);
            }
        }
        
        return false;
    } finally {
        updateInProgress = false;
    }
}

// Schedule auto-update check (every 1 hour)
setInterval(async () => {
    if (config.AUTO_UPDATE === 'true') {
        const updateInfo = await checkForUpdates();
        if (updateInfo.available) {
            console.log(`📦 New version ${updateInfo.version} available!`);
            await performAutoUpdate();
        }
    }
}, 3600000); // Check every hour

// ==================== UTILITY FUNCTIONS ====================
function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${config.BOT_NAME} ${config.BOT_EMOJI}* | *${config.DEV_NAME}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

// Fake Quoted Message for Commands
const shonux = {
    key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_CREATIVE"
    },
    message: {
        contactMessage: {
            displayName: config.OWNER_NAME,
            vcard: `BEGIN:VCARD
VERSION:3.0
N:${config.OWNER_NAME};;;;
FN:${config.OWNER_NAME}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
        }
    }
};

// ==================== GITHUB FUNCTIONS ====================
async function cleanDuplicateFiles(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith(`empire_${sanitizedNumber}_`) && file.name.endsWith('.json')
        ).sort((a, b) => {
            const timeA = parseInt(a.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            const timeB = parseInt(b.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            return timeB - timeA;
        });

        const configFiles = data.filter(file => 
            file.name === `config_${sanitizedNumber}.json`
        );

        if (sessionFiles.length > 1) {
            for (let i = 1; i < sessionFiles.length; i++) {
                await octokit.repos.deleteFile({
                    owner,
                    repo,
                    path: `session/${sessionFiles[i].name}`,
                    message: `Delete duplicate session file for ${sanitizedNumber}`,
                    sha: sessionFiles[i].sha
                });
                console.log(`Deleted duplicate session file: ${sessionFiles[i].name}`);
            }
        }

        if (configFiles.length > 0) {
            console.log(`Config file for ${sanitizedNumber} already exists`);
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error);
    }
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) {
        console.error('Invalid group invite link format');
        return { status: 'failed', error: 'Invalid group invite link' };
    }
    const inviteCode = inviteCodeMatch[1];

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) {
                console.log(`Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group, retries left: ${retries}`, errorMessage);
            if (retries === 0) {
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const groupStatus = groupResult.status === 'success'
        ? `Joined (ID: ${groupResult.gid})`
        : `Failed to join group: ${groupResult.error}`;
    const caption = formatMessage(
        'AKINDU MD CONNECTED SUCCESSFULLY 🟢',
        `📞 Your Number: ${number}\n🖨️ Status: Connected\n🎉️ Bot: ${config.BOT_NAME}\n👑 Developer: ${config.DEV_NAME}`,
        config.BOT_NAME
    );

    for (const admin of admins) {
        try {
            await socket.sendMessage(
                `${admin}@s.whatsapp.net`,
                {
                    image: { url: config.RCD_IMAGE_PATH },
                    caption
                }
            );
        } catch (error) {
            console.error(`Failed to send connect message to admin ${admin}:`, error);
        }
    }
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 VERIFICATION CODE',
        `Your verification code is: *${otp}*\nThis code will expire in 5 minutes.\n\n🤖 ${config.BOT_NAME}`,
        config.BOT_NAME
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

// ==================== NEWSLETTER HANDLERS ====================
function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const allNewsletterJIDs = await loadNewsletterJIDsFromRaw();
        const jid = message.key.remoteJid;

        if (!allNewsletterJIDs.includes(jid)) return;

        try {
            const emojis = ['💗', '🤍', '❤️', '💜️', '💛', '💙'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('No newsletterServerId found in message:', message);
                return;
            }

            let retries = 3;
            while (retries-- > 0) {
                try {
                    await socket.newsletterReactMessage(jid, messageId.toString(), randomEmoji);
                    console.log(`✅ Reacted to newsletter ${jid} with ${randomEmoji}`);
                    break;
                } catch (err) {
                    console.warn(`❌ Reaction attempt failed (${3 - retries}/3):`, err.message);
                    await delay(1500);
                }
            }
        } catch (error) {
            console.error('⚠️ Newsletter reaction handler failed:', error.message);
        }
    });
}

// ==================== STATUS HANDLERS ====================
async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;

        try {
            if (config.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

// ==================== MESSAGE HANDLERS ====================
async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        
        const message = formatMessage(
            '⛔ MESSAGE DELETED',
            `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`,
            config.BOT_NAME
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

async function oneViewmeg(socket, isOwner, msg ,sender) {
    if (isOwner) {  
    try {
    const akuru = sender
    const quot = msg
    if (quot) {
        if (quot.imageMessage?.viewOnce) {
            console.log("hi");
            let cap = quot.imageMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.imageMessage);
            await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
        } else if (quot.videoMessage?.viewOnce) {
            console.log("hi");
            let cap = quot.videoMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.videoMessage);
             await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });
        } else if (quot.audioMessage?.viewOnce) {
            console.log("hi");
            let cap = quot.audioMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.audioMessage);
             await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
        } else if (quot.viewOnceMessageV2?.message?.imageMessage){
            let cap = quot.viewOnceMessageV2?.message?.imageMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.imageMessage);
             await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
            
        } else if (quot.viewOnceMessageV2?.message?.videoMessage){
            let cap = quot.viewOnceMessageV2?.message?.videoMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.videoMessage);
            await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });

        } else if (quot.viewOnceMessageV2Extension?.message?.audioMessage){
            let cap = quot.viewOnceMessageV2Extension?.message?.audioMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2Extension.message.audioMessage);
            await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
        }
        }        
        } catch (error) {
      }
    }
}

// ==================== COMMAND HANDLERS ====================
function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const type = getContentType(msg.message);
        if (!msg.message) return;
        
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const m = sms(socket, msg);
        
        const quoted = type == "extendedTextMessage" && msg.message.extendedTextMessage.contextInfo != null
            ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
            : [];
            
        const body = (type === 'conversation') ? msg.message.conversation 
            : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') 
            ? msg.message.extendedTextMessage.text 
            : (type == 'interactiveResponseMessage') 
            ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage 
                && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id 
            : (type == 'templateButtonReplyMessage') 
            ? msg.message.templateButtonReplyMessage?.selectedId 
            : (type === 'extendedTextMessage') 
            ? msg.message.extendedTextMessage.text 
            : (type == 'imageMessage') && msg.message.imageMessage.caption 
            ? msg.message.imageMessage.caption 
            : (type == 'videoMessage') && msg.message.videoMessage.caption 
            ? msg.message.videoMessage.caption 
            : (type == 'buttonsResponseMessage') 
            ? msg.message.buttonsResponseMessage?.selectedButtonId 
            : (type == 'listResponseMessage') 
            ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
            : (type == 'messageContextInfo') 
            ? (msg.message.buttonsResponseMessage?.selectedButtonId 
                || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
                || msg.text) 
            : (type === 'viewOnceMessage') 
            ? msg.message[type]?.message[getContentType(msg.message[type].message)] 
            : (type === "viewOnceMessageV2") 
            ? (msg.msg.message.imageMessage?.caption || msg.msg.message.videoMessage?.caption || "") 
            : '';
            
        let sender = msg.key.remoteJid;
        const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
        const senderNumber = nowsender.split('@')[0];
        const developers = `${config.OWNER_NUMBER}`;
        const botNumber = socket.user.id.split(':')[0];
        const isbot = botNumber.includes(senderNumber);
        const isOwner = isbot ? isbot : developers.includes(senderNumber);
        var prefix = config.PREFIX;
        var isCmd = body.startsWith(prefix);
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '.';
        var args = body.trim().split(/ +/).slice(1);
        
        socket.downloadAndSaveMediaMessage = async(message, filename, attachExtension = true) => {
            let quoted = message.msg ? message.msg : message;
            let mime = (message.msg || message).mimetype || '';
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
            const stream = await downloadContentFromMessage(quoted, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            let type = await FileType.fromBuffer(buffer);
            trueFileName = attachExtension ? (filename + '.' + type.ext) : filename;
            await fs.writeFileSync(trueFileName, buffer);
            return trueFileName;
        };
        
        if (!command) return;
        
        try {
            switch (command) {
                // ==================== ALIVE COMMAND ====================
                 case 'alive': {
    try {
        const startTime = socketCreationTime.get(number) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);

        const title = '*💫 rG-RâVâN xᴅ ᴍɪɴi*';
        const content = 
            `*© ʙʏ sourajit ᴛᴇᴄʜ*\n` +
            `*𝐁ᴏᴛ 𝐎ᴡɴᴇʀ :- SOURAJIT *\n` +
            `*𝐎ᴡᴇɴʀ 𝐍ᴜᴍʙᴇʀ* :- +916909950582\n` +
            `*ᴍɪɴɪ ꜱɪᴛᴇ*\n> sᴏᴏɴ` +
            `\n\n*Uptime:* ${hours}h ${minutes}m ${seconds}s`;
        
        const footer = config.BOT_FOOTER;

        const buttons = [
            { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: 'RG-RAVAN' ᴍᴇɴᴜ 📜' }, type: 1 },
            { buttonId: `${config.PREFIX}ping`, buttonText: { displayText: 'RG-RAHUL mini ᴘɪɴɢ 💥' }, type: 1 }
        ];

        const buttonMessage = {
            image: { url: config.BUTTON_IMAGES.OWNER },
            caption: `${title}\n\n${content}`,
            footer: footer,
            buttons: buttons,
            headerType: 4
        };

        await socket.sendMessage(sender, buttonMessage, { quoted: fakevCard });
    } catch (err) {
        console.log('Alive command error:', err);
        await socket.sendMessage(sender, { text: '❌ Error occurred while executing alive command.' });
    }
    break;
}                   
               case 'menu': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);

                    const title = '*HI 👋* *${pushwish}*\n┏━━━━ ◉◉ `ʜᴇʟʟᴏᴡ`━━━━ ◉◉➢\n┣ *🧚‍♂️ Name: RG-RÂVÂN MINI*\n┣ *🌐 Type:* ᴍɪɴɪ ʙᴏᴛ\n┣ *👨‍💻 ᴏᴡɴᴇʀ:* Lord Sung\n┗━⚝';
                    const content = '𓊈 RG-RÂVÂN MINI MD 𝐁𝐎𝐓 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒 𓊉\n' +

                   '╭─〔  S T A T U S  🥷 〕─╮\n' +
                   '│ ∘ Name     : 💫SOURAJIT xᴅ\n' +
                   '│ ∘ Platform : Heroku\n' +
                   '╰─────────────╯\n\n' +

                   '➤ 𝐀𝐕𝐀𝐈𝐋𝐀𝐁𝐋𝐄 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒\n' +
                   '┏━━━━━━ ❍ ━━━━━━┓\n' +
                   '🛠️ *SYSTEM COMMANDS*\n' +
                   '• 🟢 `.alive` — Show bot status\n' +
                   '• 🔌 `.system` — Bot System\n' +
                   '• 🧪 `.ping` — Check speed\n' +
                   '• 🆔 `.jid` — Get your JID\n\n' +

                   '🖼️ *MEDIA TOOLS*\n' +
                   '• 👁‍🗨 `.vv` — View once unlock\n' +
                   '• ⭐ `.getdp` — Downlode Dp\n' +
                   '• 👀 `.cinfo` — Get Channel Info\n' +
                   '• 💾 `.save / send` — Status saver\n' +
                   '• 🍭 `.yts` — Youtube search\n' +
                   '• 📋 `.tiktoksearch` — tiktoksearch\n\n' +

                   '📥 *DOWNLOADERS*\n' +
                   '• 🎧 `.song` — Download song\n' +
                   '• 📂 `.csend` — Channel Song Send\n' +
                   '• 🎥 `.tiktok` — TikTok video\n' +
                   '• 📸 `.facebook`  — Video Facebook\n' +
                   '• 🎬 `.video` — Video\n\n' + 
                   '╭───────𓍯───────╮\n' +
                   '▫️Mini Bot Web 🌐\n' +
                   '> sᴏᴏɴ\n' +
                   '╰───────𓍯───────╯';                                    
                    const footer = config.BOT_FOOTER;

                    await socket.sendMessage(sender, {
                        image: { url: config.BUTTON_IMAGES.OWNER }, // Changed to MENU image
                        caption: formatMessage(title, content, footer),
                        buttons: [
                            { buttonId: `${config.PREFIX}amenu`, buttonText: { displayText: 'RG-RAVAN mini ᴍᴀɪɴ ᴍᴇɴᴜ 🎛️' }, type: 1 },
                            { buttonId: `${config.PREFIX}bmenu`, buttonText: { displayText: 'RG-RAVAN mini ᴅᴏᴡɴʟᴏᴀᴅ ᴍᴇɴᴜ 📥' }, type: 1 },
                            { buttonId: `${config.PREFIX}cmenu`, buttonText: { displayText: 'RG-RAVAN mini ꜱᴘᴇᴄɪᴀʟ ᴍᴇɴᴜ 🧮' }, type: 1 },
                            { buttonId: `${config.PREFIX}dmenu`, buttonText: { displayText: 'RG-RAVAN mini ᴏᴛʜᴇʀ ᴍᴇɴᴜ 📄' }, type: 1 }
                        ],
                        },  { quoted: fakevCard });

                    break;
                }

                case 'amenu': {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    await socket.sendMessage(sender, { 
        react: { 
            text: "📜",
            key: msg.key 
        } 
    });

    const Podda = `┏━❐  \`ᴍᴀɪɴ ᴍᴇɴᴜ\`
┃ *⭔ ʙᴏᴛ ɴᴀᴍᴇ - RG-RÂVÂN mini*
┃ *⭔ ᴘʟᴀᴛꜰʀᴏᴍ - Heroku*
┃ *⭔ ᴜᴘᴛɪᴍᴇ:* ${hours}h ${minutes}m ${seconds}s
┗━❐

╭─═❮ ⚡ ᴍᴀɪɴ ⚡ ❯═━───❖
*│ 🟢 .ᴀʟɪᴠᴇ →*  
┣ ʙᴏᴛ ᴏɴʟɪɴᴇ ᴄʜᴇᴄᴋ  
*│ 📶 .ᴘɪɴɢ →*  
┣ ꜱᴘᴇᴇᴅ ᴛᴇꜱᴛ  
*│ ⚙️ .ꜱʏꜱᴛᴇᴍ →*  
┣ ʙᴏᴛ ꜱʏꜱᴛᴇᴍ ɪɴꜰᴏ  
*│ 👑 .ᴏᴡɴᴇʀ →*  
┣ ꜱʜᴏᴡ ʙᴏᴛ ᴏᴡɴᴇʀꜱ  
╰━━━━━━━━━━━━━━━━━━━❖`;

    const buttons = [
        { buttonId: '.alive', buttonText: { displayText: '➿ ʙᴀᴄᴋ ᴛᴏ ᴍᴀɪɴ ᴍᴇɴᴜ' }, type: 1 },
        { buttonId: '.ping', buttonText: { displayText: 'RG-RAVAN mini ᴘɪɴɢ 💥' }, type: 1 }
    ];

    const buttonMessage = {
        image: { url: "https://files.catbox.moe/2s3ftq.jpg" },
        caption: Podda,
        footer: "💫 RG-RÂVÂN 𝐌ɪɴɪ 💫",
        buttons: buttons,
        headerType: 4,
        contextInfo: fakeForward
    };

    await socket.sendMessage(sender, buttonMessage, { quoted: fakevCard });
    break;
}                        
case 'bmenu': {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    // React to the message
    await socket.sendMessage(sender, { 
        react: { 
            text: "📥",
            key: msg.key 
        } 
    });

    const Podda = `┏━❐  \`ᴅᴏᴡɴʟᴏᴀᴅ ᴍᴇɴᴜ\`
┃ *⭔ ʙᴏᴛ ɴᴀᴍᴇ - RG-RÂVÂNmini*
┃ *⭔ ᴘʟᴀᴛꜰʀᴏᴍ - Heroku*
┃ *⭔ ᴜᴘᴛɪᴍᴇ:* ${hours}h ${minutes}m ${seconds}s
┗━❐

╭─═❮ 🎵 ᴅᴏᴡɴʟᴏᴀᴅ 🎵 ❯═━───❖
*│ 🎼 .ꜱᴏɴɢ <ɴᴀᴍᴇ> →*  
┣ ᴅᴏᴡɴʟᴏᴀᴅ ꜱᴏɴɢ  
*│ 📘 .ꜰʙ <ᴜʀʟ> →*  
┣ ꜰᴀᴄᴇʙᴏᴏᴋ ᴠɪᴅᴇᴏ ᴅʟ  
*│ 🎶 .ᴛɪᴋᴛᴏᴋꜱᴇᴀʀᴄʜ <ɴᴀᴍᴇ> →*  
┣ ᴛɪᴋᴛᴏᴋ ꜱᴇᴀʀᴄʜ  
*│ 🎵 .ᴛɪᴋᴛᴏᴋ <ᴜʀʟ> →*  
┣ ᴛɪᴋᴛᴏᴋ ᴅʟ  
*│ 📲 .ᴀᴘᴋ <ɴᴀᴍᴇ> →*  
┣ ᴀᴘᴋ ᴅᴏᴡɴʟᴏᴀᴅ  
╰━━━━━━━━━━━━━━━━━━━❖`;

    // Buttons setup
    const buttons = [
        { buttonId: '.menu', buttonText: { displayText: ' ➿ ʙᴀᴄᴋ ᴛᴏ ᴍᴀɪɴ ᴍᴇɴᴜ' }, type: 1 },
        { buttonId: '.ping', buttonText: { displayText: 'suho mini ᴘɪɴɢ 💥' }, type: 1 }
    ];

    const buttonMessage = {
        image: { url: https://files.catbox.moe/2s3ftq.jpg" },
        caption: Podda,
        footer: 'RG-RAVAN mini • Download Menu',
        buttons: buttons,
        headerType: 4, // 4 = image with buttons
        contextInfo: fakeForward
    };

    await socket.sendMessage(sender, buttonMessage, { quoted: fakevCard });
    break;
}
 case 'cmenu': {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    await socket.sendMessage(sender, { 
        react: { 
            text: "🌸",
            key: msg.key 
        } 
    });

    const Podda = `┏━❐  \`ꜱᴘᴇᴄɪᴀʟ ᴍᴇɴᴜ\`
┃ *⭔ ʙᴏᴛ ɴᴀᴍᴇ - RG-RÂVÂN mini*
┃ *⭔ ᴘʟᴀᴛꜰʀᴏᴍ - Heroku*
┃ *⭔ ᴜᴘᴛɪᴍᴇ:* ${hours}h ${minutes}m ${seconds}s
┗━❐

╭─═❮ 🛠 ꜱᴘᴇᴄɪᴀʟ 🛠 ❯═━───❖
*│ 📦 .ɴᴘᴍ <ᴘᴀᴄᴋᴀɢᴇ> →*  
┣ ɢᴇᴛ ɴᴘᴍ ɪɴꜰᴏ  
*│ 🔍 .ɢᴏᴏɢʟᴇ <ǫᴜᴇʀʏ> →*  
┣ ɢᴏᴏɢʟᴇ ꜱᴇᴀʀᴄʜ  
*│ 🤖 .ᴀɪ <ᴘʀᴏᴍᴘᴛ> →*  
┣ ᴄʜᴀᴛ ᴡɪᴛʜ ᴀɪ  
*│ 🖼️ .ɢᴇᴛᴅᴘ <ᴊɪᴅ> →*  
┣ ɢᴇᴛ ᴘʀᴏꜰɪʟᴇ ᴘɪᴄ  
*│ 💥 .ʙᴏᴏᴍ <ɴᴜᴍ|ᴄᴏᴜɴᴛ> →*  
┣ ʙᴏᴏᴍ ɴᴜᴍʙᴇʀ 
*│ 🎶 .ᴄꜱᴏɴɢ <ᴊɪᴅ> <ꜱᴏɴɢ ɴᴀᴍᴇ> →*  
┣ ᴄʜᴀɴɴᴇʟ ꜱᴏɴɢ ꜱᴇɴᴅᴇʀ
*│ 📝 .ᴄᴀᴘᴇᴅɪᴛ <ᴊɪᴅ> <ᴄᴀᴘᴛɪᴏɴ:> ᴍꜱɢ →*  
┣ ᴇᴅɪᴛ ᴄᴀᴘᴛɪᴏɴ  
╰━━━━━━━━━━━━━━━━━━━❖`;

    // Buttons array
    const buttons = [
        { buttonId: '.menu', buttonText: { displayText: '➿ ʙᴀᴄᴋ ᴛᴏ ᴍᴀɪɴ ᴍᴇɴᴜ' }, type: 1 },
        { buttonId: '.ping', buttonText: { displayText: 'RG-RAVAN mini ᴘɪɴɢ 💥' }, type: 1 }
    ];

    const buttonMessage = {
        image: { url: "https://files.catbox.moe/2s3ftq.jpg" },
        caption: Podda,
        footer: "💫 RG-RÂVÂN ᴍɪɴɪ 💫",
        buttons: buttons,
        headerType: 4, // 4 = Image header
        contextInfo: fakeForward
    };

    await socket.sendMessage(sender, buttonMessage, { quoted: fakevCard });
    break;
}
 case 'dmenu': {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    await socket.sendMessage(sender, { 
        react: { 
            text: "📋",
            key: msg.key 
        } 
    });

    const Podda = `┏━❐  \`ᴏᴛʜᴇʀ ᴍᴇɴᴜ\`
┃ *⭔ ʙᴏᴛ ɴᴀᴍᴇ - RG-RÂVÂN mini xᴅ*
┃ *⭔ ᴘʟᴀᴛꜰʀᴏᴍ - Heroku*
┃ *⭔ ᴜᴘᴛɪᴍᴇ:* ${hours}h ${minutes}m ${seconds}s
┗━❐

╭─═❮ 🔗 ᴏᴛʜᴇʀ 🔗 ❯═━───❖
*│ 🔗 .ᴘᴀɪʀ <ᴄᴏᴅᴇ> →*  
┣ ᴘᴀɪʀ ꜱᴇꜱꜱɪᴏɴ  
*│ 🆔 .ᴊɪᴅ →*  
┣ ɢᴇᴛ ᴄʜᴀᴛ ᴊɪᴅ  
*│ 📡 .ᴄɪᴅ <ʟɪɴᴋ> →*  
┣ ɢᴇᴛ ᴄʜᴀɴɴᴇʟ ɪɴꜰᴏ  
*│ 🎥 .vv →*  
┣ ᴠɪᴇᴡ ᴏɴᴄᴇ ᴜɴʟᴏᴄᴋ
*│ 📤 .ꜱᴇɴᴅ →*  
┣ ꜱᴛᴀᴛᴜꜱ ᴅᴏᴡɴʟᴏᴀᴅ
╰━━━━━━━━━━━━━━━━━━━❖`;

    // Buttons
    const buttons = [
        { buttonId: '.menu', buttonText: { displayText: '➿ ʙᴀᴄᴋ ᴛᴏ ᴍᴀɪɴ ᴍᴇɴᴜ' }, type: 1 },
        { buttonId: '.ping', buttonText: { displayText: 'RG-RAVAN mini ᴘɪɴɢ 💥' }, type: 1 }
    ];

    const buttonMessage = {
        image: { url: "https://files.catbox.moe/2s3ftq.jpg" },
        caption: Podda,
        footer: "💫 RG-RÂVÂN ᴍɪɴɪ 💫",
        buttons: buttons,
        headerType: 4, // Image header
        contextInfo: fakeForward
    };

    await socket.sendMessage(sender, buttonMessage, { quoted: fakevCard });
    break;
} 

case 'animemenu': {
    try {
        const startTime = socketCreationTime.get(sender) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);

        // 🎌 Reaction
        await socket.sendMessage(sender, { 
            react: { 
                text: "😻", 
                key: msg.key 
            } 
        });

        // 🎴 Anime Menu Text
        const animeMenuText = `
┏━❐  \`ᴀɴɪᴍᴇ ᴍᴇɴᴜ\`
┃ *⭔ ʙᴏᴛ ɴᴀᴍᴇ:* RG-RÂVÂN mini xᴅ
┃ *⭔ ᴘʟᴀᴛꜰʀᴏᴍ:* ʜᴇʀᴏᴋᴜ
┃ *⭔ ᴜᴘᴛɪᴍᴇ:* ${hours}h ${minutes}m ${seconds}s
┗━❐

╭─═❮ 🎴 ᴀɴɪᴍᴇ 🔗 ❯═━─
*│ 🎀 .waifu →* Random waifu image  
*│ 🐱 .neko →* Random neko image  
*│ ⚠️ .nsfwneko →* NSFW neko (18+)  
*│ 🎨 .randomanime →* Random anime picture  
*│ 📖 .animeinfo <name> →* Anime info (MyAnimeList)
╰━━━━`;

        // 💫 Buttons
        const buttons = [
            { buttonId: '.waifu', buttonText: { displayText: 'ᴀɴɪᴍᴇ ɢɪʀʟ ᴡᴀɪꜰᴜ 🩷' }, type: 1 },
            { buttonId: '.neko', buttonText: { displayText: 'ᴀɴɪᴍᴇ boy picture 🐱' }, type: 1 },
            { buttonId: '.nsfwneko', buttonText: { displayText: 'ᴀᴅᴜʟᴛ ᴀɴɪᴍᴇ ɢɪʀʟ ⚠️' }, type: 1 },            
            { buttonId: '.menu', buttonText: { displayText: '➿ ʙᴀᴄᴋ ᴛᴏ ᴍᴀɪɴ ᴍᴇɴᴜ' }, type: 1 }
        ];

        const buttonMessage = {
            image: { url: "https://files.catbox.moe/2s3ftq.jpg" },
            caption: animeMenuText,
            footer: "💫 RG-RÂVÂN xᴅ ᴍɪɴɪ 💫",
            buttons,
            headerType: 4,
            contextInfo: fakeForward
        };

        await socket.sendMessage(sender, buttonMessage, { quoted: msg });

    } catch (error) {
        console.error(error);
        await socket.sendMessage(sender, { text: "❌ Error while loading Anime Menu." }, { quoted: msg });
    }
    break;
}                                                 

///kkkkkk

case 'capedit': {
    try {
        const q = args.join(" ");
        if (!q) {
            return reply("👉 First type .capedit. Then add the channel JID. After that type `caption:` and add your caption. Reply to an *image / video / audio*.");
        }
        const jid = q.split(" ")[0]?.trim();
        if (!jid.endsWith("@newsletter")) {
            return reply("⚠️ Please enter a valid channel JID. It should end with `@newsletter`.");
        }

        const metadata = await socket.newsletterMetadata("jid", jid);

        let caption = q.includes("caption:")
            ? q.split("caption:").slice(1).join("caption:").trim()
            : `Can't find your channel 😔💔`;

        let quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (quotedMsg?.imageMessage) {
            const stream = await downloadContentFromMessage(quotedMsg.imageMessage, "image");
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

            await socket.sendMessage(sender, {
                image: buffer,
                caption,
                contextInfo: {
                    mentionedJid: [sender],
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: jid,
                        newsletterName: metadata.name,
                        serverMessageId: 143,
                    },
                },
            });
        } else if (quotedMsg?.videoMessage) {
            const stream = await downloadContentFromMessage(quotedMsg.videoMessage, "video");
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

            await socket.sendMessage(sender, {
                video: buffer,
                caption,
                contextInfo: {
                    mentionedJid: [sender],
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: jid,
                        newsletterName: metadata.name,
                        serverMessageId: 143,
                    },
                },
            });
        } else if (quotedMsg?.audioMessage) {
            const stream = await downloadContentFromMessage(quotedMsg.audioMessage, "audio");
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

            await socket.sendMessage(sender, {
                audio: buffer,
                mimetype: quotedMsg.audioMessage.mimetype || "audio/mpeg",
                ptt: quotedMsg.audioMessage.ptt || false,
                contextInfo: {
                    mentionedJid: [sender],
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: jid,
                        newsletterName: metadata.name,
                        serverMessageId: 143,
                    },
                },
            });
        } else {
            await socket.sendMessage(sender, {
                text: caption,
                contextInfo: {
                    mentionedJid: [sender],
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: jid,
                        newsletterName: metadata.name,
                        serverMessageId: 143,
                    },
                },
            });
        }
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: "❌ An error occurred. Check the console." });
    }
    break;
}
           case 'vv': {
    try {
        if (!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            return reply("Please reply to a ViewOnce message.");
        }

        const quotedMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
        let ext, mediaType;

        if (quotedMsg.imageMessage) {
            ext = "jpg";
            mediaType = "image";
        } else if (quotedMsg.videoMessage) {
            ext = "mp4";
            mediaType = "video";
        } else if (quotedMsg.audioMessage) {
            ext = "mp3";
            mediaType = "audio";
        } else {
            return reply("Unsupported media type. Please reply to an image, video, or audio message.");
        }

        const stream = await downloadContentFromMessage(
            quotedMsg.imageMessage || quotedMsg.videoMessage || quotedMsg.audioMessage,
            mediaType
        );

        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        if (mediaType === "image") {
    await socket.sendMessage(sender, { 
        image: buffer, 
        contextInfo: fakeForward,
    }, { quoted: fakevCard });
} else if (mediaType === "video") {
    await socket.sendMessage(sender, { 
        video: buffer,  
        contextInfo: fakeForward,
    }, { quoted: fakevCard });
} else if (mediaType === "audio") {
    await socket.sendMessage(sender, { 
        audio: buffer, 
        mimetype: quotedMsg.audioMessage.mimetype || "audio/mpeg",
        contextInfo: fakeForward,
    }, { quoted: fakevCard });
}

    } catch (e) {
        console.error("Error:", e);
        reply("An error occurred while fetching the ViewOnce message.");
    }
    break;
}   

                
case 'save': 
case 'send': {
    try {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (!quotedMsg) {
            return await socket.sendMessage(sender, {
                text: '*❌ Please reply to a status message to save*'
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, { react: { text: '💾', key: msg.key } });


        // Check message type and save accordingly
        if (quotedMsg.imageMessage) {
            const buffer = await downloadAndSaveMedia(quotedMsg.imageMessage, 'image');
            await socket.sendMessage(sender, {
                image: buffer,
                contextInfo: fakeForward,
                caption: quotedMsg.imageMessage.caption || '✅ *Status Saved*'},
        { quoted: fakevCard });
        } else if (quotedMsg.videoMessage) {
            const buffer = await downloadAndSaveMedia(quotedMsg.videoMessage, 'video');
            await socket.sendMessage(sender, {
                video: buffer,
                quoted: fakevCard,
                contextInfo: fakeForward,
                caption: quotedMsg.videoMessage.caption || '✅ *Status Saved*'},
        { quoted: fakevCard });
        } else if (quotedMsg.conversation || quotedMsg.extendedTextMessage) {
            const text = quotedMsg.conversation || quotedMsg.extendedTextMessage.text;
            await socket.sendMessage(sender, {
                text: `✅ *Status Saved*\n\n${text}`
            });
        } else {
            await socket.sendMessage(userJid, quotedMsg);
        }

        await socket.sendMessage(sender, {
            text: '✅ *Status saved successfully!*'
        }, { quoted: fakevCard });

    } catch (error) {
        console.error('❌ Save error:', error);
        await socket.sendMessage(sender, {
            text: '*❌ Failed to save status*'
        }, { quoted: fakevCard });
    }
    break;
} 
                                    /////kkk
                                    
                                    
                                    
case 'fancy': {
  const axios = require("axios");

  const q =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || '';

  const text = q.trim().replace(/^.fancy\s+/i, ""); // remove .fancy prefix

  if (!text) {
    return await socket.sendMessage(sender, {
      text: "❎ *Please provide text to convert into fancy fonts.*\n\n📌 *Example:* `.fancy Sahas`"
    });
  }

  try {
    const apiUrl = `https://www.dark-yasiya-api.site/other/font?text=${encodeURIComponent(text)}`;
    const response = await axios.get(apiUrl);

    if (!response.data.status || !response.data.result) {
      return await socket.sendMessage(sender, {
        text: "❌ *Error fetching fonts from API. Please try again later.*"
      });
    }

    const fontList = response.data.result
      .map(font => `*${font.name}:*\n${font.result}`)
      .join("\n\n");

    const finalMessage = `🎨 *Fancy Fonts Converter*\n\n${fontList}\n\n𝐀ɴɢʟᴇ_𝐌ɪɴɪ`;

    await socket.sendMessage(sender, {
      text: finalMessage,
    contextInfo: fakeForward,
}, {
    quoted: fakevCard
});

  } catch (err) {
    console.error("Fancy Font Error:", err);
    await socket.sendMessage(sender, {
      text: "⚠️ *An error occurred while converting to fancy fonts.*"
    });
  }

  break;
       }                  
       
                                         
///settings
case 'csend':
case 'csong': {
    try {
        const q = args.join(" ");
        if (!q) {
            return reply("*Please provide a song name or YouTube link...!*");
        }

        const targetJid = args[0];
        const query = args.slice(1).join(" ");

        if (!targetJid || !query) {
            return reply("*❌ Incorrect format! Use:* `.csong <jid> <song name>`");
        }

        const yts = require("yt-search");
        const search = await yts(query);

        if (!search.videos.length) {
            return reply("*Song not found... ❌*");
        }

        const data = search.videos[0];
        const ytUrl = data.url;
        const ago = data.ago;

        const axios = require("axios");
        const api = `https://yt-five-tau.vercel.app/download?q=${ytUrl}&format=mp3`;
        const { data: apiRes } = await axios.get(api);

        if (!apiRes?.status || !apiRes.result?.download) {
            return reply("❌ Cannot download the song. Try another one!");
        }

        const result = apiRes.result;

        let channelname = targetJid;
        try {
            const metadata = await socket.newsletterMetadata("jid", targetJid);
            if (metadata?.name) {
                channelname = metadata.name;
            }
        } catch (err) {
            console.error("Newsletter metadata error:", err);
        }

        const caption = `☘️ ᴛɪᴛʟᴇ : ${data.title} 🙇‍♂️🫀🎧

❒ *🎭 Vɪᴇᴡꜱ :* ${data.views}
❒ *⏱️ Dᴜʀᴀᴛɪᴏɴ :* ${data.timestamp}
❒ *📅 Rᴇʟᴇᴀꜱᴇ Dᴀᴛᴇ :* ${ago}

*00:00 ───●────────── ${data.timestamp}*

* *Need nice reacts ...💗😽🍃*

> *${channelname}*`;


        await socket.sendMessage(targetJid, {
            image: { url: result.thumbnail },
            caption: caption,
        });
        
await new Promise(resolve => setTimeout(resolve, 30000));

        await socket.sendMessage(targetJid, {
            audio: { url: result.download },
            mimetype: "audio/mpeg",
            ptt: true,
        });

        await socket.sendMessage(sender, {
            text: `✅ *"${result.title}"* Successfully sent to *${channelname}* (${targetJid}) 😎🎶`,
            });

    } catch (e) {
        console.error(e);
        reply("*Some error occurred! Please try again later.*");
    }
    break;
}
case 'song': {
  try {
    const q = args.join(" ");
    if (!q) return reply("💭 *Please provide a song name or YouTube link!* 🎵");

    const yts = require('yt-search');
    const search = await yts(q);

    if (!search.videos.length) return reply("❌ *Song not found!*");

    const data = search.videos[0];
    const ytUrl = data.url;

    const caption = `🎶 *RG-RÂVÂN md ᴍɪɴɪ ʙᴏᴛ ꜱᴏɴɢ ᴅᴏᴡɴʟᴏᴀᴅ* 🎧

*📋 ᴛɪᴛᴛʟᴇ ➟* ${data.title}
*⏱️ ᴅᴜʀᴀᴛɪᴏɴ ➟* ${data.timestamp}
*📅 ᴀɢᴏ ➟* ${data.ago}
*👀 ᴠɪᴇᴡs ➟* ${data.views}
*📎 ᴜʀʟ ➟* ${ytUrl}

> RG-RÂVÂN miniʙʏ SOURAJIT🔥`;

    const buttons = [
      { buttonId: `${config.PREFIX}mp3play ${ytUrl}`, buttonText: { displayText: '🎵 MP3' }, type: 1 },
      { buttonId: `${config.PREFIX}mp3doc ${ytUrl}`, buttonText: { displayText: '📂 DOCUMENT' }, type: 1 },
      { buttonId: `${config.PREFIX}mp3ptt ${ytUrl}`, buttonText: { displayText: '🎤 VOICE' }, type: 1 }
    ];

    await socket.sendMessage(sender, {
      image: { url: data.thumbnail },
      caption,
      footer: '💫 SOURAJIT xᴅ',
      buttons,
      headerType: 1,
      contextInfo: fakeForward
    }, { quoted: fakevCard });

  } catch (e) {
    console.error('Song Command Error:', e);
    reply("⚠️ *ᴛʀʏ ᴀɢᴀɪɴ ʟᴀᴛᴇʀ*");
  }
  break;
}

// =============================
// 🔊 Button Handlers
// =============================
case 'mp3play':
case 'mp3doc':
case 'mp3ptt': {
  try {
    const ytUrl = args[0];
    if (!ytUrl) return reply("❌ *YouTube link required!*");

    const apiUrl = `https://sadiya-tech-apis.vercel.app/download/ytdl?url=${ytUrl}&format=mp3&apikey=sadiya`;
    const { data: apiRes } = await axios.get(apiUrl);

    if (!apiRes?.status || !apiRes.result?.download)
      return reply("❌ *guess wat to do😂*");

    const result = apiRes.result;

    if (command === 'mp3play') {
      await socket.sendMessage(sender, {
        audio: { url: result.download },
        mimetype: 'audio/mpeg',
        ptt: false,
        contextInfo: fakeForward,
      }, { quoted: fakevCard });

    } else if (command === 'mp3doc') {
      await socket.sendMessage(sender, {
        document: { url: result.download },
        mimetype: 'audio/mpeg',
        fileName: `${result.title}.mp3`,
        caption: `🎧 ${result.title}`,
        contextInfo: fakeForward,
      }, { quoted: fakevCard });

    } else if (command === 'mp3ptt') {
      await socket.sendMessage(sender, {
        audio: { url: result.download },
        mimetype: 'audio/mpeg',
        ptt: true,
        contextInfo: fakeForward,
      }, { quoted: fakevCard });
    }

  } catch (e) {
    console.error('Button Command Error:', e);
    reply("⚠");
  }
  break;
}

                case 'ping': {
    var inital = new Date().getTime();
    let ping = await socket.sendMessage(sender, { text: '*_Pinging to Module..._* ❗' }, { quoted: fakevCard });
    var final = new Date().getTime();

    return await socket.sendMessage(sender, { text: '❗ *Pong ' + (final - inital) + ' Ms*' }, { edit: ping.key, quoted: fakevCard });
                }
                case 'owner': {
                    await socket.sendMessage(sender, { 
                        react: { 
                            text: "👤",
                            key: msg.key 
                        } 
                    });
                    
                    const ownerContact = {
                        contacts: {
                            displayName: 'My Contacts',
                            contacts: [
                                {
                                    vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN;CHARSET=UTF-8:lord sung 😚🤍\nTEL;TYPE=Owner,VOICE:+27649342626\nEND:VCARD',
                                },
                                {
                                vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN;CHARSET=UTF-8:sung ᴛᴇᴄʜ🪀 \nTEL;TYPE=Coder,VOICE:+27649342626\nEND:VCARD',   
                                },                        
                            ],
                        },
                    };

                    const ownerLocation = {
                        location: {
                            degreesLatitude: '',
                            degreesLongitude: '',
                            name: '',
                            address: '',
                        },
                    };

                    await socket.sendMessage(sender, ownerContact);
                    await socket.sendMessage(sender, ownerLocation);
                    break;
                }
                 // Make sure you have at top: 
// const axios = require('axios');

case 'fb':
case 'fbdl':
case 'facebook': {
    const getFBInfo = require('@xaviabot/fb-downloader');

    if (!args[0] || !args[0].startsWith('http')) {
        return await socket.sendMessage(from, {
            text: `❎ *Please provide a valid Facebook video link.*\n\n📌 Example: .fb https://fb.watch/abcd1234/`
        }, { quoted: msg });
    }

    try {
        // React to show loading
        await socket.sendMessage(from, { react: { text: "⏳", key: msg.key } });

        // Fetch FB info
        const fb = await getFBInfo(args[0]);
        const url = args[0];

        // Short description
        const shortDesc = fb.desc 
            ? fb.desc.length > 180 
                ? fb.desc.substring(0, 180) + '...' 
                : fb.desc 
            : 'No description available.';

        // Caption with title + description
        const caption = `
╭────────────────
│ 🎬 ${fb.title || 'Untitled Video'}
│────────────────
│ 📝 Description:
│ ${shortDesc}
│────────────────
│ 🌐 URL: ${url}
│────────────────
│ 📥 Select a download option 👇
╰────────────────`;

        // Buttons
        const buttons = [
            { buttonId: `.fbsd ${url}`, buttonText: { displayText: '📺 SD Video' }, type: 1 },
            { buttonId: `.fbhd ${url}`, buttonText: { displayText: '🎥 HD Video' }, type: 1 },
            { buttonId: `.fbaudio ${url}`, buttonText: { displayText: '🎧 Audio' }, type: 1 },
            { buttonId: `.fbdoc ${url}`, buttonText: { displayText: '📄 Document (MP4)' }, type: 1 },
            { buttonId: `.fbptt ${url}`, buttonText: { displayText: '🎤 Voice Note' }, type: 1 }
        ];

        // Send message with real thumbnail + buttons
        await socket.sendMessage(from, {
            image: { url: fb.thumbnail || 'https://files.catbox.moe/b7gyod.jpg' },
            caption: caption,
            footer: '🌟 XD MINI BOT | Facebook Downloader',
            buttons: buttons,
            headerType: 4,
            contextInfo: fakeForward
        }, { quoted: fakevCard });

    } catch (e) {
        console.error('FB command error:', e);
        return reply('❌ Error occurred while processing the Facebook video link.');
    }
    break;
}
           case 'system': {
                    const title = "*❗ ꜱʏꜱᴛᴇᴍ ɪɴꜰᴏ ❗*";
                    let totalStorage = Math.floor(os.totalmem() / 1024 / 1024) + 'MB';
                    let freeStorage = Math.floor(os.freemem() / 1024 / 1024) + 'MB';
                    let cpuModel = os.cpus()[0].model;
                    let cpuSpeed = os.cpus()[0].speed / 1000;
                    let cpuCount = os.cpus().length;
                    let hostname = os.hostname();

                    let content = `
  ◦ *Runtime*: ${runtime(process.uptime())}
  ◦ *Active Bot*: ${activeSockets.size}
  ◦ *Total Ram*: ${totalStorage}
  ◦ *CPU Speed*: ${cpuSpeed} GHz
  ◦ *Number of CPU Cores*: ${cpuCount} 
`;

                    const footer = config.BOT_FOOTER;

                    await socket.sendMessage(sender, {
                        image: { url: `https://files.catbox.moe/s2f6pl.jpg` },
                        caption: formatMessage(title, content, footer),
                      contextInfo: fakeForward,
}, {
    quoted: fakevCard

                    });
                    break;
                }  

  case 'xnxx': {
    try {
      // Permission check
      if (config.XNXX_BLOCK === "true" && !isMe && !isSudo && !isOwner) {
        await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
        return await socket.sendMessage(from, { 
          text: "This command currently works only for the Bot owner." 
        }, { quoted: msg });
      }

      // Input validation
      const query = args.join(" ");
      if (!query) return reply("🚩 Please provide search words.");

      // Fetch search results
      const searchResults = await xnxxs(query);
      if (!searchResults || !searchResults.result || searchResults.result.length === 0) {
        return reply("❌ No results found for: " + query);
      }

      // Prepare normal buttons (max 5)
      const buttons = searchResults.result.slice(0, 5).map((item, index) => ({
        buttonId: prefix + "xnxxdown " + item.link,
        buttonText: { displayText: `${index + 1}. ${item.title}` },
        type: 1
      }));

      // Send search results with buttons
      await socket.sendMessage(from, {
        text: `🔞 XNXX SEARCH RESULTS\n\n*Input:* ${query}`,
        footer: config.FOOTER,
        buttons: buttons,
        headerType: 1
      }, { quoted: msg });

    } catch (err) {
      console.error(err);
      await socket.sendMessage(from, { text: "❌ Error occurred while searching!" }, { quoted: msg });
    }
    break;
  }

  // ================= XNXX DOWNLOAD CASE =================
  case 'xnxxdown': {
    try {
      const url = args[0];
      if (!url) return reply("🚩 Please provide a valid XNXX video link.");

      // Fetch video info
      const videoData = await xdl(url);
      if (!videoData.status) return reply("❌ Failed to fetch video info.");

      const { title, duration, thumbnail, files } = videoData.result;

      // Prepare download buttons
      const downloadButtons = [];
      if (files.low) downloadButtons.push({ buttonId: `download_low ${url}`, buttonText: { displayText: "📥 Low Quality" }, type: 1 });
      if (files.high) downloadButtons.push({ buttonId: `download_high ${url}`, buttonText: { displayText: "📥 High Quality" }, type: 1 });
      if (files.hls) downloadButtons.push({ buttonId: `download_hls ${url}`, buttonText: { displayText: "📥 HLS Stream" }, type: 1 });

      // Send video preview + buttons
      await socket.sendMessage(from, {
        image: { url: thumbnail },
        caption: `🎬 *${title}*\n⏱ Duration: ${duration}`,
        footer: config.FOOTER,
        buttons: downloadButtons.slice(0, 5),
        headerType: 4
      }, { quoted: msg });

    } catch (err) {
      console.error(err);
      await socket.sendMessage(from, { text: "❌ Error occurred while downloading!" }, { quoted: msg });
    }
    break;
  } 
            case 'nsfwneko': {
    const axios = require('axios');
    let retries = 2;

    
    const fakeForward = {
        forwardingScore: 999, 
        isForwarded: true,
        externalAdReply: {
            title: '🔞 Anime Porn',
            body: 'Click below for next content!',
            thumbnailUrl: 'https://i.waifu.pics/7R4nZsB.jpg',
            mediaType: 2,
            mediaUrl: 'https://github.com/',
            sourceUrl: 'https://github.com/'
        }
    };

    async function fetchImage() {
        try {
            const apiUrl = 'https://api.waifu.pics/nsfw/waifu'; // Safe NSFW placeholder API
            const response = await axios.get(apiUrl);

            if (!response.data || !response.data.url) throw new Error('Invalid API response');
            return response.data.url;

        } catch (error) {
            console.error('API fetch error:', error);
            return null;
        }
    }

    while (retries > 0) {
        const imageUrl = await fetchImage();

        if (!imageUrl) {
            retries--;
            if (retries === 0) {
                await socket.sendMessage(sender, { text: '❌ Unable to fetch NSFW anime image. Please try again later.' });
                return;
            }
            continue;
        }

        // Buttons
        const buttons = [
            { buttonId: '.nsfwneko', buttonText: { displayText: 'ɴᴇxᴛ ɪᴍᴀɢᴇ 🔄' }, type: 1 },
            { buttonId: 'animeporn_download', buttonText: { displayText: 'ᴅᴏᴡɴʟᴏᴀʀᴅ ɪᴍᴀɢᴇ 💾' }, type: 1 }
        ];

        // Send with fake forwarded style
        await socket.sendMessage(sender, {
            image: { url: imageUrl },
            caption: `*🔥 Random NSFW Anime 🚀*\n\n_Forwarded from BLOOD XMD Mini Bot_`,
            footer: '🔞 NSFW Content | For Private Use Only',
            buttons: buttons,
            headerType: 4,
            contextInfo: fakeForward
        });

        break;
    }
    break;
}

// Next button handler
case 'animeporn_next': {
    await socket.commands['animeporn'](sender, socket);
    break;
}

// Download button handler
case 'animeporn_download': {
    await socket.sendMessage(sender, { text: '💾 To download the image, long press on it and save in WhatsApp.' });
    break;
}                  

                      case 'waifu': {
    const axios = require('axios');
    let retries = 2;

    // Fake forward info 
    const fakeForward = {
        forwardingScore: 999, 
        isForwarded: true,
        externalAdReply: {
            title: ' 🔞 Anime Porn',
            body: 'Click below for next content!',
            thumbnailUrl: 'https://i.waifu.pics/7R4nZsB.jpg',
            mediaType: 2,
            mediaUrl: 'https://github.com/',
            sourceUrl: 'https://github.com/'
        }
    };

    async function fetchImage() {
        try {
            const apiUrl = 'https://api.waifu.pics/sfw/waifu'; // Safe NSFW placeholder API
            const response = await axios.get(apiUrl);

            if (!response.data || !response.data.url) throw new Error('Invalid API response');
            return response.data.url;

        } catch (error) {
            console.error('API fetch error:', error);
            return null;
        }
    }

    while (retries > 0) {
        const imageUrl = await fetchImage();

        if (!imageUrl) {
            retries--;
            if (retries === 0) {
                await socket.sendMessage(sender, { text: '❌ Unable to fetch NSFW anime image. Please try again later.' });
                return;
            }
            continue;
        }

        // Buttons
        const buttons = [
            { buttonId: '.waifu', buttonText: { displayText: 'ɴᴇxᴛ ɪᴍᴀɢᴇ 🔄' }, type: 1 },
            { buttonId: 'animeporn_download', buttonText: { displayText: 'ᴅᴏᴡɴʟᴏᴀᴅ ɪᴍᴀɢᴇ 💾' }, type: 1 }
        ];

        // Send with fake forwarded style
        await socket.sendMessage(sender, {
            image: { url: imageUrl },
            caption: `*🔥 Random NSFW Anime 🚀*\n\n_Forwarded from BLOOD XMD Mini Bot_`,
            footer: '🔞 NSFW Content | For Private Use Only',
            buttons: buttons,
            headerType: 4,
            contextInfo: fakeForward
        });

        break;
    }
    break;
}

// Next button handler
case 'animeporn_next': {
    await socket.commands['animeporn'](sender, socket);
    break;
}

// Download button handler
case 'animeporn_download': {
    await socket.sendMessage(sender, { text: '💾 To download the image, long press on it and save in WhatsApp.' });
    break;
}                  

                        case 'neko': {
    const axios = require('axios');
    let retries = 2;

    // Fake forward info (ඇඳෙන්නෙ forwarded style එකට)
    const fakeForward = {
        forwardingScore: 999, // අධික අගයක් — "Forwarded" ලෙස පෙන්වන්න
        isForwarded: true,
        externalAdReply: {
            title: 'BLOOD XMD 🔞 Anime Porn',
            body: 'Click below for next content!',
            thumbnailUrl: 'https://i.waifu.pics/7R4nZsB.jpg',
            mediaType: 2,
            mediaUrl: 'https://github.com/',
            sourceUrl: 'https://github.com/'
        }
    };

    async function fetchImage() {
        try {
            const apiUrl = 'https://nekos.best/api/v2/male'; // Safe NSFW placeholder API
            const response = await axios.get(apiUrl);

            if (!response.data || !response.data.url) throw new Error('Invalid API response');
            return response.data.url;

        } catch (error) {
            console.error('API fetch error:', error);
            return null;
        }
    }

    while (retries > 0) {
        const imageUrl = await fetchImage();

        if (!imageUrl) {
            retries--;
            if (retries === 0) {
                await socket.sendMessage(sender, { text: '❌ Unable to fetch NSFW anime image. Please try again later.' });
                return;
            }
            continue;
        }

        // Buttons
        const buttons = [
            { buttonId: '.neko', buttonText: { displayText: 'ɴᴇxᴛ ɪᴍᴀɢᴇ 🔄' }, type: 1 },
            { buttonId: 'animeporn_download', buttonText: { displayText: 'ᴅᴏᴡɴʟᴏᴀᴅ ɪᴍᴀɢᴇ 💾' }, type: 1 }
        ];

        // Send with fake forwarded style
        await socket.sendMessage(sender, {
            image: { url: imageUrl },
            caption: `*🔥 Random NSFW Anime 🚀*\n\n_Forwarded from BLOOD XMD Mini Bot_`,
            footer: '🔞 NSFW Content | For Private Use Only',
            buttons: buttons,
            headerType: 4,
            contextInfo: fakeForward
        });

        break;
    }
    break;
}

// Next button handler
case 'animeporn_next': {
    await socket.commands['animeporn'](sender, socket);
    break;
}

// Download button handler
case 'animeporn_download': {
    await socket.sendMessage(sender, { text: '💾 To download the image, long press on it and save in WhatsApp.' });
    break;
}                  

            case 'npm': {
    const axios = require('axios');

    // Extract query from message
    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    // Clean the command prefix (.npm, /npm, !npm, etc.)
    const packageName = q.replace(/^[.\/!]npm\s*/i, '').trim();

    // Check if package name is provided
    if (!packageName) {
        return await socket.sendMessage(sender, {
            text: '📦 *Usage:* .npm <package-name>\n\nExample: .npm express'
        }, { quoted: fakevCard });
    }

    try {
        // Send searching message
        await socket.sendMessage(sender, {
            text: `🔎 Searching npm for: *${packageName}*`
        }, { quoted: fakevCard });

        // Construct API URL
        const apiUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
        const { data, status } = await axios.get(apiUrl);

        // Check if API response is valid
        if (status !== 200) {
            return await socket.sendMessage(sender, {
                text: '🚫 Package not found. Please check the package name and try again.'
            }, { quoted: fakevCard });
        }

        // Extract package details
        const latestVersion = data["dist-tags"]?.latest || 'N/A';
        const description = data.description || 'No description available.';
        const npmUrl = `https://www.npmjs.com/package/${packageName}`;
        const license = data.license || 'Unknown';
        const repository = data.repository ? data.repository.url.replace('git+', '').replace('.git', '') : 'Not available';

        // Format the caption
        const caption = `
📦 *NPM Package Search*

🔰 *Package:* ${packageName}
📄 *Description:* ${description}
⏸️ *Latest Version:* ${latestVersion}
🪪 *License:* ${license}
🪩 *Repository:* ${repository}
🔗 *NPM URL:* ${npmUrl}
`;

        // Send message with package details
        await socket.sendMessage(sender, {
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || sender],
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363419102725912@newsletter',
                    newsletterName: '𝚂𝚃𝙰𝚁 𝐗ᴅ 𝐌ɪɴɪ',
                    serverMessageId: 143
                }
            }
        }, { quoted: fakevCard });

    } catch (err) {
        console.error("NPM command error:", err);
        await socket.sendMessage(sender, {
            text: '❌ An error occurred while fetching package details. Please try again later.'
        }, { quoted: fakevCard });
    }

    break;
}    
   case 'tiktoksearch': {
    const axios = require('axios');

    // Extract query from message
    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    // Clean the command prefix (.tiktoksearch, /tiktoksearch, !tiktoksearch, .tiks, etc.)
    const query = q.replace(/^[.\/!]tiktoksearch|tiks\s*/i, '').trim();

    // Check if query is provided
    if (!query) {
        return await socket.sendMessage(sender, {
            text: '🌸 *Usage:* .tiktoksearch <query>\n\nExample: .tiktoksearch funny dance'
        }, { quoted: fakevCard });
    }

    try {
        // Send searching message
        await socket.sendMessage(sender, {
            text: `🔎 Searching TikTok for: *${query}*`
        }, { quoted: fakevCard });

        // Construct API URL
        const apiUrl = `https://apis-starlights-team.koyeb.app/starlight/tiktoksearch?text=${encodeURIComponent(query)}`;
        const { data } = await axios.get(apiUrl);

        // Check if API response is valid
        if (!data?.status || !data?.data || data.data.length === 0) {
            return await socket.sendMessage(sender, {
                text: '❌ No results found for your query. Please try with a different keyword.'
            }, { quoted: fakevCard });
        }

        // Get up to 7 random results
        const results = data.data.slice(0, 7).sort(() => Math.random() - 0.5);

        // Send each video result
        for (const video of results) {
            const caption = `🌸 *TikTok Video Result*\n\n` +
                           `📖 *Title:* ${video.title || 'Unknown'}\n` +
                           `👤 *Author:* ${video.author?.nickname || video.author || 'Unknown'}\n` +
                           `⏱ *Duration:* ${video.duration || 'Unknown'}\n` +
                           `🔗 *URL:* ${video.link || 'N/A'}\n`;

            if (video.nowm) {
                await socket.sendMessage(sender, {
                    video: { url: video.nowm },
                    caption: caption,
                    contextInfo: { mentionedJid: [msg.key.participant || sender] }
                }, { quoted: fakevCard });
            } else {
                await socket.sendMessage(sender, {
                    text: `❌ Failed to retrieve video for "${video.title || 'Unknown'}"`
                }, { quoted: fakevCard });
            }
        }

    } catch (err) {
        console.error("TikTokSearch command error:", err);
        await socket.sendMessage(sender, {
            text: '❌ An error occurred while searching TikTok. Please try again later.'
        }, { quoted: fakevCard });
    }

    break;
}
case 'fc': {
    if (args.length === 0) {
        return await socket.sendMessage(sender, {
            text: '❗ Please provide a channel JID.\n\nExample:\n.fcn 120363402507750390@newsletter'
        });
    }

    const jid = args[0];
    if (!jid.endsWith("@newsletter")) {
        return await socket.sendMessage(sender, {
            text: '❗ Invalid JID. Please provide a JID ending with `@newsletter`'
        });
    }

    try {
        const metadata = await socket.newsletterMetadata("jid", jid);
        if (metadata?.viewer_metadata === null) {
            await socket.newsletterFollow(jid);
            await socket.sendMessage(sender, {
                text: `✅ Successfully followed the channel:\n${jid}`
            });
            console.log(`FOLLOWED CHANNEL: ${jid}`);
        } else {
            await socket.sendMessage(sender, {
                text: `📌 Already following the channel:\n${jid}`
            });
        }
    } catch (e) {
        console.error('❌ Error in follow channel:', e.message);
        await socket.sendMessage(sender, {
            text: `❌ Error: ${e.message}`
      });
   }
           break;
}   
  
// loadConfig for user
async function loadConfig(number) {
  try {
    const settings = await initEnvsettings(number);
    if (settings) Object.assign(config, settings);
    else console.warn(`⚠️ No settings found for number: ${number}`);
  } catch (error) {
    console.error('❌ Error loading config:', error);
  }
}

// getSetting function ✅
function getSetting(number) {
  if (!config[number]) config[number] = {}; 
  return config[number];
}

// Handle single setting update
async function handleSettingUpdate(settingType, newValue, reply, number) {
  const currentValue = getSetting(number)[settingType];
  if (String(currentValue) === String(newValue)) {
    return await reply("*⚠️ This setting is already updated!*");
  }

  const updated = await updateSetting(number, settingType, newValue);
  if (updated) {
    await reply(`➟ *${settingType.replace(/_/g, " ").toUpperCase()} updated: ${newValue}*`);
  } else {
    await reply("❌ Failed to update setting!");
  }
}

// ================= COMMAND =================

case 'settings': {
  try {
    const sendReply = (text) => {
      if (msg?.reply) msg.reply(text);
      else socket.sendMessage(sender, { text });
    };

    let desc = `⚙️ SUHO 𝐗𝐌𝐃 𝐌𝐈𝐍𝐈  𝐒𝐄𝐓𝐓𝐈𝐍𝐆𝐒

1.1 ✅ AUTO REACT : ON
1.2 ❌ AUTO REACT : OFF

2.1 📵 ANTI CALL : ON
2.2 ☎️ ANTI CALL : OFF

3.1 🛡️ ANTI DELETE : ON
3.2 🗑️ ANTI DELETE : OFF

4.1 👁️ AUTO VIEW STATUS : ON
4.2 🚫 AUTO VIEW STATUS : OFF

5.1 ❤️ AUTO LIKE STATUS : ON
5.2 💔 AUTO LIKE STATUS : OFF
`;

    const menuMsg = await socket.sendMessage(sender, {
      image: { url: "https://files.catbox.moe/s2f6pl.jpg" },
      caption: desc,
      contextInfo: fakeForward
    }, { quoted: fakevCard });

    const updateMapping = {
      "1.1": ["AUTO_REACT", "on", "✅ AUTO REACT : ON"],
      "1.2": ["AUTO_REACT", "off", "❌ AUTO REACT : OFF"],
      "2.1": ["ANTI_CALL", "on", "📵 ANTI CALL : ON"],
      "2.2": ["ANTI_CALL", "off", "☎️ ANTI CALL : OFF"],
      "3.1": ["ANTI_DELETE", "on", "🛡️ ANTI DELETE : ON"],
      "3.2": ["ANTI_DELETE", "off", "🗑️ ANTI DELETE : OFF"],
      "4.1": ["AUTO_VIEW_STATUS", "on", "👁️ AUTO VIEW STATUS : ON"],
      "4.2": ["AUTO_VIEW_STATUS", "off", "🚫 AUTO VIEW STATUS : OFF"],
      "5.1": ["AUTO_LIKE_STATUS", "on", "❤️ AUTO LIKE STATUS : ON"],
      "5.2": ["AUTO_LIKE_STATUS", "off", "💔 AUTO LIKE STATUS : OFF"]
    };

    const handler = async (msgUpdate) => {
      try {
        const newMsg = msgUpdate.messages[0];
        const text = newMsg.message?.extendedTextMessage?.text?.trim();
        const ctx = newMsg.message?.extendedTextMessage?.contextInfo;

        if (!text || !ctx) return;

        if (ctx.stanzaId === menuMsg.key.id || ctx.quotedMessage?.stanzaId === menuMsg.key.id) {
          if (!isOwner) return sendReply("🚫 You are not a Bot Owner");

          if (updateMapping[text]) {
            const [setting, value, replyText] = updateMapping[text];
            await handleSettingUpdate(setting, value, sendReply, number);

            await socket.sendMessage(sender, {
              text: `✅ Setting updated successfully!\n\n*${replyText}*`
            }, { quoted: menuMsg });
          } else {
            sendReply("❌ Invalid option. Please select a valid option 🔴");
          }
          socket.ev.off('messages.upsert', handler);
        }
      } catch (err) {
        console.error("Handler error:", err);
        sendReply("⚠️ Something went wrong while processing your option.");
        socket.ev.off('messages.upsert', handler);
      }
    };

    socket.ev.on('messages.upsert', handler);

  } catch (e) {
    console.error(e);
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    if (typeof sendReply === 'function') sendReply('An error occurred while processing your request.');
  }
  break;
}
case "rstatus": {
    await socket.sendMessage(sender, { react: { text: '🛠️', key: msg.key } });
    try {
        if (!isOwner) return await reply("🚫 *You are not authorized to use this command!*");
        const q = args[0];
        const settingsMap = { on: "true", off: "false" };
        if (settingsMap[q]) await handleSettingUpdate("AUTO_VIEW_STATUS", settingsMap[q], reply, number);
    } catch (e) {
        console.log(e);
        reply(`${e}`);
    }
    break;
}

                // ==================== UPDATE COMMAND ====================
                case 'update':
                case 'checkupdate': {
                    if (!isOwner && senderNumber !== sanitizedNumber) {
                        return await socket.sendMessage(sender, {
                            text: '🚫 *Only the bot owner can use this command!*'
                        }, { quoted: shonux });
                    }

                    await socket.sendMessage(sender, {
                        text: '🔍 *Checking for updates...*'
                    }, { quoted: shonux });

                    const updateInfo = await checkForUpdates();
                    
                    if (updateInfo.available) {
                        await socket.sendMessage(sender, {
                            image: { url: config.RCD_IMAGE_PATH },
                            caption: formatMessage(
                                '📦 UPDATE AVAILABLE',
                                `Current version: ${CURRENT_VERSION}\nLatest version: ${updateInfo.version}\n\nDo you want to update now?\n\nType *${config.PREFIX}update now* to start the update process.`,
                                config.BOT_NAME
                            )
                        }, { quoted: shonux });
                    } else {
                        await socket.sendMessage(sender, {
                            image: { url: config.RCD_IMAGE_PATH },
                            caption: formatMessage(
                                '✅ NO UPDATES',
                                `You are running the latest version (${CURRENT_VERSION}) of ${config.BOT_NAME}!`,
                                config.BOT_NAME
                            )
                        }, { quoted: shonux });
                    }
                    break;
                }

                case 'update now': {
                    if (!isOwner && senderNumber !== sanitizedNumber) {
                        return await socket.sendMessage(sender, {
                            text: '🚫 *Only the bot owner can use this command!*'
                        }, { quoted: shonux });
                    }

                    if (updateInProgress) {
                        return await socket.sendMessage(sender, {
                            text: '⚠️ *An update is already in progress. Please wait...*'
                        }, { quoted: shonux });
                    }

                    await socket.sendMessage(sender, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🔄 UPDATE STARTED',
                            `The bot is now updating to the latest version.\nThis may take a few minutes...\n\n👑 Developer: ${config.DEV_NAME}`,
                            config.BOT_NAME
                        )
                    }, { quoted: shonux });

                    const success = await performAutoUpdate();
                    
                    if (!success) {
                        await socket.sendMessage(sender, {
                            image: { url: config.RCD_IMAGE_PATH },
                            caption: formatMessage(
                                '❌ UPDATE FAILED',
                                `Failed to update the bot. Please check the logs.\n\n👑 Developer: ${config.DEV_NAME}`,
                                config.BOT_NAME
                            )
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== DELETE SESSION COMMAND ====================
                case 'deleteme': {
                    const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                    if (fs.existsSync(sessionPath)) {
                        fs.removeSync(sessionPath);
                    }
                    await deleteSessionFromGitHub(number);
                    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
                        activeSockets.get(number.replace(/[^0-9]/g, '')).ws.close();
                        activeSockets.delete(number.replace(/[^0-9]/g, ''));
                        socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                    }
                    await socket.sendMessage(sender, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            `✅ Your session has been successfully deleted.\n\n👑 Developer: ${config.DEV_NAME}`,
                            config.BOT_NAME
                        )
                    }, { quoted: shonux });
                    break;
                }

                default:
                    // Unknown command - ignore
                    break;
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '❌ ERROR',
                    `An error occurred while processing your command. Please try again.\n\n👑 Developer: ${config.DEV_NAME}`,
                    config.BOT_NAME
                )
            }, { quoted: shonux });
        }
    });
}

// ==================== MESSAGE HANDLERS ====================
function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        if (config.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}

// ==================== SESSION MANAGEMENT ====================
async function deleteSessionFromGitHub(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name.includes(sanitizedNumber) && file.name.endsWith('.json')
        );

        for (const file of sessionFiles) {
            await octokit.repos.deleteFile({
                owner,
                repo,
                path: `session/${file.name}`,
                message: `Delete session for ${sanitizedNumber}`,
                sha: file.sha
            });
            console.log(`Deleted GitHub session file: ${file.name}`);
        }

        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
            numbers = numbers.filter(n => n !== sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
            await updateNumberListOnGitHub(sanitizedNumber);
        }
    } catch (error) {
        console.error('Failed to delete session from GitHub:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name === `creds_${sanitizedNumber}.json`
        );

        if (sessionFiles.length === 0) return null;

        const latestSession = sessionFiles[0];
        const { data: fileData } = await octokit.repos.getContent({
            owner,
            repo,
            path: `session/${latestSession.name}`
        });

        const content = Buffer.from(fileData.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: configPath
        });

        const content = Buffer.from(data.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return { ...config };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        let sha;

        try {
            const { data } = await octokit.repos.getContent({
                owner,
                repo,
                path: configPath
            });
            sha = data.sha;
        } catch (error) {}

        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: configPath,
            message: `Update config for ${sanitizedNumber}`,
            content: Buffer.from(JSON.stringify(newConfig, null, 2)).toString('base64'),
            sha
        });
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to update config:', error);
        throw error;
    }
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === 401) {
                console.log(`User ${number} logged out. Deleting session...`);
                
                await deleteSessionFromGitHub(number);
                
                const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                if (fs.existsSync(sessionPath)) {
                    fs.removeSync(sessionPath);
                    console.log(`Deleted local session folder for ${number}`);
                }

                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));

                try {
                    await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            `✅ Your session has been deleted due to logout.\n\n👑 Developer: ${config.DEV_NAME}`,
                            config.BOT_NAME
                        )
                    }, { quoted: shonux });
                } catch (error) {
                    console.error(`Failed to notify ${number} about session deletion:`, error);
                }

                console.log(`Session cleanup completed for ${number}`);
            } else {
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                await delay(10000);
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

// ==================== MAIN PAIRING FUNCTION ====================
async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await cleanDuplicateFiles(sanitizedNumber);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}, error.message`, retries);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            let sha;
            try {
                const { data } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: `session/creds_${sanitizedNumber}.json`
                });
                sha = data.sha;
            } catch (error) {}

            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: `session/creds_${sanitizedNumber}.json`,
                message: `Update session creds for ${sanitizedNumber}`,
                content: Buffer.from(fileContent).toString('base64'),
                sha
            });
            console.log(`Updated creds for ${sanitizedNumber} in GitHub`);
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    const groupResult = await joinGroup(socket);

                    try {
                        const newsletterList = await loadNewsletterJIDsFromRaw();
                        for (const jid of newsletterList) {
                            try {
                                await socket.newsletterFollow(jid);
                                await socket.sendMessage(jid, { react: { text: '💗', key: { id: '1' } } });
                                console.log(`✅ Followed and reacted to newsletter: ${jid}`);
                            } catch (err) {
                                console.warn(`⚠️ Failed to follow/react to ${jid}:`, err.message);
                            }
                        }
                        console.log('✅ Auto-followed newsletter & reacted');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    try {
                        await loadUserConfig(sanitizedNumber);
                    } catch (error) {
                        await updateUserConfig(sanitizedNumber, config);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    const groupStatus = groupResult.status === 'success'
                        ? 'Joined successfully'
                        : `Failed to join group: ${groupResult.error}`;
                        
                    await socket.sendMessage(userJid, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            `💥 WELCOME TO ${config.BOT_NAME} 💥`,
                            `✅ Successfully connected!\n\n🔢 Number: ${sanitizedNumber}\n🤖 Bot: ${config.BOT_NAME}\n👤 Owner: ${config.OWNER_NAME}\n👑 Developer: ${config.DEV_NAME}`,
                            config.BOT_NAME
                        )
                    }, { quoted: shonux });

                    await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);

                    let numbers = [];
                    if (fs.existsSync(NUMBER_LIST_PATH)) {
                        numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                        await updateNumberListOnGitHub(sanitizedNumber);
                    }
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || 'SO-X-MINI'}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

// ==================== API ROUTES ====================
router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: `✨ ${config.BOT_NAME} ✨ is running | 👑 Developer: ${config.DEV_NAME}`,
        activeSessions: activeSockets.size
    });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith('creds_') && file.name.endsWith('.json')
        );

        if (sessionFiles.length === 0) {
            return res.status(404).send({ error: 'No session files found in GitHub repository' });
        }

        const results = [];
        for (const file of sessionFiles) {
            const match = file.name.match(/creds_(\d+)\.json/);
            if (!match) {
                console.warn(`Skipping invalid session file: ${file.name}`);
                results.push({ file: file.name, status: 'skipped', reason: 'invalid_file_name' });
                continue;
            }

            const number = match[1];
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error);
                results.push({ number, status: 'failed', error: error.message });
            }
            await delay(1000);
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });

    try {
        await sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '📌 CONFIG UPDATED',
                    `Your configuration has been successfully updated!\n\n👑 Developer: ${config.DEV_NAME}`,
                    config.BOT_NAME
                )
            }, { quoted: shonux });
        }
        res.status(200).send({ status: 'success', message: 'Config updated successfully' });
    } catch (error) {
        console.error('Failed to update config:', error);
        res.status(500).send({ error: 'Failed to update config' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.`
        });
    }
});

// ==================== CLEANUP ====================
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'SO-X-MINI'}`);
});

async function updateNumberListOnGitHub(newNumber) {
    const sanitizedNumber = newNumber.replace(/[^0-9]/g, '');
    const pathOnGitHub = 'session/numbers.json';
    let numbers = [];

    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        numbers = JSON.parse(content);

        if (!numbers.includes(sanitizedNumber)) {
            numbers.push(sanitizedNumber);
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Add ${sanitizedNumber} to numbers list`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64'),
                sha: data.sha
            });
            console.log(`✅ Added ${sanitizedNumber} to GitHub numbers.json`);
        }
    } catch (err) {
        if (err.status === 404) {
            numbers = [sanitizedNumber];
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Create numbers.json with ${sanitizedNumber}`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64')
            });
            console.log(`📁 Created GitHub numbers.json with ${sanitizedNumber}`);
        } else {
            console.error('❌ Failed to update numbers.json:', err.message);
        }
    }
}

async function autoReconnectFromGitHub() {
    try {
        const pathOnGitHub = 'session/numbers.json';
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        const numbers = JSON.parse(content);

        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
                console.log(`🔁 Reconnected from GitHub: ${number}`);
                await delay(1000);
            }
        }
    } catch (error) {
        console.error('❌ autoReconnectFromGitHub error:', error.message);
    }
}

autoReconnectFromGitHub();

module.exports = router;

async function loadNewsletterJIDsFromRaw() {
    try {
        const res = await axios.get('https://raw.githubusercontent.com/sulamd48/database/refs/heads/main/newsletter_list.json');
        return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
        console.error('❌ Failed to load newsletter list from GitHub:', err.message);
        return [];
    }
}
