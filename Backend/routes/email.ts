import { Router } from 'express';
import * as emailService from '../services/emailService';
import { logEvent } from './context';

const router = Router();

router.get('/email/config', (req, res) => {
  try {
    const config = emailService.getConfig();
    res.json({
      ok: true,
      config: {
        smtp: { ...config.smtp, pass: config.smtp.pass ? '****' : '' },
        imap: { ...config.imap, pass: config.imap.pass ? '****' : '' },
        defaultFrom: config.defaultFrom,
      },
    });
  } catch (err: any) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/email/config', (req, res) => {
  try {
    emailService.updateConfig(req.body);
    logEvent('email', 'Email config updated');
    res.json({ ok: true, message: 'Email config updated' });
  } catch (err: any) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/email/send', async (req, res) => {
  try {
    const { to, subject, text, html, attachments } = req.body || {};
    if (!to || !subject || (!text && !html)) {
      return res.status(400).json({ ok: false, error: 'Missing required fields: to, subject, and text or html' });
    }
    logEvent('email', `Sending email to ${to}: ${subject}`);
    const result = await emailService.sendEmail({ to, subject, text, html, attachments });
    res.json({ ok: true, ...result });
  } catch (err: any) {
    logEvent('error', 'Email send failed', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/email/read', async (req, res) => {
  try {
    const { folder, limit } = req.body || {};
    logEvent('email', `Reading emails from ${folder || 'INBOX'}`);
    const emails = await emailService.readEmails({ folder, limit }) as any[];
    res.json({ ok: true, emails, count: (emails as any[]).length });
  } catch (err: any) {
    logEvent('error', 'Email read failed', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
