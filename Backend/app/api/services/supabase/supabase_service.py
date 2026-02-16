"""
Supabase Service - Conexión y operaciones sobre cuentas y transacciones.
"""

import uuid
from typing import Optional, List, Dict, Any, Set
from supabase import create_client, Client
from app.core.config import settings


def _uuid_str(val: str) -> str:
    return str(val).strip()


class SupabaseService:
    """Conexión a Supabase. Usa Service Role Key para bypass RLS."""

    def __init__(self):
        self.supabase: Optional[Client] = None
        key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_KEY
        if settings.SUPABASE_URL and key:
            try:
                self.supabase = create_client(settings.SUPABASE_URL, key)
            except Exception as e:
                print(f"[Supabase] Error al conectar: {e}")

    def is_connected(self) -> bool:
        return self.supabase is not None

    def get_or_create_account(
        self, stable_key: str, source: str, display_name: str
    ) -> str:
        """
        Obtiene o crea una cuenta por stable_key. Devuelve account.id (UUID).
        """
        if not self.supabase:
            raise RuntimeError("Supabase no inicializado")
        try:
            r = (
                self.supabase.table("accounts")
                .select("id")
                .eq("stable_key", stable_key)
                .limit(1)
                .execute()
            )
            if r.data and len(r.data) > 0:
                return r.data[0]["id"]
        except Exception:
            pass
        # Crear nueva cuenta
        new_id = str(uuid.uuid4())
        self.supabase.table("accounts").insert({
            "id": new_id,
            "stable_key": stable_key,
            "display_name": display_name or stable_key,
            "source": source.lower(),
        }).execute()
        return new_id

    def link_user_account(self, user_id: str, account_id: str) -> None:
        """Vincula usuario a cuenta. Ignora si ya existe."""
        if not self.supabase:
            raise RuntimeError("Supabase no inicializado")
        uid = _uuid_str(user_id)
        try:
            self.supabase.table("user_accounts").upsert(
                {"user_id": uid, "account_id": account_id},
                on_conflict="user_id,account_id",
            ).execute()
        except Exception as e:
            # Si la tabla no soporta upsert, intentar insert
            try:
                self.supabase.table("user_accounts").insert({
                    "user_id": uid,
                    "account_id": account_id,
                }).execute()
            except Exception:
                raise e

    def get_user_account_ids(self, user_id: str) -> List[str]:
        """Devuelve los account_id (UUID) de las cuentas del usuario."""
        if not self.supabase:
            return []
        uid = _uuid_str(user_id)
        try:
            r = (
                self.supabase.table("user_accounts")
                .select("account_id")
                .eq("user_id", uid)
                .execute()
            )
            return [x["account_id"] for x in (r.data or [])]
        except Exception:
            return []

    def get_account_display_names(self, account_ids: List[str]) -> Dict[str, str]:
        """Mapeo account_id -> display_name para mostrar en la UI."""
        if not self.supabase or not account_ids:
            return {}
        try:
            r = (
                self.supabase.table("accounts")
                .select("id, display_name, stable_key")
                .in_("id", account_ids)
                .execute()
            )
            return {
                row["id"]: (row.get("display_name") or row.get("stable_key") or "Cuenta")
                for row in (r.data or [])
            }
        except Exception:
            return {}

    def get_existing_transaction_ids(self, transaction_ids: List[str]) -> Set[str]:
        if not self.supabase or not transaction_ids:
            return set()
        try:
            r = (
                self.supabase.table("transactions")
                .select("transaction_id")
                .in_("transaction_id", transaction_ids)
                .execute()
            )
            return {row["transaction_id"] for row in (r.data or [])}
        except Exception:
            return set()

    def insert_transactions(
        self, transactions: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Inserta transacciones. Devuelve {received, inserted, duplicates}.
        """
        if not self.supabase:
            raise RuntimeError("Supabase no inicializado")
        if not transactions:
            return {"received": 0, "inserted": 0, "duplicates": []}
        ids = [t["transaction_id"] for t in transactions]
        existing = self.get_existing_transaction_ids(ids)
        new_ones = [t for t in transactions if t["transaction_id"] not in existing]
        if new_ones:
            try:
                self.supabase.table("transactions").insert(new_ones).execute()
            except Exception as e:
                print(f"[Supabase] Error insert: {e}")
                raise
        return {
            "received": len(transactions),
            "inserted": len(new_ones),
            "duplicates": list(existing),
        }


supabase_service = SupabaseService()
