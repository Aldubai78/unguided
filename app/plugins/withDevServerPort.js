// Bakes the Expo dev-server port into android/gradle.properties so the
// generated native app asks the emulator (10.0.2.2) for JS on the port Metro
// actually listens on. 8081 is permanently the LLM archivist (llama-server)
// on this host, so Metro lives on 8091.
const { withGradleProperties } = require('expo/config-plugins');

module.exports = (config, port = 8091) =>
  withGradleProperties(config, (c) => {
    c.modResults = c.modResults.filter(
      (p) => !(p.type === 'property' && p.key === 'reactNativeDevServerPort')
    );
    c.modResults.push({
      type: 'property',
      key: 'reactNativeDevServerPort',
      value: String(port),
    });
    return c;
  });
