"""
Application Configuration
Centralized configuration management using Pydantic Settings
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""
    
    model_config = SettingsConfigDict(
        env_file="../.env",  # .env está en la raíz del proyecto
        case_sensitive=True,
        extra="ignore"
    )
    
    # Application
    APP_NAME: str = "Rubén Fitness API"
    DEBUG: bool = False
    
    # CORS - defaults (can be overridden by environment variable)
    # In production, this will be overridden to ["*"] in main.py
    # You can also set CORS_ORIGINS environment variable as comma-separated list
    CORS_ORIGINS: List[str] = [
        "http://localhost:4200",
        "http://localhost:3000",
        "https://*.vercel.app"  # Allow all Vercel preview deployments
    ]
    
    # Supabase Configuration
    SUPABASE_URL: str = "https://eowsozcqryodxtpsduab.supabase.co"
    SUPABASE_KEY: str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvd3NvemNxcnlvZHh0cHNkdWFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzMjIyODIsImV4cCI6MjA4Mzg5ODI4Mn0.vfl0o9mgHtyw0Q20fPLkH2U8xSngvUAge4MrzYvToso"
    
    # OpenAI Configuration
    OPENAI_API_KEY: str = ""
    
    # Firebase Configuration
    FIREBASE_CREDENTIALS_PATH: str = ""
    
    # Database (if needed separately)
    DATABASE_URL: str = ""


# Global settings instance
settings = Settings()


