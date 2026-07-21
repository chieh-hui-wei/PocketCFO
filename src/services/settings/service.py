"""
src/services/settings/service.py
Service layer for managing environment configuration and broker credential files.
"""
from __future__ import annotations

import os
import logging

log = logging.getLogger(__name__)


class SettingsService:
    @staticmethod
    def update_env_variable(key: str, value: str, env_path: str = ".env") -> None:
        if not os.path.exists(env_path):
            with open(env_path, "w", encoding="utf-8") as f:
                f.write(f"{key}={value}\n")
            return
            
        with open(env_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
            
        updated = False
        new_lines = []
        for line in lines:
            if line.strip().startswith(f"{key}="):
                new_lines.append(f"{key}={value}\n")
                updated = True
            else:
                new_lines.append(line)
                
        if not updated:
            new_lines.append(f"{key}={value}\n")
            
        with open(env_path, "w", encoding="utf-8") as f:
            f.writelines(new_lines)

    @staticmethod
    def mask_value(val: str | None) -> str:
        if not val:
            return ""
        if len(val) <= 4:
            return "****"
        return f"{val[:2]}****{val[-2:]}"
