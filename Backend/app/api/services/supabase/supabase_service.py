"""
Supabase Service - Conexión y operaciones sobre cuentas y transacciones.
"""

import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Set
from supabase import create_client, Client
from app.core.config import settings


def _uuid_str(val: str) -> str:
    return str(val).strip()


class SupabaseService:
    """Conexión a Supabase. Usa Service Role Key para bypass RLS."""

    def __init__(self):
        self.supabase: Optional[Client] = None
        self._uses_service_role: bool = False
        key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_KEY
        if settings.SUPABASE_URL and key:
            try:
                self.supabase = create_client(settings.SUPABASE_URL, key)
                self._uses_service_role = bool(settings.SUPABASE_SERVICE_ROLE_KEY)
            except Exception as e:
                print(f"[Supabase] Error al conectar: {e}")

    def is_connected(self) -> bool:
        return self.supabase is not None

    def uses_service_role(self) -> bool:
        """True si estamos usando service_role (necesario para inserts con RLS)."""
        return self._uses_service_role

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

    def get_user_ids_sharing_accounts_with(self, user_id: str) -> List[str]:
        """Usuarios que comparten al menos una cuenta con este usuario (otros user_id en user_accounts con el mismo account_id)."""
        if not self.supabase:
            return []
        my_accounts = self.get_user_account_ids(user_id)
        if not my_accounts:
            return []
        uid = _uuid_str(user_id)
        try:
            r = (
                self.supabase.table("user_accounts")
                .select("user_id")
                .in_("account_id", my_accounts)
                .execute()
            )
            other = [x["user_id"] for x in (r.data or []) if x.get("user_id") != uid]
            return list(dict.fromkeys(other))
        except Exception:
            return []

    def get_user_display_name(self, user_id: str) -> str:
        """
        Intenta resolver el nombre visible de un usuario.
        Orden: public.profiles -> auth.users metadata/email -> id abreviado.
        """
        if not self.supabase:
            return str(user_id)[:8]
        uid = _uuid_str(user_id)
        # 1) Tabla pública opcional `profiles`
        try:
            r = (
                self.supabase.table("profiles")
                .select("full_name, first_name, last_name, display_name, name, email")
                .eq("id", uid)
                .limit(1)
                .execute()
            )
            if r.data:
                row = r.data[0]
                first = str(row.get("first_name") or "").strip()
                last = str(row.get("last_name") or "").strip()
                if first and last:
                    return f"{first} {last}"
                for key in ("display_name", "full_name", "name"):
                    v = str(row.get(key) or "").strip()
                    if v:
                        return v
                email = str(row.get("email") or "").strip()
                if email and "@" in email:
                    return email.split("@")[0]
        except Exception:
            pass
        # 2) auth.users (requiere service role y permisos)
        try:
            r = (
                self.supabase.schema("auth")
                .table("users")
                .select("email, raw_user_meta_data")
                .eq("id", uid)
                .limit(1)
                .execute()
            )
            if r.data:
                row = r.data[0]
                meta = row.get("raw_user_meta_data") or {}
                first = str(meta.get("first_name") or meta.get("given_name") or "").strip()
                last = str(
                    meta.get("last_name")
                    or meta.get("family_name")
                    or meta.get("surnames")
                    or ""
                ).strip()
                if first and last:
                    return f"{first} {last}"
                for key in ("display_name", "full_name", "name", "user_name"):
                    v = str(meta.get(key) or "").strip()
                    if v:
                        return v
                email = str(row.get("email") or "").strip()
                if email and "@" in email:
                    return email.split("@")[0]
        except Exception:
            pass
        # 3) Admin API de Auth (service role): suele exponer metadata/email sin depender de PostgREST en schema auth
        try:
            admin_res = self.supabase.auth.admin.get_user_by_id(uid)
            user = getattr(admin_res, "user", None)
            if user:
                meta = getattr(user, "user_metadata", None) or {}
                first = str(meta.get("first_name") or meta.get("given_name") or "").strip()
                last = str(
                    meta.get("last_name")
                    or meta.get("family_name")
                    or meta.get("surnames")
                    or ""
                ).strip()
                if first and last:
                    return f"{first} {last}"
                for key in ("display_name", "full_name", "name", "user_name"):
                    v = str(meta.get(key) or "").strip()
                    if v:
                        return v
                email = str(getattr(user, "email", "") or "").strip()
                if email and "@" in email:
                    return email.split("@")[0]
        except Exception:
            pass
        return uid[:8]

    def get_account_ids_for_users(self, user_ids: List[str]) -> List[str]:
        """Devuelve todos los account_id de los usuarios indicados."""
        if not self.supabase or not user_ids:
            return []
        uids = [_uuid_str(u) for u in user_ids]
        try:
            r = (
                self.supabase.table("user_accounts")
                .select("account_id")
                .in_("user_id", uids)
                .execute()
            )
            return list(dict.fromkeys([x["account_id"] for x in (r.data or [])]))
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

    def get_category_catalog_from_user_transactions(self, user_id: str) -> Dict[str, Any]:
        """
        Categorías y subcategorías distintas presentes en transacciones de las cuentas del usuario.
        Paginado para cubrir más allá del límite por petición de PostgREST.
        """
        if not self.supabase:
            return {"categories": [], "subcategories_by_category": {}}
        account_ids = self.get_user_account_ids(user_id)
        if not account_ids:
            return {"categories": [], "subcategories_by_category": {}}
        subs_by_cat: Dict[str, Set[str]] = defaultdict(set)
        offset = 0
        batch = 1000
        while True:
            try:
                r = (
                    self.supabase.table("transactions")
                    .select("categoria, subcategoria")
                    .in_("account_id", account_ids)
                    .order("id")
                    .range(offset, offset + batch - 1)
                    .execute()
                )
            except Exception:
                break
            rows = r.data or []
            for row in rows:
                raw_c = row.get("categoria")
                raw_s = row.get("subcategoria")
                cat = str(raw_c).strip() if raw_c is not None else ""
                sub = str(raw_s).strip() if raw_s is not None else ""
                if not cat:
                    continue
                if sub:
                    subs_by_cat[cat].add(sub)
                else:
                    subs_by_cat.setdefault(cat, set())
            if len(rows) < batch:
                break
            offset += batch
            if offset > 500_000:
                break
        categories = sorted(subs_by_cat.keys(), key=lambda x: (x.lower(), x))
        return {
            "categories": categories,
            "subcategories_by_category": {c: sorted(subs_by_cat[c]) for c in categories},
        }

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
                if not self._uses_service_role:
                    print("[Supabase] HINT: Si ves 'permission denied' o RLS, configura SUPABASE_SERVICE_ROLE_KEY en Render")
                raise
        return {
            "received": len(transactions),
            "inserted": len(new_ones),
            "duplicates": list(existing),
        }

    # --- Inversión: ISIN por usuario ---

    def list_user_investment_funds(self, user_id: str) -> List[Dict[str, Any]]:
        """Filas ordenadas: sort_order, luego creación."""
        if not self.supabase:
            return []
        uid = _uuid_str(user_id)
        try:
            r = (
                self.supabase.table("user_investment_funds")
                .select("isin, sort_order, created_at")
                .eq("user_id", uid)
                .order("sort_order", desc=False)
                .execute()
            )
            return list(r.data or [])
        except Exception as e:
            print(f"[Supabase] list_user_investment_funds: {e}")
            return []

    def count_user_investment_funds(self, user_id: str) -> int:
        if not self.supabase:
            return 0
        uid = _uuid_str(user_id)
        try:
            r = (
                self.supabase.table("user_investment_funds")
                .select("*", count="exact")
                .eq("user_id", uid)
                .execute()
            )
            return int(r.count or 0)
        except Exception:
            return 0

    def add_user_investment_fund(self, user_id: str, isin: str) -> None:
        if not self.supabase:
            raise RuntimeError("Supabase no inicializado")
        uid = _uuid_str(user_id)
        isin_u = isin.strip().upper()
        rows = self.list_user_investment_funds(user_id)
        if any((r.get("isin") or "").upper() == isin_u for r in rows):
            raise ValueError("ISIN ya está en tu lista")
        max_ord = max((int(r.get("sort_order") or 0) for r in rows), default=-1)
        self.supabase.table("user_investment_funds").insert(
            {"user_id": uid, "isin": isin_u, "sort_order": max_ord + 1}
        ).execute()

    def remove_user_investment_fund(self, user_id: str, isin: str) -> bool:
        """True si se borró al menos una fila."""
        if not self.supabase:
            return False
        uid = _uuid_str(user_id)
        isin_u = isin.strip().upper()
        try:
            r = (
                self.supabase.table("user_investment_funds")
                .delete()
                .eq("user_id", uid)
                .eq("isin", isin_u)
                .execute()
            )
            data = r.data or []
            return len(data) > 0
        except Exception as e:
            print(f"[Supabase] remove_user_investment_fund: {e}")
            return False

    # --- Caché global ficha fondo (solo backend / service role) ---

    def get_investment_fund_detail_cache(self, cache_key: str) -> Optional[Dict[str, Any]]:
        if not self.supabase:
            return None
        try:
            r = (
                self.supabase.table("investment_fund_detail_cache")
                .select("payload, updated_at, yahoo_symbol")
                .eq("cache_key", cache_key.strip())
                .limit(1)
                .execute()
            )
            rows = r.data or []
            if not rows:
                return None
            return dict(rows[0])
        except Exception as e:
            print(f"[Supabase] get_investment_fund_detail_cache: {e}")
            return None

    def upsert_investment_fund_detail_cache(
        self, cache_key: str, yahoo_symbol: str, payload: Dict[str, Any]
    ) -> None:
        if not self.supabase:
            return
        row = {
            "cache_key": cache_key.strip(),
            "yahoo_symbol": (yahoo_symbol or "").strip(),
            "payload": payload,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            self.supabase.table("investment_fund_detail_cache").upsert(
                row,
                on_conflict="cache_key",
            ).execute()
        except Exception as e:
            print(f"[Supabase] upsert_investment_fund_detail_cache: {e}")


supabase_service = SupabaseService()
