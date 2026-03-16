export type AccountColorKey = 'revolut' | 'personal' | 'conjunta' | 'pluxee';

export interface AccountColorDef {
  key: AccountColorKey;
  bg: string;
  fg: string;
  label: string;
}

export const ACCOUNT_COLOR_OPTIONS: AccountColorDef[] = [
  {
    key: 'personal',
    bg: 'rgba(34, 197, 94, 0.15)',
    fg: '#16a34a',
    label: 'Verde'
  },
  {
    key: 'conjunta',
    bg: 'rgba(168, 85, 247, 0.15)',
    fg: '#a855f7',
    label: 'Lila'
  },
  {
    key: 'revolut',
    bg: 'rgba(0, 123, 255, 0.15)',
    fg: '#007bff',
    label: 'Azul'
  },
  {
    key: 'pluxee',
    bg: 'rgba(249, 115, 22, 0.15)',
    fg: '#f97316',
    label: 'Naranja'
  }
];

const STORAGE_KEY = 'accountColorOverrides';

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normaliseName(name: string): string {
  return (name || '').trim().toLowerCase();
}

function readOverrides(): Record<string, AccountColorKey> {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, AccountColorKey>;
    }
    return {};
  } catch {
    return {};
  }
}

function writeOverrides(map: Record<string, AccountColorKey>): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function getAccountColorKeyForName(name: string): AccountColorKey {
  const norm = normaliseName(name);
  const overrides = readOverrides();
  const overrideKey = overrides[norm];
  if (overrideKey) return overrideKey;

  if (norm.includes('revolut')) return 'revolut';
  if (norm.includes('pluxee')) return 'pluxee';
  if (norm === 'personal') return 'personal';
  if (norm === 'conjunta') return 'conjunta';

  // Por defecto usamos el esquema de "gastos" (personal)
  return 'personal';
}

export function getAccountColorForName(name: string): { bg: string; fg: string } {
  const key = getAccountColorKeyForName(name);
  const def = ACCOUNT_COLOR_OPTIONS.find(o => o.key === key) || ACCOUNT_COLOR_OPTIONS[0];
  return { bg: def.bg, fg: def.fg };
}

export function setAccountColorOverride(name: string, key: AccountColorKey): void {
  const norm = normaliseName(name);
  if (!norm) return;
  const current = readOverrides();
  current[norm] = key;
  writeOverrides(current);
}

export type AccountColorKey = 'revolut' | 'personal' | 'conjunta' | 'pluxee';

export interface AccountColorDef {
  key: AccountColorKey;
  bg: string;
  fg: string;
  label: string;
}

export const ACCOUNT_COLOR_OPTIONS: AccountColorDef[] = [
  {
    key: 'personal',
    bg: 'rgba(34, 197, 94, 0.15)',
    fg: '#16a34a',
    label: 'Verde'
  },
  {
    key: 'conjunta',
    bg: 'rgba(168, 85, 247, 0.15)',
    fg: '#a855f7',
    label: 'Lila'
  },
  {
    key: 'revolut',
    bg: 'rgba(0, 123, 255, 0.15)',
    fg: '#007bff',
    label: 'Azul'
  },
  {
    key: 'pluxee',
    bg: 'rgba(249, 115, 22, 0.15)',
    fg: '#f97316',
    label: 'Naranja'
  }
];

const STORAGE_KEY = 'accountColorOverrides';

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normaliseName(name: string): string {
  return (name || '').trim().toLowerCase();
}

function readOverrides(): Record<string, AccountColorKey> {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, AccountColorKey>;
    }
    return {};
  } catch {
    return {};
  }
}

function writeOverrides(map: Record<string, AccountColorKey>): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function getAccountColorKeyForName(name: string): AccountColorKey {
  const norm = normaliseName(name);
  const overrides = readOverrides();
  const overrideKey = overrides[norm];
  if (overrideKey) return overrideKey;

  if (norm.includes('revolut')) return 'revolut';
  if (norm.includes('pluxee')) return 'pluxee';
  if (norm === 'personal') return 'personal';
  if (norm === 'conjunta') return 'conjunta';

  // Por defecto usamos el esquema de "gastos" (personal)
  return 'personal';
}

export function getAccountColorForName(name: string): { bg: string; fg: string } {
  const key = getAccountColorKeyForName(name);
  const def = ACCOUNT_COLOR_OPTIONS.find(o => o.key === key) || ACCOUNT_COLOR_OPTIONS[0];
  return { bg: def.bg, fg: def.fg };
}

export function setAccountColorOverride(name: string, key: AccountColorKey): void {
  const norm = normaliseName(name);
  if (!norm) return;
  const current = readOverrides();
  current[norm] = key;
  writeOverrides(current);
}
