import asyncio
import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from configparser import ConfigParser

from src.services.scheduler import sync_taishin_assets, sync_esun_assets

async def main():
    # 1. Check if E-Sun config is readable
    config_path = Path("secrets/config.ini")
    print(f"[*] 檢查 E-Sun 設定檔路徑: {config_path.absolute()}")
    if not config_path.exists():
        print(f"[!] 警告: 找不到 {config_path.absolute()}！")
        print("    如果您使用了 docker-compose 掛載 ./secrets，請確認您 VM 主機上的 ./secrets 目錄下確實有 config.ini 檔案！")
    else:
        try:
            config = ConfigParser()
            config.read(config_path)
            print(f"[+] 成功讀取設定檔，包含區塊: {config.sections()}")
        except Exception as e:
            print(f"[!] 讀取設定檔失敗: {e}")

    # 2. Get target date
    d = datetime.datetime.now(ZoneInfo("Asia/Taipei")).date()
    print(f"\n[*] 開始同步台北時間當日資產與交易，目標日期: {d}")
    
    print("\n==== 1. 同步台新證券 ====")
    try:
        await sync_taishin_assets(d.year, d.month, user_id=1, target_date=d)
        print("[+] 台新證券同步成功！")
    except Exception as e:
        print(f"[-] 台新證券同步失敗: {e}")
        
    print("\n==== 2. 同步玉山證券 ====")
    try:
        await sync_esun_assets(d.year, d.month, user_id=1, target_date=d)
        print("[+] 玉山證券同步成功！")
    except Exception as e:
        print(f"[-] 玉山證券同步失敗: {e}")
        
    print("\n[+] 同步程序執行結束。")

if __name__ == "__main__":
    asyncio.run(main())
