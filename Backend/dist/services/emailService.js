"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
exports.readEmails = readEmails;
exports.getConfig = getConfig;
exports.updateConfig = updateConfig;
exports.validateConfig = validateConfig;
const nodemailer = require("nodemailer");
let cachedConfig = null;
function getConfig() {
    if (cachedConfig)
        return cachedConfig;
    const env = process.env;
    cachedConfig = {
        smtp: {
            host: env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(env.SMTP_PORT) || 587,
            secure: env.SMTP_SECURE === 'true',
            user: env.SMTP_USER || '',
            pass: env.SMTP_PASS || '',
        },
        imap: {
            host: env.IMAP_HOST || 'imap.gmail.com',
            port: parseInt(env.IMAP_PORT) || 993,
            tls: true,
            user: env.IMAP_USER || env.SMTP_USER || '',
            pass: env.IMAP_PASS || env.SMTP_PASS || '',
        },
        defaultFrom: env.EMAIL_FROM || env.SMTP_USER || '',
    };
    return cachedConfig;
}
function updateConfig(newConfig) {
    cachedConfig = null;
    const env = process.env;
    if (newConfig.smtp) {
        if (newConfig.smtp.host)
            env.SMTP_HOST = newConfig.smtp.host;
        if (newConfig.smtp.port)
            env.SMTP_PORT = String(newConfig.smtp.port);
        if (newConfig.smtp.secure !== undefined)
            env.SMTP_SECURE = String(newConfig.smtp.secure);
        if (newConfig.smtp.user)
            env.SMTP_USER = newConfig.smtp.user;
        if (newConfig.smtp.pass)
            env.SMTP_PASS = newConfig.smtp.pass;
    }
    if (newConfig.imap) {
        if (newConfig.imap.host)
            env.IMAP_HOST = newConfig.imap.host;
        if (newConfig.imap.port)
            env.IMAP_PORT = String(newConfig.imap.port);
        if (newConfig.imap.user)
            env.IMAP_USER = newConfig.imap.user;
        if (newConfig.imap.pass)
            env.IMAP_PASS = newConfig.imap.pass;
    }
    if (newConfig.defaultFrom)
        env.EMAIL_FROM = newConfig.defaultFrom;
}
function validateConfig(config) {
    const errors = [];
    if (!config.smtp.user)
        errors.push('SMTP username/email is required');
    if (!config.smtp.pass)
        errors.push('SMTP password is required');
    return errors;
}
async function sendEmail({ to, subject, text, html, attachments }) {
    const config = getConfig();
    const errors = validateConfig(config);
    if (errors.length > 0)
        throw new Error(errors.join('; '));
    const transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
    const info = await transporter.sendMail({
        from: `"Nexus AI" <${config.defaultFrom || config.smtp.user}>`,
        to,
        subject,
        text,
        html,
        attachments,
    });
    return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}
async function readEmails({ folder = 'INBOX', limit = 10 } = {}) {
    let Imap, simpleParser;
    try {
        Imap = require('imap');
        simpleParser = require('mailparser').simpleParser;
    }
    catch {
        throw new Error('IMAP modules not installed. Run: npm install imap mailparser');
    }
    const config = getConfig();
    if (!config.imap.user)
        throw new Error('IMAP email not configured');
    if (!config.imap.pass)
        throw new Error('IMAP password not configured');
    return new Promise((resolve, reject) => {
        const client = new Imap({
            user: config.imap.user,
            password: config.imap.pass,
            host: config.imap.host,
            port: config.imap.port,
            tls: config.imap.tls,
            tlsOptions: { rejectUnauthorized: false },
        });
        const emails = [];
        client.once('ready', () => {
            client.openBox(folder, true, (err, box) => {
                if (err) {
                    client.end();
                    return reject(err);
                }
                const fetchCount = Math.min(limit, box.messages.total || limit);
                const startSeq = Math.max(1, box.messages.total - fetchCount + 1);
                const fetch = client.seq.fetch(`${startSeq}:${box.messages.total}`, {
                    bodies: '',
                    struct: true,
                });
                fetch.on('message', (msg, seqno) => {
                    const email = { uid: seqno };
                    msg.on('body', (stream) => {
                        let buffer = '';
                        stream.on('data', (chunk) => { buffer += chunk.toString(); });
                        stream.on('end', () => {
                            simpleParser(buffer, (parseErr, parsed) => {
                                if (parseErr)
                                    return;
                                email.subject = parsed.subject || '(no subject)';
                                email.from = parsed.from ? parsed.from.text : '(unknown)';
                                email.date = parsed.date || new Date();
                                email.text = (parsed.text || '').slice(0, 2000);
                                email.html = (parsed.html || '').slice(0, 2000);
                            });
                        });
                    });
                    msg.once('end', () => {
                        if (email.subject)
                            emails.push(email);
                    });
                });
                fetch.once('error', (fetchErr) => {
                    client.end();
                    reject(fetchErr);
                });
                fetch.once('end', () => {
                    client.end();
                    setTimeout(() => resolve(emails), 500);
                });
            });
        });
        client.once('error', (connectErr) => {
            reject(connectErr);
        });
        client.connect();
    });
}
