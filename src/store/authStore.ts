import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface ServerProfile {
  id: string;
  name: string;
  url: string;
  username: string;
  password: string;
}

interface AuthState {
  // Multi-server
  servers: ServerProfile[];
  activeServerId: string | null;

  // Last.fm (global)
  lastfmApiKey: string;
  lastfmApiSecret: string;
  lastfmSessionKey: string;
  lastfmUsername: string;

  // Settings (global)
  scrobblingEnabled: boolean;
  maxCacheMb: number;
  downloadFolder: string;
  excludeAudiobooks: boolean;
  customGenreBlacklist: string[];
  replayGainEnabled: boolean;
  replayGainMode: 'track' | 'album';
  crossfadeEnabled: boolean;
  crossfadeSecs: number;
  gaplessEnabled: boolean;

  // Status
  isLoggedIn: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  lastfmSessionError: boolean;

  // Actions
  addServer: (profile: Omit<ServerProfile, 'id'>) => string;
  updateServer: (id: string, data: Partial<Omit<ServerProfile, 'id'>>) => void;
  removeServer: (id: string) => void;
  setActiveServer: (id: string) => void;
  setLoggedIn: (v: boolean) => void;
  setConnecting: (v: boolean) => void;
  setConnectionError: (e: string | null) => void;
  setLastfm: (apiKey: string, apiSecret: string, sessionKey: string, username: string) => void;
  connectLastfm: (sessionKey: string, username: string) => void;
  disconnectLastfm: () => void;
  setLastfmSessionError: (v: boolean) => void;
  setScrobblingEnabled: (v: boolean) => void;
  setMaxCacheMb: (v: number) => void;
  setDownloadFolder: (v: string) => void;
  setExcludeAudiobooks: (v: boolean) => void;
  setCustomGenreBlacklist: (v: string[]) => void;
  setReplayGainEnabled: (v: boolean) => void;
  setReplayGainMode: (v: 'track' | 'album') => void;
  setCrossfadeEnabled: (v: boolean) => void;
  setCrossfadeSecs: (v: number) => void;
  setGaplessEnabled: (v: boolean) => void;
  logout: () => void;

  // Derived
  getBaseUrl: () => string;
  getActiveServer: () => ServerProfile | undefined;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      servers: [],
      activeServerId: null,
      lastfmApiKey: '',
      lastfmApiSecret: '',
      lastfmSessionKey: '',
      lastfmUsername: '',
      scrobblingEnabled: true,
      maxCacheMb: 500,
      downloadFolder: '',
      excludeAudiobooks: false,
      customGenreBlacklist: [],
      replayGainEnabled: false,
      replayGainMode: 'track',
      crossfadeEnabled: false,
      crossfadeSecs: 3,
      gaplessEnabled: false,
      isLoggedIn: false,
      isConnecting: false,
      connectionError: null,
      lastfmSessionError: false,

      addServer: (profile) => {
        const id = generateId();
        set(s => ({ servers: [...s.servers, { ...profile, id }] }));
        return id;
      },

      updateServer: (id, data) => {
        set(s => ({
          servers: s.servers.map(srv => srv.id === id ? { ...srv, ...data } : srv),
        }));
      },

      removeServer: (id) => {
        set(s => {
          const newServers = s.servers.filter(srv => srv.id !== id);
          const switchedAway = s.activeServerId === id;
          return {
            servers: newServers,
            activeServerId: switchedAway ? (newServers[0]?.id ?? null) : s.activeServerId,
            isLoggedIn: switchedAway ? false : s.isLoggedIn,
          };
        });
      },

      setActiveServer: (id) => set({ activeServerId: id }),

      setLoggedIn: (v) => set({ isLoggedIn: v }),
      setConnecting: (v) => set({ isConnecting: v }),
      setConnectionError: (e) => set({ connectionError: e }),

      setLastfm: (apiKey, apiSecret, sessionKey, username) =>
        set({ lastfmApiKey: apiKey, lastfmApiSecret: apiSecret, lastfmSessionKey: sessionKey, lastfmUsername: username }),

      connectLastfm: (sessionKey, username) =>
        set({ lastfmSessionKey: sessionKey, lastfmUsername: username }),

      disconnectLastfm: () =>
        set({ lastfmSessionKey: '', lastfmUsername: '', lastfmSessionError: false }),

      setLastfmSessionError: (v) => set({ lastfmSessionError: v }),

      setScrobblingEnabled: (v) => set({ scrobblingEnabled: v }),
      setMaxCacheMb: (v) => set({ maxCacheMb: v }),
      setDownloadFolder: (v) => set({ downloadFolder: v }),
      setExcludeAudiobooks: (v) => set({ excludeAudiobooks: v }),
      setCustomGenreBlacklist: (v) => set({ customGenreBlacklist: v }),
      setReplayGainEnabled: (v) => set({ replayGainEnabled: v }),
      setReplayGainMode: (v) => set({ replayGainMode: v }),
      setCrossfadeEnabled: (v) => set({ crossfadeEnabled: v }),
      setCrossfadeSecs: (v) => set({ crossfadeSecs: v }),
      setGaplessEnabled: (v) => set({ gaplessEnabled: v }),

      logout: () => set({ isLoggedIn: false }),

      getBaseUrl: () => {
        const s = get();
        const server = s.servers.find(srv => srv.id === s.activeServerId);
        if (!server?.url) return '';
        return server.url.startsWith('http') ? server.url : `http://${server.url}`;
      },

      getActiveServer: () => {
        const s = get();
        return s.servers.find(srv => srv.id === s.activeServerId);
      },
    }),
    {
      name: 'psysonic-auth',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
