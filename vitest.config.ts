import { defineConfig, configDefaults } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/.claude/**"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          include: ["**/*.test.tsx"],
          exclude: [...configDefaults.exclude, "**/.claude/**"],
          environment: "jsdom",
          setupFiles: ["./app/test/setup-dom.ts"],
        },
      },
    ],
  },
});
