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

async def send_reset_password_email(to_email: str, pin_code: str):
    """
    Send password reset PIN code email to user. Runs inside to_thread.
    """
    subject = "[pocketCFO] 您的密碼重設驗證碼"
    body_html = f"""
    <html>
      <body style="font-family: sans-serif; background-color: #f8fafc; padding: 40px; color: #1e293b;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 32px; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <h2 style="color: #2563eb; margin-bottom: 8px;">重設您的 pocketCFO 密碼</h2>
          <p style="font-size: 14px; color: #64748b; margin-top: 0;">個人財務與資產分配監控系統</p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="font-size: 16px; line-height: 1.6;">我們收到重設您帳戶密碼的請求。請在密碼重設頁面輸入以下 6 位數驗證碼：</p>
          <div style="background-color: #f1f5f9; text-align: center; padding: 20px; border-radius: 12px; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0f172a;">{pin_code}</span>
          </div>
          <div style="text-align: center; margin: 32px 0 24px 0;">
            <a href="{settings.app_website_url}/reset-password" style="background-color: #2563eb; color: #ffffff; padding: 14px 28px; text-decoration: none; font-size: 16px; font-weight: bold; border-radius: 10px; display: inline-block; box-shadow: 0 4px 6px -1px rgba(37,99,235,0.2);">
              前往密碼重設頁面
            </a>
          </div>
          <p style="font-size: 12px; color: #64748b; text-align: center; margin-bottom: 24px;">
            連結：<a href="{settings.app_website_url}/reset-password" style="color: #2563eb;">{settings.app_website_url}/reset-password</a>
          </p>
          <p style="font-size: 14px; color: #94a3b8; line-height: 1.6;">※ 此驗證碼將在 15 分鐘後失效。若您並未要求重設密碼，請忽略此郵件，您的密碼將保持不變。</p>
        </div>
      </body>
    </html>
    """
    try:
        await asyncio.to_thread(send_smtp_email_sync, to_email, subject, body_html)
    except Exception as e:
        log.error(f"Failed to send reset email to {to_email}: {e}")
    
    # Always print code for local debugging
    print(f"\n--- [PASSWORD RESET PIN] ---\nTo: {to_email}\nPIN Code: {pin_code}\n-----------------------------\n")


async def send_rebalance_alert_email(to_email: str, analysis: dict):
    """
    Send portfolio rebalance alert email to user when asset allocation distorts.
    """
    subject = "[pocketCFO] ⚠️ 資產再平衡提醒通知 (Portfolio Rebalance Alert)"

    current_stock_pct = analysis.get("current_stock_pct", 0.0)
    target_stock_pct = analysis.get("target_stock_pct", 50.0)
    stock_trigger_threshold = analysis.get("stock_trigger_threshold", 60.0)
    stock_min_threshold = analysis.get("stock_min_threshold", 40.0)
    trigger_direction = analysis.get("trigger_direction", "NONE")
    total_portfolio_value = analysis.get("total_portfolio_value", 0.0)

    if trigger_direction == "RISE":
        alert_title = f"股票部位大漲/過高通知 (目前 {current_stock_pct:.2f}% ≥ 門檻 {stock_trigger_threshold:.1f}%)"
        alert_desc = f"您的股票資產佔比目前已達到 <strong>{current_stock_pct:.2f}%</strong>（已高於上限警戒門檻 <strong>{stock_trigger_threshold:.1f}%</strong>，目標比例為 <strong>{target_stock_pct:.1f}%</strong>）。<br />建議執行資產再平衡，獲利解結部分股票並充實債券與現金金庫。"
    elif trigger_direction == "FALL":
        alert_title = f"股票部位下跌/過低通知 (目前 {current_stock_pct:.2f}% ≤ 門檻 {stock_min_threshold:.1f}%)"
        alert_desc = f"您的股票資產佔比目前已降至 <strong>{current_stock_pct:.2f}%</strong>（已低於下限警戒門檻 <strong>{stock_min_threshold:.1f}%</strong>，目標比例為 <strong>{target_stock_pct:.1f}%</strong>）。<br />建議執行資產再平衡，逢低加碼股票部位並釋出部分債券或現金。"
    else:
        alert_title = f"資產配置調整通知 (目前股票佔比 {current_stock_pct:.2f}%)"
        alert_desc = f"您的股票資產佔比目前為 <strong>{current_stock_pct:.2f}%</strong>（目標比例為 <strong>{target_stock_pct:.1f}%</strong>）。您可以參考以下試算建議進行部位微調。"

    rows_html = ""
    for item in analysis.get("rebalance_items", []):
        ticker = item.get("ticker", "")
        current_mv = item.get("current_market_value", 0.0)
        actual_pct = item.get("actual_pct", 0.0)
        trade_amt = item.get("trade_amount", 0.0)
        trade_shares = item.get("trade_shares", 0.0)
        post_shares = item.get("post_rebalance_shares", 0.0)
        post_mv = item.get("post_rebalance_market_value", 0.0)

        action_badge = ""
        if trade_amt < 0:
            action_badge = f'<span style="background-color:#fee2e2; color:#dc2626; padding:2px 8px; border-radius:4px; font-weight:bold;">賣出 {abs(trade_shares):,.0f} 股 ({trade_amt:,.0f} TWD)</span>'
        elif trade_amt > 0:
            action_badge = f'<span style="background-color:#dcfce7; color:#16a34a; padding:2px 8px; border-radius:4px; font-weight:bold;">買入 {trade_shares:,.0f} 股 (+{trade_amt:,.0f} TWD)</span>'
        else:
            action_badge = '<span style="color:#64748b;">無需調整</span>'

        rows_html += f"""
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px; font-weight: bold;">{ticker}</td>
          <td style="padding: 10px; text-align: right;">{current_mv:,.0f} ({actual_pct:.2f}%)</td>
          <td style="padding: 10px; text-align: center;">{action_badge}</td>
          <td style="padding: 10px; text-align: right;">{post_mv:,.0f} ({post_shares:,.0f} 股)</td>
        </tr>
        """

    body_html = f"""
    <html>
      <body style="font-family: sans-serif; background-color: #f8fafc; padding: 30px; color: #1e293b;">
        <div style="max-width: 680px; margin: 0 auto; background-color: #ffffff; padding: 32px; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="display:flex; align-items:center; gap:8px;">
            <h2 style="color: #dc2626; margin: 0;">⚠️ {alert_title}</h2>
          </div>
          <p style="font-size: 14px; color: #64748b; margin-top: 4px;">pocketCFO 個人財務與資產分配監控系統</p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          
          <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
            <p style="margin: 0; font-size: 15px; color: #991b1b; line-height: 1.6;">
              {alert_desc}
            </p>
          </div>

          <h3 style="color: #0f172a; margin-bottom: 12px;">📊 資產投資組合總覽</h3>
          <p style="font-size: 14px; color: #475569;">投資組合總市值：<strong>NT$ {total_portfolio_value:,.0f}</strong></p>

          <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin: 16px 0;">
            <thead>
              <tr style="background-color: #f1f5f9; text-align: left; color: #334155;">
                <th style="padding: 10px;">資產 / 標的</th>
                <th style="padding: 10px; text-align: right;">目前市值 (佔比)</th>
                <th style="padding: 10px; text-align: center;">建議交易動作</th>
                <th style="padding: 10px; text-align: right;">再平衡後預估市值</th>
              </tr>
            </thead>
            <tbody>
              {rows_html}
            </tbody>
          </table>

          <div style="text-align: center; margin: 32px 0 16px 0;">
            <a href="http://35.212.162.76:5173/rebalance" style="background-color: #2563eb; color: #ffffff; padding: 14px 32px; text-decoration: none; font-size: 15px; font-weight: bold; border-radius: 10px; display: inline-block; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);">
              登入 PocketCFO 查看資產再平衡與配置比例
            </a>
          </div>
          <p style="font-size: 12px; color: #94a3b8; text-align: center;">※ 此郵件由 pocketCFO 系統自動發送。</p>
        </div>
      </body>
    </html>
    """
    try:
        await asyncio.to_thread(send_smtp_email_sync, to_email, subject, body_html)
    except Exception as e:
        log.error(f"Failed to send rebalance email to {to_email}: {e}")

    print(f"\n--- [REBALANCE ALERT EMAIL SENT] ---\nTo: {to_email}\nStock Pct: {current_stock_pct:.2f}%\n------------------------------------\n")


