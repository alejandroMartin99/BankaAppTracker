"""
Servicio de configuración de cuentas.
Carga accounts.yaml y provee el mapeo para el pipeline de extracción.
Futuro: integrar con DB (users, accounts, account_owners) cuando haya auth.
"""
from pathlib import Path
from typing import Dict, Any, Optional
import yaml

_ACCOUNT_CONFIG: Optional[Dict[str, Any]] = None
# config/ está en la raíz de Backend (junto a app/)
_CONFIG_PATH = Path(__file__).resolve().parent.parent.parent.parent / "config" / "accounts.yaml"


def _load_config() -> Dict[str, Any]:
    global _ACCOUNT_CONFIG
    if _ACCOUNT_CONFIG is not None:
        return _ACCOUNT_CONFIG
    if not _CONFIG_PATH.exists():
        # Fallback a valores por defecto si no existe el archivo
        _ACCOUNT_CONFIG = {
            "ibercaja": {
                "base_pattern": "20859254******",
                "accounts": {
                    "716552": {"name": "Conjunta", "shared": True},
                    "716650": {"name": "Personal", "shared": False},
                },
            },
            "revolut": {"default_name": "Revolut", "shared": False},
        }
        return _ACCOUNT_CONFIG
    with open(_CONFIG_PATH, "r", encoding="utf-8") as f:
        _ACCOUNT_CONFIG = yaml.safe_load(f) or {}
    return _ACCOUNT_CONFIG


def get_ibercaja_account_map() -> Dict[str, str]:
    """
    Retorna mapeo {iban_completo: nombre_cuenta} para Ibercaja.
    Ej: {"20859254******716552": "Conjunta", "20859254******716650": "Personal"}
    """
    config = _load_config()
    ibercaja = config.get("ibercaja", {})
    base = ibercaja.get("base_pattern", "20859254******")
    accounts = ibercaja.get("accounts", {})
    return {
        f"{base}{suffix}": acc.get("name", "Sin nombre")
        for suffix, acc in accounts.items()
    }


def get_account_info(iban_full: str) -> Optional[Dict[str, Any]]:
    """
    Retorna info de la cuenta (name, shared) si existe.
    Útil para saber si una cuenta es compartida al filtrar por usuario.
    """
    config = _load_config()
    ibercaja = config.get("ibercaja", {})
    base = ibercaja.get("base_pattern", "20859254******")
    accounts = ibercaja.get("accounts", {})
    # Extraer sufijo (últimos 6 dígitos)
    if base in iban_full and iban_full.startswith(base):
        suffix = iban_full.replace(base, "")
        if suffix in accounts:
            return {"name": accounts[suffix].get("name"), "shared": accounts[suffix].get("shared", False)}
    return None


def get_revolut_default_name() -> str:
    """Nombre por defecto para extractos Revolut."""
    config = _load_config()
    return config.get("revolut", {}).get("default_name", "Revolut")


def reload_config() -> None:
    """Recarga la config (útil si se edita accounts.yaml en caliente)."""
    global _ACCOUNT_CONFIG
    _ACCOUNT_CONFIG = None
    _load_config()
