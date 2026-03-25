import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'mocha' | 'macchiato' | 'frappe' | 'latte' | 'nord' | 'nord-snowstorm' | 'nord-frost' | 'nord-aurora' | 'psychowave' | 'wnamp' | 'poison' | 'nucleo' | 'muma-jukebox' | 'winmedplayer' | 'p-dvd' | 'vintage-tube-radio' | 'neon-drift' | 'aero-glass' | 'luna-teal' | 'w98' | 'cupertino-light' | 'cupertino-dark' | 'gruvbox-dark-hard' | 'gruvbox-dark-medium' | 'gruvbox-dark-soft' | 'gruvbox-light-hard' | 'gruvbox-light-medium' | 'gruvbox-light-soft' | 'spotless' | 'dzr0' | 'cupertino-beats' | 'lambda-17' | 'gw1' | 'grand-theft-audio' | 'v-tactical' | 'nightcity-2077' | 'middle-earth' | 'morpheus' | 'stark-hud' | 'blade' | 'heisenberg' | 'ice-and-fire' | 'doh-matic' | 't-800' | 'dune' | 'tetrastack' | 'the-book' | 'readit' | 'insta' | 'hill-valley-85' | 'turtle-power' | 'w3-1' | 'aqua-quartz' | 'spider-tech' | 'dos' | 'unix' | 'jayfin' | 'horde' | 'alliance' | 'w11';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'mocha',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'psysonic_theme',
    }
  )
);
