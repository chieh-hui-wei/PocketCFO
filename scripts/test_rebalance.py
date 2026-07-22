"""
scripts/test_rebalance.py
Unit tests for RebalanceService calculation, trade math, and bidirectional (rise & fall) trigger conditions.
Run with: PYTHONPATH=. .venv/bin/python3 scripts/test_rebalance.py
"""
import asyncio
import sys
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

# Mock optional third-party broker SDKs if not present in test environment
for mod_name in [
    "esun_trade", "esun_trade.sdk", "esun_trade.util", "esun_trade.constant",
    "sinopac", "sjgrid"
]:
    if mod_name not in sys.modules:
        sys.modules[mod_name] = MagicMock()


async def test_rebalance_analysis_rise():
    from src.services.rebalance.service import RebalanceService
    from src.dbs.models import RebalanceStrategy, Security

    db = MagicMock()

    # Mock strategy
    strategy = RebalanceStrategy(
        user_id=1,
        target_stock_pct=50.0,
        target_bond_pct=10.0,
        target_cash_pct=40.0,
        stock_trigger_threshold=60.0,
        stock_min_threshold=40.0,
        bond_tickers="00931B,BND",
        enable_email_alert=True
    )

    service = RebalanceService(db, user_id=1)
    service.get_or_create_strategy = AsyncMock(return_value=strategy)

    # Stock 1: 00631L (9000 shares @ 35.1 = 315,900 TWD)
    sec_stock = MagicMock(spec=Security)
    sec_stock.id = 1
    sec_stock.ticker = "00631L"
    sec_stock.name = "元大台灣50正2"
    sec_stock.quantity = 9000.0
    sec_stock.current_price = 35.1
    sec_stock.market_value = 315900.0
    sec_stock.currency = "TWD"
    sec_stock.exchange_rate = 1.0
    sec_stock.original_market_value = None
    sec_stock.original_current_price = None

    securities = [sec_stock]

    with patch_stock_holding(securities), patch_balance_sheet(200000.0):
        analysis = await service.analyze_rebalance(date(2025, 1, 1))

    # Total portfolio = 315,900 + 200,000 = 515,900 TWD
    # Stock % = 315,900 / 515,900 = 61.23% (> 60% threshold -> triggered RISE!)
    assert analysis["total_portfolio_value"] == 515900
    assert analysis["current_stock_pct"] == 61.23
    assert analysis["current_cash_pct"] == 38.77
    assert analysis["is_triggered"] is True
    assert analysis["trigger_direction"] == "RISE"

    # Required Stock trade amount:
    # Target Stock = 50% * 515,900 = 257,950 TWD
    # Required trade = 257,950 - 315,900 = -57,950 TWD (Sell 57,950 TWD)
    # Trade shares = -57,950 / 35.1 = -1651 shares
    item_stock = next(i for i in analysis["rebalance_items"] if i["ticker"] == "00631L")
    assert item_stock["trade_amount"] == -57950
    assert item_stock["trade_shares"] == -1651
    assert item_stock["post_rebalance_shares"] == 7349
    assert item_stock["post_rebalance_market_value"] == 257950

    print("✅ test_rebalance_analysis_rise passed (Matching Excel screenshot math)!")


async def test_rebalance_analysis_fall():
    from src.services.rebalance.service import RebalanceService
    from src.dbs.models import RebalanceStrategy, Security

    db = MagicMock()

    strategy = RebalanceStrategy(
        user_id=1,
        target_stock_pct=50.0,
        target_bond_pct=10.0,
        target_cash_pct=40.0,
        stock_trigger_threshold=60.0,
        stock_min_threshold=40.0,
        bond_tickers="00931B,BND",
        enable_email_alert=True
    )

    service = RebalanceService(db, user_id=1)
    service.get_or_create_strategy = AsyncMock(return_value=strategy)

    # Stock 1: 00631L (3000 shares @ 35.1 = 105,300 TWD)
    sec_stock = MagicMock(spec=Security)
    sec_stock.id = 1
    sec_stock.ticker = "00631L"
    sec_stock.name = "元大台灣50正2"
    sec_stock.quantity = 3000.0
    sec_stock.current_price = 35.1
    sec_stock.market_value = 105300.0
    sec_stock.currency = "TWD"
    sec_stock.exchange_rate = 1.0
    sec_stock.original_market_value = None
    sec_stock.original_current_price = None

    securities = [sec_stock]

    # Cash = 300,000 TWD -> Total portfolio = 405,300 TWD
    # Stock % = 105,300 / 405,300 = 25.98% (< 40% threshold -> triggered FALL!)
    with patch_stock_holding(securities), patch_balance_sheet(300000.0):
        analysis = await service.analyze_rebalance(date(2025, 1, 1))

    assert analysis["current_stock_pct"] == 25.98
    assert analysis["is_triggered"] is True
    assert analysis["trigger_direction"] == "FALL"

    # Required Stock trade amount:
    # Target Stock = 50% * 405,300 = 202,650 TWD
    # Required trade = 202,650 - 105,300 = +97,350 TWD (Buy 97,350 TWD)
    item_stock = next(i for i in analysis["rebalance_items"] if i["ticker"] == "00631L")
    assert item_stock["trade_amount"] == 97350
    assert item_stock["trade_shares"] > 0

    print("✅ test_rebalance_analysis_fall passed (Dips buying trigger)!")


def patch_stock_holding(securities):
    return patch("src.services.reports.stock_holding.StockHoldingService.get_or_compute_portfolio", AsyncMock(return_value=([], securities)))


def patch_balance_sheet(cash_amount):
    mock_bs = MagicMock()
    mock_bs.total_cash = cash_amount
    return patch("src.services.reports.balance_sheet.BalanceSheetService.compute", AsyncMock(return_value=mock_bs))


async def main():
    print("\n--- Running Portfolio Rebalance Unit Tests ---\n")
    await test_rebalance_analysis_rise()
    await test_rebalance_analysis_fall()
    print("\n✅ All rebalance tests passed cleanly.\n")


if __name__ == "__main__":
    asyncio.run(main())
