import { defineConfig } from 'vite';

// Multi-entry: the feed (index.html) and the standalone playground (playground.html,
// plan doc §6). Dev serves both paths; build emits both.
const entryPath = (name: string): string => new URL(`./${name}`, import.meta.url).pathname;

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        feed: entryPath('index.html'),
        playground: entryPath('playground.html'),
      },
    },
  },
});
