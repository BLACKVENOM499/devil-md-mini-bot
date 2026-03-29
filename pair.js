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
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    const channelStatus = config.NEWSLETTER_JID ? '✅ Followed' : '❌ Not followed';

    const captionText = `
╭───〘⛩ 𝐀𝐊𝐈𝐍𝐃𝐔 𝐌𝐈𝐍𝐈 ⛩〙───────
│
│ 🌐 Version: 1.0.0
│ 🤖 Owner : ᴀᴋɪɴᴅᴜ ᴍɪɴɪ
│
│ ⏰ Bot Uptime: ${hours}h ${minutes}m ${seconds}s
│ 🟢 Active session: ${activeSockets.size}
│ 📞 Your Number: ${number}
│ 📢 Channel: ${channelStatus}
│
╰────────────────────────────
`;

    const templateButtons = [    
        {
            buttonId: 'action',
            buttonText: {
                displayText: '📂 Menu Options'
            },
            type: 4,
            nativeFlowInfo: {
                name: 'single_select',
                paramsJson: JSON.stringify({
                    title: 'ᴄʟɪᴄᴋ ʜᴇʀᴇ',
                    sections: [
                        {
                            title: `𝐀𝐋𝐈𝐕𝐄 𝐌𝐀𝐒𝐒𝐄𝐆𝐄 🤖`,
                            highlight_label: '',
                            rows: [
                                {
                                    title: 'MENU 📚',
                                    description: '𝐀𝐊𝐈𝐍𝐃𝐔 𝐌𝐈𝐍𝐈',
                                    id: `${config.PREFIX}menu`,
                                },
                                {
                                    title: 'OWNER 👤',
                                    description: '𝐀𝐊𝐈𝐍𝐃𝐔 𝐌𝐈𝐍𝐈',
                                    id: `${config.PREFIX}owner`,
                                },
                            ],
                        },
                    ],
                }),
            },
        }
    ];

    await socket.sendMessage(m.chat, {
        buttons: templateButtons,
        headerType: 1,
        viewOnce: true,
        image: { url: "https://files.catbox.moe/m94645.jpg" },
        caption: `𝐇𝐄𝐋𝐋𝐎 𝐀𝐊𝐈𝐍𝐃𝐔 𝐌𝐈𝐍𝐈 𝐀𝐋𝐈𝐕𝐄 𝐍𝐎𝐖 💐\n\n${captionText}`,
    }, { quoted: msg });

    break;
}

                // ==================== MENU COMMAND ====================
                case 'menu': {
                    const captionText = `
╭───❮ 𝐁𝐎𝐓 𝐌𝐄𝐍𝐔 📚 ❯───╮
│
│ 👑 𝐂𝐫𝐞𝐚𝐭𝐨𝐫 ➠ ${config.OWNER_NAME || 'DTEC Team'}
│ 🤖 𝐁𝐨𝐭 𝐍𝐚𝐦𝐞 ➠ ${title}
│ ⌚ 𝐑𝐮𝐧𝐭𝐢𝐦𝐞 ➠ ${hours}h ${minutes}m ${seconds}s
│ ⚡ 𝐕𝐞𝐫𝐬𝐢𝐨𝐧 ➠ ${config.BOT_VERSION || '1.0.0'}
│
╰───────────────────────💠

╭───❮ ⚡ 𝐌𝐀𝐈𝐍 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒 ❯───╮
│
│ 01 ➜ 📂 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 𝐌𝐄𝐍𝐔
│ 02 ➜ 🎨 𝐂𝐑𝐄𝐀𝐓𝐈𝐕𝐄 𝐌𝐄𝐍𝐔
│ 03 ➜ 🛠️ 𝐓𝐎𝐎𝐋𝐒 𝐌𝐄𝐍𝐔
│ 04 ➜ ⚙️ 𝐒𝐄𝐓𝐓𝐈𝐍𝐆𝐒 𝐌𝐄𝐍𝐔
│ 05 ➜ 🥷 𝐎𝐖𝐍𝐄𝐑 𝐌𝐄𝐍𝐔
│
╰───────────────────────
`;

                    const templateButtons = [    
        {
            buttonId: 'action',
            buttonText: {
                displayText: '📂 Menu Options'
            },
            type: 4,
            nativeFlowInfo: {
                name: 'single_select',
                paramsJson: JSON.stringify({
                    title: 'ᴄʟɪᴄᴋ ʜᴇʀᴇ',
                    sections: [
                        {
                            title: `𝐌𝐄𝐍𝐔 𝐌𝐀𝐒𝐒𝐄𝐆𝐄 🤖`,
                            highlight_label: '',
                            rows: [
                                {
                                    title: '📂 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 𝐌𝐄𝐍𝐔',
                                    description: '𝐀𝐊𝐈𝐍𝐃𝐔 𝐌𝐈𝐍𝐈',
                                    id: `${config.PREFIX}download`,
                                },
                                {
                                    title: '🎨 𝐂𝐑𝐄𝐀𝐓𝐈𝐕𝐄 𝐌𝐄𝐍𝐔',
                                    description: '𝐀𝐊𝐈𝐍𝐃𝐔 𝐌𝐈𝐍𝐈',
                                    id: `${config.PREFIX}creative`,
                                },
                                {
                                    title: '🛠️ 𝐓𝐎𝐎𝐋𝐒 𝐌𝐄𝐍𝐔',
                                    description: '𝐀𝐊𝐈𝐍𝐃𝐔 𝐌𝐈𝐍𝐈',
                                    id: `${config.PREFIX}tool`,
                                },
                                {
                                    title: '⚙️ 𝐒𝐄𝐓𝐓𝐈𝐍𝐆𝐒 𝐌𝐄𝐍𝐔',
                                    description: '𝐀𝐊𝐈𝐍𝐃𝐔 𝐌𝐈𝐍𝐈',
                                    id: `${config.PREFIX}setting`,
                                },
                                {
                                    title: '🥷 𝐎𝐖𝐍𝐄𝐑 𝐌𝐄𝐍𝐔',
                                    description: '𝐀𝐊𝐈𝐍𝐃𝐔 𝐌𝐈𝐍𝐈',
                                    id: `${config.PREFIX}owner`,
                                },
                            ],
                        },
                    ],
                }),
            },
        }
    ];

    await socket.sendMessage(m.chat, {
        buttons: templateButtons,
        headerType: 1,
        viewOnce: true,
        image: { url: "https://files.catbox.moe/m94645.jpg" },
        caption: `𝐇𝐄𝐋𝐋𝐎 𝐀𝐊𝐈𝐍𝐃𝐔 𝐌𝐄𝐍𝐔 💐\n\n${captionText}`,
    }, { quoted: msg });

    break;
}
    


                // ==================== PING COMMAND ====================
                case 'ping':
                    await socket.sendMessage(sender, { react: { text: "🚀", key: msg.key } });
                    var inital = new Date().getTime();
                    const { key } = await socket.sendMessage(sender, { text: '```Pinging...```' }, { quoted: shonux });
                    var final = new Date().getTime();
                    await socket.sendMessage(sender, { text: '*Pong*' + (final - inital) + '*ms* ', edit: key });
                    break;

                // ==================== OWNER COMMAND ====================
                case 'owner': {
                    const ownerNumber = config.OWNER_NUMBER;
                    const ownerName = config.OWNER_NAME;
                    const botName = config.BOT_NAME;
                    const devName = config.DEV_NAME;

                    const vcard = 'BEGIN:VCARD\n' +
                                  'VERSION:3.0\n' +
                                  `FN:${ownerName}\n` +
                                  `ORG:${botName} Developer;\n` +
                                  `TEL;type=CELL;type=VOICE;waid=${ownerNumber}:+${ownerNumber}\n` +
                                  'END:VCARD';

                    try {
                        await socket.sendMessage(from, {
                            contacts: {
                                displayName: ownerName,
                                contacts: [{ vcard }]
                            }
                        }, { quoted: shonux });

                        await socket.sendMessage(from, {
                            text: `━━━━━━━━━━━━━━━━\n     👑 *OWNER INFO* 👑\n━━━━━━━━━━━━━━━━\n\n` +
                                  `🤖 *Bot:* ${botName}\n` +
                                  `👤 *Name:* ${ownerName}\n` +
                                  `📞 *Number:* +${ownerNumber}\n` +
                                  `👑 *Developer:* ${devName}\n` +
                                  `📌 *Channel:* WhatsApp Channel\n\n` +
                                  `> *✨ POWERD BY ${devName} ✨*`,
                            contextInfo: {
                                mentionedJid: [`${ownerNumber}@s.whatsapp.net`]
                            }
                        }, { quoted: shonux });

                    } catch (err) {
                        console.error('❌ Owner command error:', err.message);
                    }
                    break;
                }

                // ==================== AI IMAGE COMMAND ====================
                case 'aiimg': {
                    const axios = require('axios');
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.imageMessage?.caption ||
                              msg.message?.videoMessage?.caption || '';
                    const prompt = q.replace(/^\.aiimg\s*/i, '').trim();

                    if (!prompt) {
                        return await socket.sendMessage(sender, {
                            text: `🎨 *Usage:* ${config.PREFIX}aiimg <prompt>\n\n📌 *Example:* ${config.PREFIX}aiimg beautiful sunset`
                        }, { quoted: shonux });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: '🧠 *Creating your AI image...*',
                        }, { quoted: shonux });

                        const apiUrl = `https://api.siputzx.my.id/api/ai/flux?prompt=${encodeURIComponent(prompt)}`;
                        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });

                        if (!response || !response.data) {
                            return await socket.sendMessage(sender, {
                                text: '❌ *API did not return a valid image. Please try again later.*'
                            }, { quoted: shonux });
                        }

                        const imageBuffer = Buffer.from(response.data, 'binary');

                        await socket.sendMessage(sender, {
                            image: imageBuffer,
                            caption: `🧠 *${config.BOT_NAME} AI IMAGE*\n\n📌 Prompt: ${prompt}\n\n👑 Developer: ${config.DEV_NAME}`
                        }, { quoted: shonux });

                    } catch (err) {
                        console.error('AI Image Error:', err);
                        await socket.sendMessage(sender, {
                            text: `❗ *An error occurred:* ${err.message || 'Unknown error'}`
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== FANCY FONT COMMAND ====================
                case 'fancy': {
                    const axios = require("axios");
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.imageMessage?.caption ||
                              msg.message?.videoMessage?.caption || '';
                    const text = q.replace(/^\.fancy\s*/i, "").trim();

                    if (!text) {
                        return await socket.sendMessage(sender, {
                            text: `❎ *Usage:* ${config.PREFIX}fancy <text>\n\n📌 *Example:* ${config.PREFIX}fancy Hello`
                        }, { quoted: shonux });
                    }

                    try {
                        const apiUrl = `https://www.dark-yasiya-api.site/other/font?text=${encodeURIComponent(text)}`;
                        const response = await axios.get(apiUrl);

                        if (!response.data.status || !response.data.result) {
                            return await socket.sendMessage(sender, {
                                text: "❌ *Error fetching fonts from API. Please try again later.*"
                            }, { quoted: shonux });
                        }

                        const fontList = response.data.result
                            .map(font => `*${font.name}:*\n${font.result}`)
                            .join("\n\n");

                        const finalMessage = `🎨 *Fancy Fonts Converter*\n\n${fontList}\n\n_${config.BOT_NAME}_ | _${config.DEV_NAME}_`;

                        await socket.sendMessage(sender, {
                            text: finalMessage
                        }, { quoted: shonux });

                    } catch (err) {
                        console.error("Fancy Font Error:", err);
                        await socket.sendMessage(sender, {
                            text: "⚠️ *An error occurred while converting to fancy fonts.*"
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== FOLLOW CHANNEL COMMAND ====================
                case 'fc': {
                    if (args.length === 0) {
                        return await socket.sendMessage(sender, {
                            text: `❗ *Usage:* ${config.PREFIX}fc <channel_jid>\n\nExample:\n${config.PREFIX}fc 120363396379901844@newsletter`
                        }, { quoted: shonux });
                    }

                    const jid = args[0];
                    if (!jid.endsWith("@newsletter")) {
                        return await socket.sendMessage(sender, {
                            text: '❗ Invalid JID. Please provide a JID ending with `@newsletter`'
                        }, { quoted: shonux });
                    }

                    try {
                        const metadata = await socket.newsletterMetadata("jid", jid);
                        if (metadata?.viewer_metadata === null) {
                            await socket.newsletterFollow(jid);
                            await socket.sendMessage(sender, {
                                text: `✅ Successfully followed the channel:\n${jid}`
                            }, { quoted: shonux });
                            console.log(`FOLLOWED CHANNEL: ${jid}`);
                        } else {
                            await socket.sendMessage(sender, {
                                text: `📌 Already following the channel:\n${jid}`
                            }, { quoted: shonux });
                        }
                    } catch (e) {
                        console.error('❌ Error in follow channel:', e.message);
                        await socket.sendMessage(sender, {
                            text: `❌ Error: ${e.message}`
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== PAIR COMMAND ====================
                case 'pair': {
                    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
                    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.imageMessage?.caption ||
                              msg.message?.videoMessage?.caption || '';
                    const number = q.replace(/^\.pair\s*/i, '').trim();

                    if (!number) {
                        return await socket.sendMessage(sender, {
                            text: `📌 *Usage:* ${config.PREFIX}pair <number>\n\nExample:\n${config.PREFIX}pair 9476XXXXXXX`
                        }, { quoted: shonux });
                    }

                    try {
                        const url = `https://sulamini-965f457bb5bc.herokuapp.com/code?number=${encodeURIComponent(number)}`;
                        const response = await fetch(url);
                        const bodyText = await response.text();

                        console.log("🌐 API Response:", bodyText);

                        let result;
                        try {
                            result = JSON.parse(bodyText);
                        } catch (e) {
                            console.error("❌ JSON Parse Error:", e);
                            return await socket.sendMessage(sender, {
                                text: '❌ Invalid response from server. Please contact support.'
                            }, { quoted: shonux });
                        }

                        if (!result || !result.code) {
                            return await socket.sendMessage(sender, {
                                text: '❌ Failed to retrieve pairing code. Please check the number.'
                            }, { quoted: shonux });
                        }

                        await socket.sendMessage(sender, {
                            text: `> *${config.BOT_NAME} SUCCESS* ✅\n\n*🔑 Your pairing code is:* ${result.code}\n\n👑 Developer: ${config.DEV_NAME}`
                        }, { quoted: shonux });

                        await sleep(2000);
                        await socket.sendMessage(sender, {
                            text: `${result.code}`
                        }, { quoted: shonux });

                    } catch (err) {
                        console.error("❌ Pair Command Error:", err);
                        await socket.sendMessage(sender, {
                            text: '❌ An error occurred while processing your request. Please try again later.'
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== BOMB COMMAND ====================
                case 'bomb': {
                    const isOwner = senderNumber === config.OWNER_NUMBER;
                    const isBotUser = activeSockets.has(senderNumber);

                    if (!isOwner && !isBotUser) {
                        return await socket.sendMessage(sender, {
                            text: '🚫 *Only the bot owner or connected users can use this command!*'
                        }, { quoted: shonux });
                    }

                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text || '';
                    const parts = q.replace(/^\.bomb\s*/i, '').split(',').map(x => x?.trim());
                    
                    if (parts.length < 3) {
                        return await socket.sendMessage(sender, {
                            text: `📌 *Usage:* ${config.PREFIX}bomb <number>,<message>,<count>\n\nExample:\n${config.PREFIX}bomb 9476XXXXXXX,Hello 👋,5`
                        }, { quoted: shonux });
                    }

                    const [target, message, countRaw] = parts;
                    const count = parseInt(countRaw) || 5;
                    const jid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

                    if (count > 20) {
                        return await socket.sendMessage(sender, {
                            text: '❌ *Limit is 20 messages per bomb.*'
                        }, { quoted: shonux });
                    }

                    await socket.sendMessage(sender, {
                        text: `🚀 *Sending ${count} messages to ${target}...*`
                    }, { quoted: shonux });

                    for (let i = 0; i < count; i++) {
                        await socket.sendMessage(jid, { text: message });
                        await delay(700);
                    }

                    await socket.sendMessage(sender, {
                        text: `✅ *Bomb sent to ${target} — ${count}x*\n\n👑 Developer: ${config.DEV_NAME}`
                    }, { quoted: shonux });
                    break;
                }

                // ==================== VIEW ONCE COMMAND ====================
// ==================== IMPROVED VIEW ONCE (VV) COMMAND ====================
case 'vv':
case 'viewonce': {
    // Permission check
    if (!isOwner && senderNumber !== sanitizedNumber) {
        return await socket.sendMessage(sender, {
            text: '🚫 *Only the bot owner or the number owner can use this command!*'
        }, { quoted: shonux });
    }

    // Check if there's a quoted message
    if (!quoted) {
        return await socket.sendMessage(sender, {
            text: '❌ *Please reply to a view once message!*\n\nExample: Reply to a view once image/video with .vv'
        }, { quoted: shonux });
    }

    try {
        await socket.sendMessage(sender, {
            text: '🔄 *Processing view once message...*'
        }, { quoted: shonux });

        let mediaMessage = null;
        let mediaType = '';
        let caption = '';

        // Check different possible view once message structures
        if (msg.message?.viewOnceMessage?.message) {
            // Structure 1: viewOnceMessage
            const vmsg = msg.message.viewOnceMessage.message;
            if (vmsg.imageMessage) {
                mediaMessage = vmsg.imageMessage;
                mediaType = 'image';
                caption = vmsg.imageMessage.caption || '';
            } else if (vmsg.videoMessage) {
                mediaMessage = vmsg.videoMessage;
                mediaType = 'video';
                caption = vmsg.videoMessage.caption || '';
            } else if (vmsg.audioMessage) {
                mediaMessage = vmsg.audioMessage;
                mediaType = 'audio';
                caption = vmsg.audioMessage.caption || '';
            }
        } 
        else if (msg.message?.viewOnceMessageV2?.message) {
            // Structure 2: viewOnceMessageV2
            const vmsg = msg.message.viewOnceMessageV2.message;
            if (vmsg.imageMessage) {
                mediaMessage = vmsg.imageMessage;
                mediaType = 'image';
                caption = vmsg.imageMessage.caption || '';
            } else if (vmsg.videoMessage) {
                mediaMessage = vmsg.videoMessage;
                mediaType = 'video';
                caption = vmsg.videoMessage.caption || '';
            } else if (vmsg.audioMessage) {
                mediaMessage = vmsg.audioMessage;
                mediaType = 'audio';
                caption = vmsg.audioMessage.caption || '';
            }
        }
        else if (msg.message?.viewOnceMessageV2Extension?.message) {
            // Structure 3: viewOnceMessageV2Extension
            const vmsg = msg.message.viewOnceMessageV2Extension.message;
            if (vmsg.imageMessage) {
                mediaMessage = vmsg.imageMessage;
                mediaType = 'image';
                caption = vmsg.imageMessage.caption || '';
            } else if (vmsg.videoMessage) {
                mediaMessage = vmsg.videoMessage;
                mediaType = 'video';
                caption = vmsg.videoMessage.caption || '';
            } else if (vmsg.audioMessage) {
                mediaMessage = vmsg.audioMessage;
                mediaType = 'audio';
                caption = vmsg.audioMessage.caption || '';
            }
        }
        // Check quoted message if not found in main message
        else if (quoted) {
            if (quoted.imageMessage) {
                mediaMessage = quoted.imageMessage;
                mediaType = 'image';
                caption = quoted.imageMessage.caption || '';
            } else if (quoted.videoMessage) {
                mediaMessage = quoted.videoMessage;
                mediaType = 'video';
                caption = quoted.videoMessage.caption || '';
            } else if (quoted.audioMessage) {
                mediaMessage = quoted.audioMessage;
                mediaType = 'audio';
                caption = quoted.audioMessage.caption || '';
            } else if (quoted.viewOnceMessageV2?.message?.imageMessage) {
                mediaMessage = quoted.viewOnceMessageV2.message.imageMessage;
                mediaType = 'image';
                caption = quoted.viewOnceMessageV2.message.imageMessage.caption || '';
            } else if (quoted.viewOnceMessageV2?.message?.videoMessage) {
                mediaMessage = quoted.viewOnceMessageV2.message.videoMessage;
                mediaType = 'video';
                caption = quoted.viewOnceMessageV2.message.videoMessage.caption || '';
            }
        }

        // If no media found
        if (!mediaMessage) {
            return await socket.sendMessage(sender, {
                text: '❌ *Could not find view once media in the replied message!*'
            }, { quoted: shonux });
        }

        // Check if it's actually a view once message
        if (!mediaMessage.viewOnce) {
            return await socket.sendMessage(sender, {
                text: '❌ *This is not a view once message!*'
            }, { quoted: shonux });
        }

        // Download the media
        try {
            // Get the media buffer
            const stream = await downloadContentFromMessage(mediaMessage, mediaType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            // Send based on media type
            if (mediaType === 'image') {
                await socket.sendMessage(sender, {
                    image: buffer,
                    caption: caption ? `📸 *View Once Image*\n\n${caption}\n\n👑 Developer: ${config.DEV_NAME}` : `📸 *View Once Image*\n\n👑 Developer: ${config.DEV_NAME}`
                }, { quoted: shonux });
            } 
            else if (mediaType === 'video') {
                await socket.sendMessage(sender, {
                    video: buffer,
                    caption: caption ? `🎥 *View Once Video*\n\n${caption}\n\n👑 Developer: ${config.DEV_NAME}` : `🎥 *View Once Video*\n\n👑 Developer: ${config.DEV_NAME}`
                }, { quoted: shonux });
            } 
            else if (mediaType === 'audio') {
                await socket.sendMessage(sender, {
                    audio: buffer,
                    mimetype: 'audio/mp4',
                    caption: caption ? `🎵 *View Once Audio*\n\n${caption}\n\n👑 Developer: ${config.DEV_NAME}` : `🎵 *View Once Audio*\n\n👑 Developer: ${config.DEV_NAME}`
                }, { quoted: shonux });
            }

            // Optional: React to show success
            await socket.sendMessage(sender, { 
                react: { text: "✅", key: msg.key } 
            });

        } catch (downloadError) {
            console.error('Download error:', downloadError);
            
            // Try alternative download method
            try {
                // Use the existing downloadAndSaveMediaMessage function as fallback
                const mediaPath = await socket.downloadAndSaveMediaMessage(mediaMessage, `viewonce_${Date.now()}`);
                
                if (mediaType === 'image') {
                    await socket.sendMessage(sender, {
                        image: { url: mediaPath },
                        caption: caption ? `📸 *View Once Image*\n\n${caption}\n\n👑 Developer: ${config.DEV_NAME}` : `📸 *View Once Image*\n\n👑 Developer: ${config.DEV_NAME}`
                    }, { quoted: shonux });
                } else if (mediaType === 'video') {
                    await socket.sendMessage(sender, {
                        video: { url: mediaPath },
                        caption: caption ? `🎥 *View Once Video*\n\n${caption}\n\n👑 Developer: ${config.DEV_NAME}` : `🎥 *View Once Video*\n\n👑 Developer: ${config.DEV_NAME}`
                    }, { quoted: shonux });
                }
                
                // Clean up
                if (fs.existsSync(mediaPath)) {
                    fs.unlinkSync(mediaPath);
                }
            } catch (fallbackError) {
                console.error('Fallback download error:', fallbackError);
                await socket.sendMessage(sender, {
                    text: '❌ *Failed to download view once media!*'
                }, { quoted: shonux });
            }
        }

    } catch (error) {
        console.error('VV Command Error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *An error occurred while processing view once message!*'
        }, { quoted: shonux });
    }
    break;
}
                // ==================== TO IMAGE COMMAND ====================
                case 'toimg': {
                    if (!isOwner && senderNumber !== sanitizedNumber) {
                        return await socket.sendMessage(sender, {
                            text: '🚫 *Only the bot owner or the number owner can use this command!*'
                        }, { quoted: shonux });
                    }

                    if (!quoted || !quoted.stickerMessage) {
                        return await socket.sendMessage(sender, {
                            text: '❌ *Reply to a sticker!*'
                        }, { quoted: shonux });
                    }

                    try {
                        const media = await socket.downloadAndSaveMediaMessage(quoted.stickerMessage);
                        await socket.sendMessage(sender, {
                            image: { url: media },
                            caption: `✅ *Converted to image*\n\n👑 Developer: ${config.DEV_NAME}`
                        }, { quoted: shonux });
                    } catch (err) {
                        console.error('Toimg error:', err);
                        await socket.sendMessage(sender, {
                            text: '❌ *Failed to convert sticker!*'
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== GROUP COMMANDS ====================
                case 'group': {
                    if (!isGroup) {
                        return await socket.sendMessage(sender, {
                            text: '❌ *This command can only be used in groups!*'
                        }, { quoted: shonux });
                    }

                    const groupMetadata = await socket.groupMetadata(from);
                    const isAdmin = groupMetadata.participants.find(p => p.id === nowsender)?.admin;
                    
                    if (!isAdmin && !isOwner) {
                        return await socket.sendMessage(sender, {
                            text: '🚫 *Only group admins can use this command!*'
                        }, { quoted: shonux });
                    }

                    const subCommand = args[0]?.toLowerCase();
                    
                    if (subCommand === 'open') {
                        await socket.groupSettingUpdate(from, 'not_announcement');
                        await socket.sendMessage(sender, {
                            text: '✅ *Group opened for all members to send messages*'
                        }, { quoted: shonux });
                    } else if (subCommand === 'close') {
                        await socket.groupSettingUpdate(from, 'announcement');
                        await socket.sendMessage(sender, {
                            text: '✅ *Group closed - only admins can send messages*'
                        }, { quoted: shonux });
                    } else if (subCommand === 'info') {
                        const participants = groupMetadata.participants;
                        const admins = participants.filter(p => p.admin).length;
                        const members = participants.length;
                        
                        await socket.sendMessage(sender, {
                            text: `📊 *Group Info*\n\n` +
                                  `📌 Name: ${groupMetadata.subject}\n` +
                                  `🆔 ID: ${from}\n` +
                                  `👥 Members: ${members}\n` +
                                  `👑 Admins: ${admins}\n` +
                                  `📅 Created: ${moment(groupMetadata.creation * 1000).format('YYYY-MM-DD')}\n\n` +
                                  `👑 Developer: ${config.DEV_NAME}`
                        }, { quoted: shonux });
                    } else {
                        await socket.sendMessage(sender, {
                            text: `📌 *Group Commands:*\n\n` +
                                  `• ${config.PREFIX}group open - Open group\n` +
                                  `• ${config.PREFIX}group close - Close group\n` +
                                  `• ${config.PREFIX}group info - Group information`
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== WEATHER COMMAND ====================
                case 'weather': {
                    const city = args.join(' ');
                    if (!city) {
                        return await socket.sendMessage(sender, {
                            text: `🌤 *Usage:* ${config.PREFIX}weather <city>\n\nExample:\n${config.PREFIX}weather Colombo`
                        }, { quoted: shonux });
                    }

                    try {
                        const apiKey = 'bd5e378503939ddaee76f12ad7a97608'; // OpenWeatherMap API key
                        const response = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&appid=${apiKey}`);
                        
                        const data = response.data;
                        const weather = `
🌍 *Weather in ${data.name}, ${data.sys.country}*

🌡 Temperature: ${data.main.temp}°C
🤔 Feels like: ${data.main.feels_like}°C
💧 Humidity: ${data.main.humidity}%
☁️ Conditions: ${data.weather[0].description}
💨 Wind Speed: ${data.wind.speed} m/s

👑 Developer: ${config.DEV_NAME}
                        `;
                        
                        await socket.sendMessage(sender, { text: weather }, { quoted: shonux });
                    } catch (err) {
                        await socket.sendMessage(sender, {
                            text: '❌ *City not found or API error!*'
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== QUOTE COMMAND ====================
                case 'quote': {
                    try {
                        const response = await axios.get('https://api.quotable.io/random');
                        const data = response.data;
                        
                        await socket.sendMessage(sender, {
                            text: `📝 *Random Quote*\n\n"${data.content}"\n\n— *${data.author}*\n\n👑 Developer: ${config.DEV_NAME}`
                        }, { quoted: shonux });
                    } catch (err) {
                        await socket.sendMessage(sender, {
                            text: '❌ *Failed to fetch quote!*'
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== FACT COMMAND ====================
                case 'fact': {
                    const facts = [
                        "Honey never spoils. Archaeologists found 3000-year-old honey in Egyptian tombs that was still edible.",
                        "A day on Venus is longer than a year on Venus.",
                        "Bananas are berries, but strawberries aren't.",
                        "Octopuses have three hearts.",
                        "The Eiffel Tower can be 15 cm taller during summer due to thermal expansion.",
                        "Humans share 60% of their DNA with bananas.",
                        "A group of flamingos is called a 'flamboyance'.",
                        "The shortest war in history lasted 38 minutes between Britain and Zanzibar in 1896.",
                        "Cows have best friends and get stressed when separated.",
                        "The total weight of all ants on Earth is equal to the total weight of all humans."
                    ];
                    
                    const randomFact = facts[Math.floor(Math.random() * facts.length)];
                    
                    await socket.sendMessage(sender, {
                        text: `🧠 *Random Fact*\n\n${randomFact}\n\n👑 Developer: ${config.DEV_NAME}`
                    }, { quoted: shonux });
                    break;
                }

                // ==================== TRANSLATE COMMAND ====================
                case 'translate':
                case 'tr': {
                    if (args.length < 2) {
                        return await socket.sendMessage(sender, {
                            text: `🌐 *Usage:* ${config.PREFIX}translate <lang> <text>\n\nExample:\n${config.PREFIX}translate en මම ගෙදර යනවා\n\nSupported langs: en, si, ta, hi, etc.`
                        }, { quoted: shonux });
                    }

                    const targetLang = args[0];
                    const text = args.slice(1).join(' ');
                    
                    try {
                        const response = await axios.get(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=|${targetLang}`);
                        
                        if (response.data.responseData) {
                            const translated = response.data.responseData.translatedText;
                            await socket.sendMessage(sender, {
                                text: `🌐 *Translation*\n\n*Original:* ${text}\n*Translated:* ${translated}\n\n👑 Developer: ${config.DEV_NAME}`
                            }, { quoted: shonux });
                        } else {
                            await socket.sendMessage(sender, {
                                text: '❌ *Translation failed!*'
                            }, { quoted: shonux });
                        }
                    } catch (err) {
                        await socket.sendMessage(sender, {
                            text: '❌ *Translation service error!*'
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== YT SEARCH COMMAND ====================
                case 'ytsearch': {
                    const query = args.join(' ');
                    if (!query) {
                        return await socket.sendMessage(sender, {
                            text: `🔍 *Usage:* ${config.PREFIX}ytsearch <query>\n\nExample:\n${config.PREFIX}ytsearch sinhala songs`
                        }, { quoted: shonux });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: '🔍 *Searching YouTube...*'
                        }, { quoted: shonux });

                        const response = await axios.get(`https://weeb-api.vercel.app/ytsearch?query=${encodeURIComponent(query)}`);
                        const results = response.data.slice(0, 5);
                        
                        let resultText = `📺 *YouTube Search Results for "${query}"*\n\n`;
                        
                        results.forEach((video, index) => {
                            resultText += `${index + 1}. *${video.title}*\n`;
                            resultText += `⏱ Duration: ${video.duration}\n`;
                            resultText += `👤 ${video.channel.name}\n`;
                            resultText += `🔗 https://youtu.be/${video.id}\n\n`;
                        });
                        
                        resultText += `👑 Developer: ${config.DEV_NAME}`;
                        
                        await socket.sendMessage(sender, { text: resultText }, { quoted: shonux });
                    } catch (err) {
                        console.error('YT Search error:', err);
                        await socket.sendMessage(sender, {
                            text: '❌ *Failed to search YouTube!*'
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== PLAY COMMAND ====================
                case 'play': {
                    const query = args.join(' ');
                    if (!query) {
                        return await socket.sendMessage(sender, {
                            text: `🎵 *Usage:* ${config.PREFIX}play <song name>\n\nExample:\n${config.PREFIX}play Shape of You`
                        }, { quoted: shonux });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: '🎵 *Searching and downloading audio...*'
                        }, { quoted: shonux });

                        const searchRes = await axios.get(`https://weeb-api.vercel.app/ytsearch?query=${encodeURIComponent(query)}`);
                        const video = searchRes.data[0];
                        
                        if (!video) {
                            return await socket.sendMessage(sender, {
                                text: '❌ *No results found!*'
                            }, { quoted: shonux });
                        }

                        const audioRes = await axios.get(`https://weeb-api.vercel.app/ytmp3?url=https://youtu.be/${video.id}`);
                        
                        if (audioRes.data && audioRes.data.link) {
                            await socket.sendMessage(sender, {
                                audio: { url: audioRes.data.link },
                                mimetype: 'audio/mpeg',
                                fileName: `${video.title}.mp3`
                            }, { quoted: shonux });
                        } else {
                            await socket.sendMessage(sender, {
                                text: '❌ *Failed to download audio!*'
                            }, { quoted: shonux });
                        }
                    } catch (err) {
                        console.error('Play error:', err);
                        await socket.sendMessage(sender, {
                            text: '❌ *Failed to process your request!*'
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== VIDEO COMMAND ====================
                case 'video': {
                    const query = args.join(' ');
                    if (!query) {
                        return await socket.sendMessage(sender, {
                            text: `🎬 *Usage:* ${config.PREFIX}video <video name>\n\nExample:\n${config.PREFIX}video funny cats`
                        }, { quoted: shonux });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: '🎬 *Searching and downloading video...*'
                        }, { quoted: shonux });

                        const searchRes = await axios.get(`https://weeb-api.vercel.app/ytsearch?query=${encodeURIComponent(query)}`);
                        const video = searchRes.data[0];
                        
                        if (!video) {
                            return await socket.sendMessage(sender, {
                                text: '❌ *No results found!*'
                            }, { quoted: shonux });
                        }

                        const videoRes = await axios.get(`https://weeb-api.vercel.app/ytmp4?url=https://youtu.be/${video.id}`);
                        
                        if (videoRes.data && videoRes.data.link) {
                            await socket.sendMessage(sender, {
                                video: { url: videoRes.data.link },
                                caption: `🎬 *${video.title}*\n\n👑 Developer: ${config.DEV_NAME}`
                            }, { quoted: shonux });
                        } else {
                            await socket.sendMessage(sender, {
                                text: '❌ *Failed to download video!*'
                            }, { quoted: shonux });
                        }
                    } catch (err) {
                        console.error('Video error:', err);
                        await socket.sendMessage(sender, {
                            text: '❌ *Failed to process your request!*'
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== INSTAGRAM COMMAND ====================
                case 'ig': {
                    const url = args[0];
                    if (!url || !url.includes('instagram.com')) {
                        return await socket.sendMessage(sender, {
                            text: `📸 *Usage:* ${config.PREFIX}ig <instagram_url>\n\nExample:\n${config.PREFIX}ig https://www.instagram.com/p/xxxxx/`
                        }, { quoted: shonux });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: '📥 *Downloading Instagram media...*'
                        }, { quoted: shonux });

                        const response = await axios.get(`https://vapis.my.id/api/igdl?url=${encodeURIComponent(url)}`);
                        
                        if (response.data && response.data.media && response.data.media.length > 0) {
                            for (const media of response.data.media) {
                                if (media.type === 'video') {
                                    await socket.sendMessage(sender, {
                                        video: { url: media.url },
                                        caption: `📸 *Instagram Video*\n\n👑 Developer: ${config.DEV_NAME}`
                                    }, { quoted: shonux });
                                } else {
                                    await socket.sendMessage(sender, {
                                        image: { url: media.url },
                                        caption: `📸 *Instagram Image*\n\n👑 Developer: ${config.DEV_NAME}`
                                    }, { quoted: shonux });
                                }
                                await delay(1000);
                            }
                        } else {
                            await socket.sendMessage(sender, {
                                text: '❌ *Failed to download!*'
                            }, { quoted: shonux });
                        }
                    } catch (err) {
                        console.error('IG error:', err);
                        await socket.sendMessage(sender, {
                            text: '❌ *Failed to process your request!*'
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== FACEBOOK COMMAND ====================
                case 'fb': {
                    const url = args[0];
                    if (!url || !url.includes('facebook.com')) {
                        return await socket.sendMessage(sender, {
                            text: `📘 *Usage:* ${config.PREFIX}fb <facebook_url>\n\nExample:\n${config.PREFIX}fb https://www.facebook.com/watch?v=xxxxx`
                        }, { quoted: shonux });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: '📥 *Downloading Facebook video...*'
                        }, { quoted: shonux });

                        const response = await axios.get(`https://vapis.my.id/api/fbdl?url=${encodeURIComponent(url)}`);
                        
                        if (response.data && response.data.media && response.data.media.length > 0) {
                            const hdVideo = response.data.media.find(m => m.quality === 'HD') || response.data.media[0];
                            
                            await socket.sendMessage(sender, {
                                video: { url: hdVideo.url },
                                caption: `📘 *Facebook Video*\n\n👑 Developer: ${config.DEV_NAME}`
                            }, { quoted: shonux });
                        } else {
                            await socket.sendMessage(sender, {
                                text: '❌ *Failed to download!*'
                            }, { quoted: shonux });
                        }
                    } catch (err) {
                        console.error('FB error:', err);
                        await socket.sendMessage(sender, {
                            text: '❌ *Failed to process your request!*'
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== TIKTOK COMMAND ====================
                case 'tiktok':
                case 'tt': {
                    const url = args[0];
                    if (!url || !url.includes('tiktok.com')) {
                        return await socket.sendMessage(sender, {
                            text: `🎵 *Usage:* ${config.PREFIX}tiktok <tiktok_url>\n\nExample:\n${config.PREFIX}tiktok https://www.tiktok.com/@user/video/xxxxx`
                        }, { quoted: shonux });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: '📥 *Downloading TikTok video...*'
                        }, { quoted: shonux });

                        const response = await axios.get(`https://vapis.my.id/api/tiktokdl?url=${encodeURIComponent(url)}`);
                        
                        if (response.data && response.data.media && response.data.media.length > 0) {
                            const video = response.data.media.find(m => m.type === 'video');
                            
                            if (video) {
                                await socket.sendMessage(sender, {
                                    video: { url: video.url },
                                    caption: `🎵 *TikTok Video*\n\n👑 Developer: ${config.DEV_NAME}`
                                }, { quoted: shonux });
                            } else {
                                await socket.sendMessage(sender, {
                                    text: '❌ *No video found!*'
                                }, { quoted: shonux });
                            }
                        } else {
                            await socket.sendMessage(sender, {
                                text: '❌ *Failed to download!*'
                            }, { quoted: shonux });
                        }
                    } catch (err) {
                        console.error('TikTok error:', err);
                        await socket.sendMessage(sender, {
                            text: '❌ *Failed to process your request!*'
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== TWITTER COMMAND ====================
                case 'twitter':
                case 'tw': {
                    const url = args[0];
                    if (!url || !url.includes('twitter.com')) {
                        return await socket.sendMessage(sender, {
                            text: `🐦 *Usage:* ${config.PREFIX}twitter <twitter_url>\n\nExample:\n${config.PREFIX}twitter https://twitter.com/user/status/xxxxx`
                        }, { quoted: shonux });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: '📥 *Downloading Twitter video...*'
                        }, { quoted: shonux });

                        const response = await axios.get(`https://vapis.my.id/api/twitterdl?url=${encodeURIComponent(url)}`);
                        
                        if (response.data && response.data.media && response.data.media.length > 0) {
                            for (const media of response.data.media) {
                                if (media.type === 'video') {
                                    await socket.sendMessage(sender, {
                                        video: { url: media.url },
                                        caption: `🐦 *Twitter Video*\n\n👑 Developer: ${config.DEV_NAME}`
                                    }, { quoted: shonux });
                                } else {
                                    await socket.sendMessage(sender, {
                                        image: { url: media.url },
                                        caption: `🐦 *Twitter Image*\n\n👑 Developer: ${config.DEV_NAME}`
                                    }, { quoted: shonux });
                                }
                                await delay(1000);
                            }
                        } else {
                            await socket.sendMessage(sender, {
                                text: '❌ *Failed to download!*'
                            }, { quoted: shonux });
                        }
                    } catch (err) {
                        console.error('Twitter error:', err);
                        await socket.sendMessage(sender, {
                            text: '❌ *Failed to process your request!*'
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== URL UPLOAD COMMAND ====================
                case 'tourl':
                case 'url': {
                    if (!quoted) {
                        return await socket.sendMessage(sender, {
                            text: `🔗 *Usage:* Reply to an image/video with ${config.PREFIX}url`
                        }, { quoted: shonux });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: '📤 *Uploading to server...*'
                        }, { quoted: shonux });

                        let media;
                        let mimeType;
                        
                        if (quoted.imageMessage) {
                            media = await socket.downloadAndSaveMediaMessage(quoted.imageMessage);
                            mimeType = 'image';
                        } else if (quoted.videoMessage) {
                            media = await socket.downloadAndSaveMediaMessage(quoted.videoMessage);
                            mimeType = 'video';
                        } else if (quoted.audioMessage) {
                            media = await socket.downloadAndSaveMediaMessage(quoted.audioMessage);
                            mimeType = 'audio';
                        } else if (quoted.documentMessage) {
                            media = await socket.downloadAndSaveMediaMessage(quoted.documentMessage);
                            mimeType = 'document';
                        } else {
                            return await socket.sendMessage(sender, {
                                text: '❌ *Unsupported media type!*'
                            }, { quoted: shonux });
                        }

                        const formData = new FormData();
                        formData.append('file', fs.createReadStream(media));
                        
                        const uploadRes = await axios.post('https://api.anonymousfiles.io/', formData, {
                            headers: { 'Content-Type': 'multipart/form-data' }
                        });

                        if (uploadRes.data && uploadRes.data.url) {
                            await socket.sendMessage(sender, {
                                text: `🔗 *Your ${mimeType} URL:*\n${uploadRes.data.url}\n\n👑 Developer: ${config.DEV_NAME}`
                            }, { quoted: shonux });
                        } else {
                            await socket.sendMessage(sender, {
                                text: '❌ *Upload failed!*'
                            }, { quoted: shonux });
                        }

                        fs.unlinkSync(media);
                    } catch (err) {
                        console.error('URL upload error:', err);
                        await socket.sendMessage(sender, {
                            text: '❌ *Failed to upload!*'
                        }, { quoted: shonux });
                    }
                    break;
                }

                // ==================== NEWS COMMAND ====================
                case 'news': {
                    try {
                        await socket.sendMessage(sender, {
                            text: '📰 *Fetching latest news...*'
                        }, { quoted: shonux });

                        const response = await axios.get('https://newsapi.org/v2/top-headlines?country=us&apiKey=YOUR_NEWS_API_KEY');
                        
                        if (response.data && response.data.articles) {
                            const articles = response.data.articles.slice(0, 5);
                            let newsText = `📰 *Top News Headlines*\n\n`;
                            
                            articles.forEach((article, index) => {
                                newsText += `${index + 1}. *${article.title}*\n`;
                                newsText += `📌 ${article.source.name}\n`;
                                newsText += `🔗 ${article.url}\n\n`;
                            });
                            
                            newsText += `👑 Developer: ${config.DEV_NAME}`;
                            
                            await socket.sendMessage(sender, {
                                text: newsText
                            }, { quoted: shonux });
                        } else {
                            await socket.sendMessage(sender, {
                                text: '❌ *Failed to fetch news!*'
                            }, { quoted: shonux });
                        }
                    } catch (err) {
                        console.error('News error:', err);
                        await socket.sendMessage(sender, {
                            text: '❌ *News service error!*'
                        }, { quoted: shonux });
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
