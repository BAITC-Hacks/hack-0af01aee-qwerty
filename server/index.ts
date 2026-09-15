import 'dotenv/config';
import { createApp } from './app.js';

const configuredPort = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const server = createApp().listen(configuredPort, () => {
  console.log(`StudyAI server: http://localhost:${configuredPort}`);
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.log('OPENAI_API_KEY is not configured. Add it to .env to enable generation.');
  }
});

function shutdown() {
  server.close();
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
