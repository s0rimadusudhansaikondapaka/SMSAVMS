const nodemailer = require('nodemailer');

// Configure Transporter (SMTP / Service)
function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return null;
}

/**
 * Send Pass Approval Notification Email to Visitor
 */
async function sendVisitorApprovalEmail({ visitorEmail, visitorName, passCode, validFrom, validUntil, hostName }) {
  if (!visitorEmail || !visitorEmail.includes('@')) {
    console.log(`[EmailService] No valid visitor email provided for ${visitorName} (${passCode}). Skipping email dispatch.`);
    return { success: false, reason: 'NO_EMAIL' };
  }

  const subject = `✓ Pass Approved: Sathya Sai Grama Entry Pass [${passCode}]`;
  const passUrl = `${process.env.FRONTEND_URL || 'https://vms-qrf6.onrender.com'}/pass/${passCode}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 2px solid #df6f06; border-radius: 10px; padding: 20px; background-color: #fffbf0;">
      <div style="text-align: center; border-bottom: 2px solid #4e081d; padding-bottom: 15px;">
        <h2 style="color: #4e081d; margin: 0;">Sathya Sai Grama, Muddenahalli</h2>
        <h4 style="color: #df6f06; margin: 5px 0 0 0;">Visitor Access Pass Approved</h4>
      </div>

      <div style="padding: 20px 0;">
        <p>Dear <strong>${visitorName}</strong>,</p>
        <p>Your visitor registration request to visit <strong>Sathya Sai Grama</strong> has been <strong>APPROVED</strong>!</p>

        <div style="background-color: #ffffff; border: 1px solid #fed7aa; border-radius: 8px; padding: 15px; margin: 15px 0;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 5px; font-weight: bold; color: #4e081d;">Pass Code:</td><td style="padding: 5px; color: #df6f06; font-size: 18px; font-weight: bold;">${passCode}</td></tr>
            <tr><td style="padding: 5px; font-weight: bold; color: #4e081d;">Designated Host:</td><td style="padding: 5px;">${hostName || 'Ashram Management'}</td></tr>
            <tr><td style="padding: 5px; font-weight: bold; color: #4e081d;">Valid From:</td><td style="padding: 5px;">${new Date(validFrom).toLocaleString()}</td></tr>
            <tr><td style="padding: 5px; font-weight: bold; color: #4e081d;">Valid Until:</td><td style="padding: 5px;">${new Date(validUntil).toLocaleString()}</td></tr>
          </table>
        </div>

        <div style="text-align: center; margin: 25px 0;">
          <a href="${passUrl}" style="background-color: #df6f06; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">
            📱 View Digital QR Pass
          </a>
        </div>

        <p style="font-size: 13px; color: #64748b;">Please present your Digital QR Code or Pass Code at the security gate upon arrival. Security guards will verify your identity proof at the entrance.</p>
      </div>

      <div style="text-align: center; border-top: 1px solid #cbd5e1; padding-top: 15px; font-size: 12px; color: #64748b;">
        <p>© Sathya Sai Grama Visitor Management System | Sri Sathya Sai Loka Seva Gurukulam</p>
      </div>
    </div>
  `;

  return await sendMail({ to: visitorEmail, subject, html });
}

/**
 * Send Pass Rejection Notification Email to Visitor
 */
async function sendVisitorRejectionEmail({ visitorEmail, visitorName, passCode, hostName, rejectionReason }) {
  if (!visitorEmail || !visitorEmail.includes('@')) {
    console.log(`[EmailService] No valid visitor email provided for ${visitorName} (${passCode}). Skipping email dispatch.`);
    return { success: false, reason: 'NO_EMAIL' };
  }

  const subject = `❌ Pass Request Update: Sathya Sai Grama Entry Pass [${passCode}]`;
  const passUrl = `${process.env.FRONTEND_URL || 'https://vms-qrf6.onrender.com'}/pass/${passCode}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 2px solid #b91c1c; border-radius: 10px; padding: 20px; background-color: #fffaf0;">
      <div style="text-align: center; border-bottom: 2px solid #b91c1c; padding-bottom: 15px;">
        <h2 style="color: #4e081d; margin: 0;">Sathya Sai Grama, Muddenahalli</h2>
        <h4 style="color: #b91c1c; margin: 5px 0 0 0;">Visitor Access Pass Status: REJECTED</h4>
      </div>

      <div style="padding: 20px 0;">
        <p>Dear <strong>${visitorName}</strong>,</p>
        <p>Your visitor registration request to visit <strong>Sathya Sai Grama</strong> has been <strong>REJECTED</strong> by the host.</p>

        <div style="background-color: #ffffff; border: 1px solid #fca5a5; border-radius: 8px; padding: 15px; margin: 15px 0;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 5px; font-weight: bold; color: #4e081d;">Pass Code:</td><td style="padding: 5px; color: #b91c1c; font-size: 16px; font-weight: bold;">${passCode}</td></tr>
            <tr><td style="padding: 5px; font-weight: bold; color: #4e081d;">Host Name:</td><td style="padding: 5px;">${hostName || 'Ashram Host'}</td></tr>
            <tr><td style="padding: 5px; font-weight: bold; color: #4e081d;">Rejection Reason:</td><td style="padding: 5px; color: #b91c1c;">${rejectionReason || 'No reason specified'}</td></tr>
          </table>
        </div>

        <div style="text-align: center; margin: 25px 0;">
          <a href="${passUrl}" style="background-color: #64748b; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px; display: inline-block;">
            View Status Online
          </a>
        </div>
      </div>

      <div style="text-align: center; border-top: 1px solid #cbd5e1; padding-top: 15px; font-size: 12px; color: #64748b;">
        <p>© Sathya Sai Grama Visitor Management System | Sri Sathya Sai Loka Seva Gurukulam</p>
      </div>
    </div>
  `;

  return await sendMail({ to: visitorEmail, subject, html });
}

/**
 * Send L1 Approval Request Notification Email to Host
 */
async function sendHostL1NotificationEmail({ hostEmail, hostName, visitorName, visitorPhone, purpose, passCode, visitorCategory }) {
  if (!hostEmail || !hostEmail.includes('@')) {
    console.log(`[EmailService] No valid host email provided for ${hostName}. Skipping host email notification.`);
    return { success: false, reason: 'NO_EMAIL' };
  }

  const subject = `🔔 Action Required: Visitor Approval Request from ${visitorName} [${passCode}]`;
  const loginUrl = `${process.env.FRONTEND_URL || 'https://vms-qrf6.onrender.com'}/login`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 2px solid #4e081d; border-radius: 10px; padding: 20px; background-color: #ffffff;">
      <div style="text-align: center; border-bottom: 2px solid #df6f06; padding-bottom: 15px;">
        <h2 style="color: #4e081d; margin: 0;">Sathya Sai Grama VMS</h2>
        <h4 style="color: #df6f06; margin: 5px 0 0 0;">Visitor Approval Request (L1 Host)</h4>
      </div>

      <div style="padding: 20px 0;">
        <p>Dear <strong>${hostName}</strong>,</p>
        <p>A new visitor registration has been submitted requesting to meet you at Sathya Sai Grama:</p>

        <div style="background-color: #fffbf0; border: 1px solid #fed7aa; border-radius: 8px; padding: 15px; margin: 15px 0;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 5px; font-weight: bold; color: #4e081d;">Pass Code:</td><td style="padding: 5px;">${passCode}</td></tr>
            <tr><td style="padding: 5px; font-weight: bold; color: #4e081d;">Visitor Name:</td><td style="padding: 5px;">${visitorName}</td></tr>
            <tr><td style="padding: 5px; font-weight: bold; color: #4e081d;">Mobile Phone:</td><td style="padding: 5px;">${visitorPhone}</td></tr>
            <tr><td style="padding: 5px; font-weight: bold; color: #4e081d;">Visitor Category:</td><td style="padding: 5px;">${visitorCategory || 'GENERAL'}</td></tr>
            <tr><td style="padding: 5px; font-weight: bold; color: #4e081d;">Purpose of Visit:</td><td style="padding: 5px;">${purpose}</td></tr>
          </table>
        </div>

        <div style="text-align: center; margin: 25px 0;">
          <a href="${loginUrl}" style="background-color: #4e081d; color: #fcb900; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">
            ✓ Login to Approve / Reject Visitor Pass
          </a>
        </div>
      </div>

      <div style="text-align: center; border-top: 1px solid #cbd5e1; padding-top: 15px; font-size: 12px; color: #64748b;">
        <p>© Sathya Sai Grama Visitor Management System</p>
      </div>
    </div>
  `;

  return await sendMail({ to: hostEmail, subject, html });
}

/**
 * Send Password Reset Link Notification Email
 */
async function sendPasswordResetEmail({ userEmail, userName, resetUrl, requestedByAdmin = false }) {
  if (!userEmail || !userEmail.includes('@')) {
    console.log(`[EmailService] No valid email provided for ${userName}. Skipping password reset email.`);
    return { success: false, reason: 'NO_EMAIL' };
  }

  const subject = `🔐 Password Reset Request - Sathya Sai Grama VMS`;
  const contextMsg = requestedByAdmin
    ? 'A system administrator has generated a secure password reset link for your Sathya Sai Grama VMS account.'
    : 'We received a request to reset the password for your Sathya Sai Grama VMS account.';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 2px solid #800000; border-radius: 10px; padding: 25px; background-color: #fffbf5;">
      <div style="text-align: center; border-bottom: 2px solid #df6f06; padding-bottom: 15px;">
        <h2 style="color: #4e081d; margin: 0;">Sathya Sai Grama, Muddenahalli</h2>
        <h4 style="color: #df6f06; margin: 6px 0 0 0;">Visitor Management System (VMS)</h4>
      </div>

      <div style="padding: 20px 0;">
        <p>Dear <strong>${userName || 'User'}</strong>,</p>
        <p>${contextMsg}</p>
        <p>Please click the secure button below to set a new password. This reset link is valid for <strong>1 hour</strong>.</p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background-color: #800000; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 12px rgba(128, 0, 0, 0.3);">
            🔑 Set New Password
          </a>
        </div>

        <div style="background-color: #ffffff; border: 1px solid #fed7aa; border-radius: 8px; padding: 12px 16px; margin: 20px 0; font-size: 13px; color: #475569; word-break: break-all;">
          <strong>Direct Link:</strong><br />
          <a href="${resetUrl}" style="color: #b84018;">${resetUrl}</a>
        </div>

        <p style="font-size: 13px; color: #64748b; margin-top: 20px;">
          If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.
        </p>
      </div>

      <div style="text-align: center; border-top: 1px solid #cbd5e1; padding-top: 15px; font-size: 12px; color: #64748b;">
        <p>© Sathya Sai Grama Visitor Management System | Sri Sathya Sai Loka Seva Gurukulam</p>
      </div>
    </div>
  `;

  return await sendMail({ to: userEmail, subject, html });
}

/**
 * Generic Mail Delivery Core Helper
 */
async function sendMail({ to, subject, html }) {
  try {
    const transporter = getTransporter();
    const fromAddress = process.env.SMTP_FROM || '"Sathya Sai Grama VMS" <noreply@sathyasaigrama.org>';

    if (transporter) {
      const info = await transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        html,
      });
      console.log(`[EmailService] Email successfully delivered to ${to} (Msg ID: ${info.messageId})`);
      return { success: true, messageId: info.messageId };
    } else {
      console.log(`=================================================`);
      console.log(`[EmailService DEV LOG - SMTP Credentials Not Set]`);
      console.log(` TO: ${to}`);
      console.log(` SUBJECT: ${subject}`);
      console.log(`=================================================`);
      return { success: true, mode: 'DEV_LOG' };
    }
  } catch (err) {
    console.error(`[EmailService] Failed to send email to ${to}:`, err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendVisitorApprovalEmail,
  sendVisitorRejectionEmail,
  sendHostL1NotificationEmail,
  sendPasswordResetEmail,
};
