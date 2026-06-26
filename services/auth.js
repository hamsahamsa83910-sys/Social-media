const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');

dotenv.config();

/**
 * Creates and returns a Nodemailer transporter if email configurations are set in .env.
 */
function getTransporter() {
  const service = process.env.EMAIL_SERVICE;
  const host = process.env.EMAIL_HOST;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  // If credentials are not provided, fallback to console log simulation
  if (!user || !pass) {
    return null;
  }

  const config = {};
  if (service) {
    config.service = service;
  } else if (host) {
    config.host = host;
    config.port = parseInt(process.env.EMAIL_PORT) || 587;
    config.secure = config.port === 465;
  } else {
    // If neither service nor host is specified, assume service configuration from user email provider
    if (user.endsWith('@gmail.com')) config.service = 'gmail';
    else if (user.endsWith('@outlook.com') || user.endsWith('@hotmail.com')) config.service = 'outlook';
    else return null;
  }

  config.auth = {
    user: user,
    pass: pass
  };

  return nodemailer.createTransport(config);
}

/**
 * Sends an email using Nodemailer or falls back to console logging if credentials aren't set
 */
async function sendMail(to, subject, text) {
  const transporter = getTransporter();
  const fromEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@minisocial.com';

  if (transporter) {
    try {
      await transporter.sendMail({
        from: `"MiniSocial" <${fromEmail}>`,
        to: to,
        subject: subject,
        text: text,
        html: text.replace(/\n/g, '<br>')
      });
      console.log(`📧 Real email successfully sent to: ${to} (Subject: "${subject}")`);
      return;
    } catch (error) {
      console.error(`❌ SMTP Error: Failed to send email via nodemailer, falling back to console log:`, error.message);
    }
  }

  // Fallback Simulation Log
  const boundary = '='.repeat(60);
  console.log(`
${boundary}
📧 EMAIL SENT SIMULATION (Configure .env for real emails)
To:      ${to}
Subject: ${subject}
Date:    ${new Date().toLocaleString()}
${'-'.repeat(60)}
${text}
${boundary}
💡 TIP: To send a real email to your inbox instead of printing here:
   Open the .env file in VS Code and fill in EMAIL_USER and EMAIL_PASS.
  `);
}

/**
 * Sends a registration email verification code
 */
function sendVerificationCode(email, username, code) {
  const text = `Hi ${username},\n\nWelcome to MiniSocial! Please verify your email by entering this code in the verification screen:\n\n👉  ${code}  👈\n\nIf you did not register for this account, please ignore this email.`;
  sendMail(email, 'Verify your email for MiniSocial', text);
}

/**
 * Sends a password reset verification link/code
 */
function sendPasswordResetCode(email, username, code) {
  const text = `Hi ${username},\n\nYou requested a password reset. Enter the following temporary recovery code in the password reset panel:\n\n👉  ${code}  👈\n\nThis code will expire in 15 minutes.`;
  sendMail(email, 'Password Reset Code - MiniSocial', text);
}

/**
 * Generates a TOTP Two-Factor Authentication Secret and QR Code for authenticator apps
 */
async function generate2FA(username) {
  const secret = speakeasy.generateSecret({
    name: `MiniSocial:${username}`,
    issuer: 'MiniSocial'
  });

  try {
    const qrCodeDataUrl = await qrcode.toDataURL(secret.otpauth_url);
    return {
      secret: secret.base32,
      qrCode: qrCodeDataUrl
    };
  } catch (error) {
    console.error('Error generating QR code for 2FA:', error);
    throw error;
  }
}

/**
 * Verifies a TOTP code against the secret
 */
function verify2FA(secret, token) {
  return speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: token,
    window: 1 // Allow 1 step grace period (30s before/after)
  });
}

module.exports = {
  sendVerificationCode,
  sendPasswordResetCode,
  generate2FA,
  verify2FA
};
