// Local development launcher. On Vercel, api/index.js is the entry instead.
const app = require("./app");
const config = require("./config");

app.listen(config.server.port, () => {
  const url = `http://localhost:${config.server.port}`;
  console.log(
    `\n  ${config.brand.platform} running → ${url}` +
      `\n  Scout dashboard: ${url}/scout.html` +
      `\n  Admin console:   ${url}/admin.html` +
      `\n  Payments:        ${config.payments.provider}\n`
  );
});
