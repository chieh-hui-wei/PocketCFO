import asyncio
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from src.instances.config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()

def send_smtp_email_sync(to_email: str, subject: str, body_html: str):
    """
    Synchronous SMTP email sender. Runs inside a background thread.
    """
    if not settings.smtp_user or not settings.smtp_password:
        log.warning("SMTP credentials not configured. Email will NOT be sent.")
        log.info(f"Target Email: {to_email} | Subject: {subject} | HTML Body Preview: {body_html[:100]}...")
        # Keep PIN code accessible in logs for local testing when email is not configured
        print(f"\n[EMAIL LOG PRINT] Send code to {to_email}: subject='{subject}'")
        return
        
    sender = settings.smtp_sender or settings.smtp_user
    
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to_email
    
    msg.attach(MIMEText(body_html, "html"))
    
    # Establish connection
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
        if settings.smtp_port == 587:
            server.starttls()
        server.login(settings.smtp_user, settings.smtp_password)
        server.sendmail(sender, to_email, msg.as_string())
    log.info(f"Email sent successfully to {to_email}")

async def send_verification_email(to_email: str, pin_code: str):
    """
    Send verification PIN code email to invited user. Runs inside to_thread.
    """
    subject = "[pocketCFO] 您的帳戶驗證碼"
    body_html = f"""
    <html>
      <body style="font-family: sans-serif; background-color: #f8fafc; padding: 40px; color: #1e293b;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 32px; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <h2 style="color: #2563eb; margin-bottom: 8px;">歡迎使用 pocketCFO</h2>
          <p style="font-size: 14px; color: #64748b; margin-top: 0;">個人財務與資產分配監控系統</p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="font-size: 16px; line-height: 1.6;">您已被邀請加入 pocketCFO。請在註冊頁面輸入以下 6 位數驗證碼以啟用您的帳戶：</p>
          <div style="background-color: #f1f5f9; text-align: center; padding: 20px; border-radius: 12px; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0f172a;">{pin_code}</span>
          </div>
          <div style="text-align: center; margin: 32px 0 24px 0;">
            <a href="{settings.app_website_url}/register" style="background-color: #2563eb; color: #ffffff; padding: 14px 28px; text-decoration: none; font-size: 16px; font-weight: bold; border-radius: 10px; display: inline-block; box-shadow: 0 4px 6px -1px rgba(37,99,235,0.2);">
              前往註冊頁面
            </a>
          </div>
          <p style="font-size: 12px; color: #64748b; text-align: center; margin-bottom: 24px;">
            連結：<a href="{settings.app_website_url}/register" style="color: #2563eb;">{settings.app_website_url}/register</a>
          </p>
          <p style="font-size: 14px; color: #94a3b8; line-height: 1.6;">※ 此驗證碼將在 30 分鐘後失效。若您並未要求此註冊，請忽略此郵件。</p>
        </div>
      </body>
    </html>
    """
    try:
        await asyncio.to_thread(send_smtp_email_sync, to_email, subject, body_html)
    except Exception as e:
        log.error(f"Failed to send email to {to_email}: {e}")
    
    # Always print verification code to output for easier container manual copy-paste
    print(f"\n--- [EMAIL VERIFICATION PIN] ---\nTo: {to_email}\nPIN Code: {pin_code}\n---------------------------------\n")
