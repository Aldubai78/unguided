// Metro config: alias native-only modules to web shims (web target ONLY) +
// resolve Node-style ".js" extension imports to ".ts" (the 5 core files use
// ".js" imports for node:tsx; Metro's web resolver rejects them, so we map
// ".js" -> ".ts").
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver = {
  ...config.resolver,
  // 1) Resolve Node-style ".js" imports to ".ts" source files.
  resolveRequest: (context, moduleName, platform) => {
    // Web platform: alias native-only modules to shims.
    if (platform === "web") {
      if (moduleName === "expo-secure-store") {
        return {
          type: "sourceFile",
          filePath: path.resolve(__dirname, "shims/expo-secure-store.web.ts"),
        };
      }
      if (moduleName === "expo-sqlite") {
        return {
          type: "sourceFile",
          filePath: path.resolve(__dirname, "shims/expo-sqlite.web.ts"),
        };
      }
    }
    // Only remap relative ".js" imports that have no ".ts" sibling.
    if (
      (moduleName.startsWith("./") || moduleName.startsWith("../")) &&
      moduleName.endsWith(".js")
    ) {
      const tsName = moduleName.slice(0, -3) + ".ts";
      const ctx = { ...context, moduleName: tsName };
      try {
        return context.resolveRequest(ctx, tsName, platform);
      } catch {
        // fall through to default resolution
      }
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;
