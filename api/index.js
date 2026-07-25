// Vercel serverless entry point. @vercel/node detects the exported Express
// app and wraps it as a single function handling all /api/* routes.
module.exports = require("../app");
