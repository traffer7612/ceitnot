import { RainbowKitProvider, darkTheme, lightTheme } from '@rainbow-me/rainbowkit';
import { useTheme } from './ThemeContext';

const shared = {
  borderRadius: 'medium' as const,
  fontStack: 'system' as const,
  overlayBlur: 'small' as const,
};

export default function ThemedRainbowKit({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const rk =
    theme === 'light'
      ? lightTheme({
          ...shared,
          accentColor: '#2563eb',
          accentColorForeground: '#ffffff',
        })
      : darkTheme({
          ...shared,
          accentColor: '#2dd4bf',
          accentColorForeground: '#0b0a10',
        });

  return <RainbowKitProvider theme={rk}>{children}</RainbowKitProvider>;
}
