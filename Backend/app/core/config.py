"""
Application Configuration
Centralized configuration management using Pydantic Settings
"""

from pathlib import Path
from pydantic import Field, AliasChoices, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# .env en Backend/ (junto a app/)
_ENV_PATH = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""

    model_config = SettingsConfigDict(
        env_file=str(_ENV_PATH) if _ENV_PATH.exists() else None,
        case_sensitive=True,
        extra="ignore",
    )

    # Application
    APP_NAME: str = "BANK_APP_TRAKER"
    DEBUG: bool = False

    # CORS: lista separada por comas (nunca uses * en producción)
    CORS_ORIGINS: str = Field(
        default="http://localhost:4200,http://localhost:3000,https://banka-app-tracker.vercel.app",
        description="Orígenes permitidos, separados por coma",
    )

    # Supabase: sin valores secretos por defecto; definir en .env o variables de entorno
    SUPABASE_URL: str = Field(default="", validation_alias=AliasChoices("SUPABASE_URL"))
    SUPABASE_KEY: str = Field(
        default="",
        validation_alias=AliasChoices("SUPABASE_KEY", "SUPABASE_ANON_KEY"),
    )
    SUPABASE_SERVICE_ROLE_KEY: str = Field(
        default="",
        validation_alias=AliasChoices("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"),
    )

    OPENAI_API_KEY: str = ""
    FIREBASE_CREDENTIALS_PATH: str = ""
    DATABASE_URL: str = ""

    APP_URL: str = Field(
        default="https://bankaapptracker.onrender.com",
        description="URL pública del backend",
    )
    KEEP_ALIVE_INTERVAL_SECONDS: int = Field(
        default=720,
        description="Intervalo en segundos entre pings keep-alive (default 12 min)",
    )

    # Si true, expone GET /test con detalles de diagnóstico (solo desarrollo)
    ENABLE_DIAGNOSTIC_ENDPOINT: bool = Field(default=False)

    @field_validator("ENABLE_DIAGNOSTIC_ENDPOINT", mode="before")
    @classmethod
    def _parse_diagnostic_flag(cls, v):
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.strip().lower() in ("1", "true", "yes", "on")
        return False

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


# Global settings instance
settings = Settings()
