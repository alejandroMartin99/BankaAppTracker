"""
Supabase Service
Wrapper for Supabase database operations (transactions, user_accounts)
"""

from typing import Optional, List, Dict, Any, Set
from supabase import create_client, Client
from app.core.config import settings


def _uuid(user_id: str) -> str:
    """Asegura que user_id sea string válido para Supabase."""
    return str(user_id).strip()


class SupabaseService:
    """Service for managing Supabase database operations"""

    def __init__(self):
        """Initialize Supabase client. Usa Service Role Key para bypass RLS (inserts/selects)."""
        self.supabase: Optional[Client] = None
        key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_KEY
        if settings.SUPABASE_URL and key:
            try:
                self.supabase = create_client(settings.SUPABASE_URL, key)
            except Exception as e:
                print(f"[Supabase] Error al conectar: {e}")

    def is_connected(self) -> bool:
        """Check if Supabase is connected"""
        return self.supabase is not None

    def upsert_user_account(
        self, user_id: str, account_identifier: str, source: str, display_name: str
    ) -> None:
        """Registra o actualiza la asociación usuario-cuenta (al subir un extracto)."""
        if not self.supabase:
            raise RuntimeError("Supabase no está inicializado")
        uid = _uuid(user_id)
        self.supabase.table("user_accounts").upsert(
            {
                "user_id": uid,
                "account_identifier": account_identifier,
                "source": source.lower(),
                "display_name": display_name,
            },
            on_conflict="user_id,account_identifier",
        ).execute()

    def get_user_account_identifiers(self, user_id: str) -> List[str]:
        """Devuelve los account_identifier de las cuentas del usuario."""
        if not self.supabase:
            return []
        uid = _uuid(user_id)
        try:
            response = (
                self.supabase.table("user_accounts")
                .select("account_identifier")
                .eq("user_id", uid)
                .execute()
            )
            return [r["account_identifier"] for r in (response.data or [])]
        except Exception:
            return []

    def get_existing_transaction_ids(self, transaction_ids: List[str]) -> Set[str]:
        """Get transaction IDs that already exist in database"""
        if not self.supabase or not transaction_ids:
            return set()

        try:
            response = (
                self.supabase
                .table("transactions")
                .select("transaction_id")
                .in_("transaction_id", transaction_ids)
                .execute()
            )
            return {row["transaction_id"] for row in response.data} if response.data else set()
        except Exception:
            return set()

    def insert_transactions_with_duplicates_report(
        self,
        transactions: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Insert transactions and report duplicates by transaction_id.
        
        Returns:
            Dict with: received, inserted, duplicates
        """
        if not self.supabase:
            raise RuntimeError("Supabase no está inicializado")

        if not transactions:
            return {"received": 0, "inserted": 0, "duplicates": []}

        transaction_ids = [t["transaction_id"] for t in transactions]
        existing_ids = self.get_existing_transaction_ids(transaction_ids)
        new_transactions = [t for t in transactions if t["transaction_id"] not in existing_ids]

        if new_transactions:
            try:
                response = (
                    self.supabase
                    .table("transactions")
                    .insert(new_transactions)
                    .execute()
                )

                print({
                    "received": len(transactions),
                    "inserted": len(new_transactions),
                    "duplicates": list(existing_ids),
                })

                print(f"Supabase response rows: {len(response.data) if response.data else 0}")
                
            except Exception as e:
                print(f"Error al insertar en Supabase: {str(e)}")
                print(f"Tipo de error: {type(e).__name__}")
                # Intenta imprimir los detalles del error si están disponibles
                if hasattr(e, 'message'):
                    print(f"Mensaje: {e.message}")
                if hasattr(e, 'details'):
                    print(f"Detalles: {e.details}")
                raise

        return {
            "received": len(transactions),
            "inserted": len(new_transactions),
            "duplicates": list(existing_ids),
        }

# Global instance
supabase_service = SupabaseService()