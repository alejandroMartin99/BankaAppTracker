"""
Supabase Service
Wrapper for Supabase database operations (transactions)
"""

from typing import Optional, List, Dict, Any, Set
from supabase import create_client, Client
from app.core.config import settings


class SupabaseService:
    """Service for managing Supabase database operations"""

    def __init__(self):
        """Initialize Supabase client"""
        self.supabase: Optional[Client] = None
        if settings.SUPABASE_URL and settings.SUPABASE_KEY:
            try:
                self.supabase = create_client(
                    settings.SUPABASE_URL,
                    settings.SUPABASE_KEY
                )
            except Exception:
                pass

    def is_connected(self) -> bool:
        """Check if Supabase is connected"""
        return self.supabase is not None

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