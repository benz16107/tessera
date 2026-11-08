import { createContext, useContext } from 'react';

export interface AppConfig { spacetimeHost: string; dbName: string; mapsKey: string; publicUrl?: string }

export const ConfigContext = createContext<AppConfig | null>(null);
export const useConfig = () => useContext(ConfigContext)!;

/** Base for share links: the public funnel URL when the crew knows it, else this origin. */
export const shareBase = (cfg: AppConfig) => (cfg.publicUrl || location.origin).replace(/\/$/, '');

export const NAME_KEY = 'shotmatch/name';
