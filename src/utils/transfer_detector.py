"""
src/utils/transfer_detector.py
Heuristics for detecting inter-account transfers that should be excluded
from income/expense calculations.

Strategy:
1. Keyword matching on transaction description (轉帳, 轉入, ATM, etc.)
2. Amount pairing: if a debit in account A matches a credit in account B
   within the same day or ±1 day → flag both as transfers
3. Known internal account ID matching embedded in description
"""
from __future__ import annotations

import re

# We no longer use generic keywords like "轉入", "轉出" because they mask real expenses (like paying rent).
# Instead, we rely on explicit internal transfer markers or explicit account matching.
TRANSFER_KEYWORDS = [
    "內部轉帳", "自行轉帳", "卡費", "信用卡費", "提款", "現金提款", "ATM提款", "ATM", "提領"
]

# Regex patterns: description containing partial account numbers
ACCOUNT_PATTERN = re.compile(r"\d{6,16}")


class TransferDetector:
    """
    Detect whether a transaction is an internal (user-to-user) transfer.

    Args:
        internal_account_ids: List of account IDs/codes belonging to the user.
                              If a transaction description contains any of these,
                              it is flagged as an internal transfer.
    """

    def __init__(self, internal_account_ids: list[str]) -> None:
        self.internal_account_ids = [aid.strip() for aid in internal_account_ids]

    def fuzzy_match_account(self, clean_aid: str, clean_cand: str) -> bool:
        if not clean_aid or not clean_cand:
            return False
            
        if clean_aid == clean_cand:
            return True
            
        aid_digits = re.sub(r'[*xX]', '', clean_aid)
        cand_digits = re.sub(r'[*xX]', '', clean_cand)
        
        if not aid_digits or not cand_digits:
            return False
            
        if len(cand_digits) >= 4 and clean_aid.endswith(cand_digits):
            return True
        if len(aid_digits) >= 4 and clean_cand.endswith(aid_digits):
            return True

        parts = [p for p in re.split(r'[*xX]+', clean_cand) if p]
        if len(parts) >= 2:
            prefix = parts[0]
            suffix = parts[-1]
            if len(prefix) >= 3 and len(suffix) >= 3:
                clean_aid_l = clean_aid.lstrip('0')
                prefix_l = prefix.lstrip('0')
                if clean_aid_l.startswith(prefix_l):
                    idx = len(prefix_l)
                    if suffix in clean_aid_l[idx:]:
                        return True

        def match_equal_len(s1: str, s2: str) -> bool:
            match_count = 0
            for c1, c2 in zip(s1, s2):
                if c1 != c2 and c1 not in '*xX' and c2 not in '*xX':
                    return False
                if c1 == c2 and c1 not in '*xX':
                    match_count += 1
            return match_count >= 4
            
        len_aid = len(clean_aid)
        len_cand = len(clean_cand)
        
        if len_cand == len_aid:
            return match_equal_len(clean_cand, clean_aid)
        elif len_cand < len_aid:
            for start in range(len_aid - len_cand + 1):
                if match_equal_len(clean_aid[start : start + len_cand], clean_cand):
                    return True
        else:
            for start in range(len_cand - len_aid + 1):
                if match_equal_len(clean_cand[start : start + len_aid], clean_aid):
                    return True
                    
        return False

    def is_internal_transfer(self, description: str) -> bool:
        """
        Return True if this transaction description indicates an internal transfer.
        """
        if not description:
            return False
        desc_upper = description.upper()

        # 1. Exact match for arbitrary string identifiers
        for aid in self.internal_account_ids:
            if aid and aid in description:
                return True

        # 2. Fuzzy match for numeric / masked account numbers
        candidates = re.findall(r'[0-9*xX]+(?:-[0-9*xX]+)*', description)
        for cand in candidates:
            clean_cand = re.sub(r'[^0-9*xX]', '', cand)
            if len(clean_cand) < 5:
                continue
            for aid in self.internal_account_ids:
                clean_aid = re.sub(r'[^0-9*xX]', '', aid)
                if len(clean_aid) >= 5:
                    if self.fuzzy_match_account(clean_aid, clean_cand):
                        return True

        # 3. Explicit non-transfer (expense/income) keywords that override generic transfer labels
        EXPLICIT_NON_TRANSFERS = ["房租", "租金", "水電", "瓦斯", "薪資", "薪水", "購物"]
        for kw in EXPLICIT_NON_TRANSFERS:
            if kw in desc_upper:
                return False

        # 4. Keyword match for internal transfers (like credit card bill payments)
        for kw in TRANSFER_KEYWORDS:
            if kw.upper() in desc_upper:
                return True

        return False

    @staticmethod
    def pair_transfers(
        debits: list[dict],
        credits: list[dict],
        tolerance_days: int = 1,
        amount_tolerance: float = 1.0,
    ) -> tuple[set[int], set[int]]:
        """
        Match debits against credits by date + amount to find transfer pairs.

        Args:
            debits: list of {"id": int, "date": date, "amount": float}
            credits: list of {"id": int, "date": date, "amount": float}
            tolerance_days: max days between debit and credit
            amount_tolerance: max TWD difference to consider a match

        Returns:
            (debit_ids_flagged, credit_ids_flagged)
        """
        from datetime import timedelta

        flagged_debits: set[int] = set()
        flagged_credits: set[int] = set()

        for d in debits:
            for c in credits:
                if c["id"] in flagged_credits:
                    continue
                day_diff = abs((d["date"] - c["date"]).days)
                amount_diff = abs(d["amount"] - c["amount"])
                if day_diff <= tolerance_days and amount_diff <= amount_tolerance:
                    flagged_debits.add(d["id"])
                    flagged_credits.add(c["id"])
                    break

        return flagged_debits, flagged_credits
