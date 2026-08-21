import { createServer } from './server/web-server.js';

// Load .env if present
try {
  process.loadEnvFile();
} catch {
  // .env file is optional
}

const PORT = parseInt(process.env.PORT ?? '3100', 10);

const server = createServer();

server.listen(PORT, () => {
  console.log('====================================================');
  console.log('  📖 ClipToManual - YouTube to Software Manual Generator');
  console.log(`  🌐 Server running at: http://localhost:${PORT}`);
  console.log('  🛡️  Governed by Oxlint & Strict Anti-Slop Principles');
  console.log('====================================================');
});

